import { z } from 'zod';
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
  whatsapp_number: '',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export interface ShopSettings {
  deliveryFee: string;
  minOrderValue: string;
  /** Basket total at or above which delivery is free. */
  freeDeliveryAbove: string;
  shopOpen: boolean;
  whatsappNumber: string;
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
    whatsappNumber:
      typeof byKey.get('whatsapp_number') === 'string'
        ? (byKey.get('whatsapp_number') as string)
        : SETTING_DEFAULTS.whatsapp_number,
  };
}
