import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';
import { getShopSettings } from '@/lib/settings';
import { distanceKm, isValidLatitude, isValidLongitude } from '@/lib/geo';

/** Indian PIN codes: six digits, never starting with zero. */
export const PINCODE_PATTERN = /^[1-9]\d{5}$/;

export function isValidPincode(value: string): boolean {
  return PINCODE_PATTERN.test(value.trim());
}

export type ServiceabilityReason =
  /** On the shop's list of areas it serves, whatever the distance. */
  | 'PINCODE_LISTED'
  | 'WITHIN_RADIUS'
  | 'OUTSIDE_RADIUS'
  /** Radius delivery is configured, but this address has no pin on it yet. */
  | 'LOCATION_NEEDED'
  | 'NOT_SERVICEABLE';

export interface ServiceabilityResult {
  serviceable: boolean;
  /** Human-readable area name when the shop has recorded one. */
  area?: string;
  reason: ServiceabilityReason;
  /** Set whenever a distance was actually measured. */
  distanceKm?: number;
}

/**
 * The single decision point for "do we deliver here?".
 *
 * Two rules, in this order.
 *
 * A pincode on the shop's list is served regardless of distance. That is the
 * override, and it exists because a circle drawn on a map is wrong in ways the
 * owner can see and the maths cannot: it takes in the far bank of a river with
 * no bridge, and it cuts off the colony at 5.2 km he has served for years.
 * Adding that colony's pincode is how he says so.
 *
 * Otherwise the pin is measured against the shop and compared to the radius.
 *
 * The order matters for a third reason: until the owner has set a shop
 * location, the radius rule cannot run at all, and the function quietly stays
 * exactly as it behaved before — a pincode whitelist. Shipping radius delivery
 * therefore cannot make the whole town unserviceable on deploy, which is the
 * failure that would be discovered by customers rather than by us.
 *
 * A missing pin is `LOCATION_NEEDED` rather than a flat refusal. An address
 * saved before the map existed is not an address we do not deliver to; it is
 * one we cannot measure yet, and the customer's fix is to drop a pin.
 */
export async function isServiceable(input: {
  pincode: string;
  lat?: number;
  lng?: number;
}): Promise<ServiceabilityResult> {
  const pincode = input.pincode.trim();

  const settings = await getShopSettings();
  const shopLocated = settings.shopLat !== null && settings.shopLng !== null;

  // The override, checked first so it can beat the radius in both directions.
  if (isValidPincode(pincode)) {
    const hit = await withReadRetry(() =>
      db.servicePincode.findFirst({
        where: { pincode, isActive: true },
        select: { area: true },
      })
    );

    if (hit) {
      return {
        serviceable: true,
        reason: 'PINCODE_LISTED',
        ...(hit.area ? { area: hit.area } : {}),
      };
    }
  }

  if (!shopLocated) return { serviceable: false, reason: 'NOT_SERVICEABLE' };

  const hasPin =
    typeof input.lat === 'number' &&
    typeof input.lng === 'number' &&
    isValidLatitude(input.lat) &&
    isValidLongitude(input.lng);

  if (!hasPin) return { serviceable: false, reason: 'LOCATION_NEEDED' };

  const km = distanceKm(
    { lat: settings.shopLat!, lng: settings.shopLng! },
    { lat: input.lat!, lng: input.lng! }
  );

  return km <= settings.deliveryRadiusKm
    ? { serviceable: true, reason: 'WITHIN_RADIUS', distanceKm: km }
    : { serviceable: false, reason: 'OUTSIDE_RADIUS', distanceKm: km };
}

/**
 * What to tell the customer when the answer is no.
 *
 * Kept beside the rule so the three places that refuse an address — saving one,
 * editing one, and checking out — cannot drift into telling the same person
 * three different stories about why.
 *
 * The distinction that matters is between "we do not come here" and "we cannot
 * tell yet". The second is not a refusal, it is a missing pin, and phrasing it
 * as a refusal loses a customer who is standing well inside the radius.
 */
export function serviceabilityMessage(result: ServiceabilityResult, pincode: string): string {
  switch (result.reason) {
    case 'LOCATION_NEEDED':
      return 'Please drop a pin on the map so we can check this address is within our delivery range.';
    case 'OUTSIDE_RADIUS':
      return result.distanceKm
        ? `That address is about ${result.distanceKm.toFixed(1)} km away, outside our delivery range.`
        : 'That address is outside our delivery range.';
    default:
      return `We do not deliver to ${pincode} yet.`;
  }
}
