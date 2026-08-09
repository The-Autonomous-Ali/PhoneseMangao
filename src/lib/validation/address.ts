import { z } from 'zod';
import { PINCODE_PATTERN } from '@/lib/serviceability';

const trimmed = (max: number) => z.string().trim().max(max);

const optionalLine = (max: number) =>
  trimmed(max)
    .optional()
    // An untouched input posts '', which must mean "no landmark" rather than a
    // landmark that is the empty string.
    .transform((v) => (v ? v : undefined));

export const addressSchema = z.object({
  label: optionalLine(30),
  line1: trimmed(120).min(1, 'Flat, building and street are required'),
  line2: optionalLine(120),
  // Not decoration: the driver reads this. "Opposite the temple" is how
  // addresses actually work here, and it saves a phone call per delivery.
  landmark: optionalLine(120),
  city: trimmed(60).min(1, 'City is required'),
  pincode: z.string().trim().regex(PINCODE_PATTERN, 'Enter a valid 6-digit PIN code'),
  isDefault: z.boolean().default(false),
});

export type AddressInput = z.infer<typeof addressSchema>;
