import { z } from 'zod';
import { PINCODE_PATTERN } from '@/lib/serviceability';

/**
 * Money on the settings screen, where zero is meaningful.
 *
 * Deliberately not `rupees` from `catalog.ts`, which requires a value above
 * zero. That is right for a product price and wrong for every amount here: a
 * delivery fee of 0 is a shop that never charges for delivery, and a
 * free-delivery threshold of 0 makes delivery always free. Both are things an
 * owner may genuinely want, and a schema that rejected them would send him back
 * to the database — which is the situation this screen exists to end.
 */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'must be an amount like 30 or 30.50');

export const pincodeSchema = z.object({
  pincode: z.string().trim().regex(PINCODE_PATTERN, 'must be a six-digit PIN code'),
  area: z
    .string()
    .trim()
    .max(60)
    .optional()
    // A blank box means "no area recorded", not an area whose name is empty.
    .transform((v) => (v ? v : undefined)),
});

/** 0 is valid: it keeps a slot on the page while refusing new orders. */
export const slotCapacitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, 'must be a whole number of orders')
  .transform(Number)
  .refine((v) => v <= 500, 'must be 500 or fewer');

/**
 * A coordinate, or '' for "not set".
 *
 * Empty has to stay a legal value: the shop location is unknown until the owner
 * finds it, and a schema that demanded one would make the settings form
 * unsavable until then — locking the owner out of the delivery fee because he
 * has not yet looked up his own latitude.
 */
const coordinate = (limit: number) =>
  z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^-?\d{1,3}(\.\d{1,8})?$/.test(v) && Math.abs(Number(v)) <= limit),
      `must be a coordinate between -${limit} and ${limit}, or left empty`
    );

export const shopSettingsSchema = z.object({
  deliveryFee: amount,
  minOrderValue: amount,
  freeDeliveryAbove: amount,
  shopLat: coordinate(90),
  shopLng: coordinate(180),
  deliveryRadiusKm: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d)?$/, 'must be a distance like 5 or 7.5')
    .refine((v) => Number(v) > 0 && Number(v) <= 100, 'must be between 0 and 100 km'),
  whatsappNumber: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === '' || /^\+?[0-9]{8,15}$/.test(v), 'must be a phone number, or left empty'),
  slotCapacity: slotCapacitySchema,
});

export type PincodeInput = z.infer<typeof pincodeSchema>;
export type ShopSettingsInput = z.infer<typeof shopSettingsSchema>;
