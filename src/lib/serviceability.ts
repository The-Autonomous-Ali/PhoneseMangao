import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';

/** Indian PIN codes: six digits, never starting with zero. */
export const PINCODE_PATTERN = /^[1-9]\d{5}$/;

export function isValidPincode(value: string): boolean {
  return PINCODE_PATTERN.test(value.trim());
}

export interface ServiceabilityResult {
  serviceable: boolean;
  /** Human-readable area name when the shop has recorded one. */
  area?: string;
}

/**
 * The single decision point for "do we deliver here?".
 *
 * Currently a pincode whitelist the shop owner maintains from the admin. The
 * design doc weighed this against a radius check and chose the whitelist: a
 * radius needs a paid geocoding call on every address entry, and it is wrong in
 * the ways that matter — a 5 km circle includes the far bank of a river with no
 * bridge and excludes a colony at 5.2 km the shop is happy to serve.
 *
 * Every caller goes through this function, so switching to radius later means
 * changing this file and adding lat/lng capture on the address form, and
 * nothing else. That is why it takes an object rather than a bare string.
 */
export async function isServiceable(input: {
  pincode: string;
  lat?: number;
  lng?: number;
}): Promise<ServiceabilityResult> {
  const pincode = input.pincode.trim();
  if (!isValidPincode(pincode)) return { serviceable: false };

  const hit = await withDbRetry(() =>
    db.servicePincode.findFirst({
      where: { pincode, isActive: true },
      select: { area: true },
    })
  );

  // Radius mode would geocode the address, then compare a haversine distance
  // from SHOP_LAT/SHOP_LNG against DELIVERY_RADIUS_KM in Settings.
  if (!hit) return { serviceable: false };
  return { serviceable: true, area: hit.area ?? undefined };
}
