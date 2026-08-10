import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';

/**
 * Shop settings, with the values used when a row is missing.
 *
 * Defaults are not a convenience — they are what keeps the shop taking orders
 * if a settings row is deleted or holds nonsense. A checkout that throws
 * because `delivery_fee` is absent is a worse failure than one that charges the
 * default and lets the owner notice.
 *
 * Money is a string throughout, matching how it travels everywhere else.
 */
export const SETTING_DEFAULTS = {
  delivery_fee: '30.00',
  min_order_value: '199.00',
  free_delivery_above: '500.00',
  shop_open: true,
  // Opt-in, not opt-out. Defaulting this on would mean a shop whose Razorpay
  // KYC has not cleared offers a payment method that errors at the last step.
  payments_enabled: false,
  whatsapp_number: '',
  // What the cron gives each newly generated slot. Editable so a bigger van
  // does not mean re-editing twenty-one rows a week, forever.
  slot_capacity: 20,
  // Where the shop is, and how far it will drive. Empty until the owner sets
  // it: an unset location leaves serviceability on the pincode list, which is
  // how the shop keeps taking orders rather than refusing everyone the moment
  // radius delivery ships.
  shop_lat: '',
  shop_lng: '',
  delivery_radius_km: 5,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export interface ShopSettings {
  deliveryFee: string;
  minOrderValue: string;
  /** Basket total at or above which delivery is free. */
  freeDeliveryAbove: string;
  shopOpen: boolean;
  /** Whether online payment is offered. Cash on delivery is always available. */
  paymentsEnabled: boolean;
  whatsappNumber: string;
  /** Orders one van can carry in a window. Applied to newly generated slots. */
  slotCapacity: number;
  /** Null until the owner sets it, which keeps serviceability on the pincode list. */
  shopLat: number | null;
  shopLng: number | null;
  /** How far the shop will drive, in kilometres. */
  deliveryRadiusKm: number;
}

// Settings arrive as JSON, so a number written from the admin and a string
// written by the seed both have to parse to the same thing.
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,8}(\.\d{1,2})?$/.test(v), 'not a money value');

function readMoney(raw: unknown, fallback: string): string {
  const parsed = money.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

// Same tolerance as money, for the same reason: a nonsense capacity should
// generate slots at the default, not stop the shop having any slots to sell.
const wholeCount = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((v) => Number.isInteger(v) && v >= 0 && v <= 500, 'not a capacity');

function readCount(raw: unknown, fallback: number): number {
  const parsed = wholeCount.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

/**
 * A coordinate, or null when it has never been set.
 *
 * Null rather than a fallback number on purpose. There is no sensible default
 * shop location, and inventing one — 0,0 in the Atlantic, say — would make
 * every customer measure thousands of kilometres away and quietly refuse the
 * whole town. Absent has to stay absent so the caller can fall back to pincodes.
 */
function readCoordinate(raw: unknown, limit: number): number | null {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (raw === '' || Math.abs(value) > limit) return null;
  return value;
}

const positiveNumber = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v > 0 && v <= 100, 'not a radius');

function readRadius(raw: unknown, fallback: number): number {
  const parsed = positiveNumber.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

export async function getShopSettings(): Promise<ShopSettings> {
  const rows = await withDbRetry(() => db.setting.findMany());
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  return {
    deliveryFee: readMoney(byKey.get('delivery_fee'), SETTING_DEFAULTS.delivery_fee),
    minOrderValue: readMoney(byKey.get('min_order_value'), SETTING_DEFAULTS.min_order_value),
    freeDeliveryAbove: readMoney(
      byKey.get('free_delivery_above'),
      SETTING_DEFAULTS.free_delivery_above
    ),
    // Anything other than an explicit `false` leaves the shop open. A typo in
    // the settings table should not silently close the business.
    shopOpen: byKey.get('shop_open') !== false,
    // The opposite rule, for the opposite reason: only an explicit `true`
    // enables payments, so a typo cannot offer a payment method that is not
    // actually configured.
    paymentsEnabled: byKey.get('payments_enabled') === true,
    whatsappNumber:
      typeof byKey.get('whatsapp_number') === 'string'
        ? (byKey.get('whatsapp_number') as string)
        : SETTING_DEFAULTS.whatsapp_number,
    slotCapacity: readCount(byKey.get('slot_capacity'), SETTING_DEFAULTS.slot_capacity),
    shopLat: readCoordinate(byKey.get('shop_lat'), 90),
    shopLng: readCoordinate(byKey.get('shop_lng'), 180),
    deliveryRadiusKm: readRadius(
      byKey.get('delivery_radius_km'),
      SETTING_DEFAULTS.delivery_radius_km
    ),
  };
}

/**
 * Saves settings, creating rows that do not exist yet.
 *
 * Upsert rather than update because the table starts empty — every value in
 * `SETTING_DEFAULTS` is a default precisely because its row may never have been
 * written. One transaction, so a form that fails partway cannot leave the shop
 * with a new delivery fee and an old minimum order.
 *
 * Values are written as given. Validation belongs to the caller's schema, and
 * `getShopSettings` treats anything unreadable as absent regardless.
 */
export async function writeSettings(
  values: Partial<Record<SettingKey, unknown>>
): Promise<void> {
  const entries = Object.entries(values) as [SettingKey, unknown][];
  if (entries.length === 0) return;

  await withDbRetry(() =>
    db.$transaction(
      entries.map(([key, value]) =>
        db.setting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue },
          update: { value: value as Prisma.InputJsonValue },
        })
      )
    )
  );
}
