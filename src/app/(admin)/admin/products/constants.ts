import { UnitType } from '@prisma/client';

/**
 * Mirrors MAX_IMAGE_BYTES from the image service.
 *
 * Duplicated on purpose: the service module reaches into `node:fs` and the
 * Cloudinary driver, and importing it into a client component would pull all of
 * that into the browser bundle. The server remains the authority — this copy
 * only labels the file input.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Ordered for the dropdown: the units this shop actually sells in come first. */
export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  [UnitType.KG]: 'Kilogram (kg)',
  [UnitType.GRAM]: 'Gram (g)',
  [UnitType.PIECE]: 'Piece',
  [UnitType.BUNDLE]: 'Bundle',
  [UnitType.PACK]: 'Pack',
  [UnitType.LITRE]: 'Litre (L)',
  [UnitType.ML]: 'Millilitre (ml)',
};
