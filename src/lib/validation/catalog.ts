import { z } from 'zod';
import { UnitType } from '@prisma/client';

/**
 * Money stays a string all the way to Prisma's Decimal column.
 *
 * Parsing to a JS number first would round ₹1234.55 through binary floating
 * point, and these values are summed into order totals the shop reconciles
 * against bank settlements. Two decimal places, matching Decimal(10,2).
 */
const rupees = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'must be an amount like 45 or 45.50')
  .refine((v) => Number(v) > 0, 'must be greater than zero');

/** Decimal(10,3) — 0.250 kg is a real pack size, 0 is not. */
const unitValue = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,3})?$/, 'must be a quantity like 1 or 0.500')
  .refine((v) => Number(v) > 0, 'must be greater than zero');

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  // An untouched textarea posts '', which must mean "no description" rather
  // than a description that is the empty string.
  .transform((v) => (v ? v : undefined));

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const productSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  categoryId: z.string().min(1, 'Pick a category'),
  description: optionalText,
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const variantSchema = z
  .object({
    label: z.string().trim().min(1, 'Label is required').max(40),
    unitType: z.enum(UnitType),
    unitValue,
    price: rupees,
    mrp: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || /^\d{1,8}(\.\d{1,2})?$/.test(v), 'must be an amount'),
    stockQty: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || /^\d{1,6}$/.test(v), 'must be a whole number'),
    sku: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.mrp === undefined || Number(v.mrp) >= Number(v.price), {
    // MRP below the selling price would render as a negative discount on the
    // storefront, and in India it is the printed maximum — selling above it is
    // not something to let through by accident.
    message: 'MRP cannot be lower than the price',
    path: ['mrp'],
  });

/** Create takes the product and its first variant together, in one transaction. */
export const productWithVariantSchema = z.object({
  product: productSchema,
  variant: variantSchema,
});

export type CategoryInput = z.infer<typeof categorySchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type VariantInput = z.infer<typeof variantSchema>;
