import { NextRequest, NextResponse } from 'next/server';
import { isServiceable, isValidPincode, serviceabilityMessage } from '@/lib/serviceability';
import { isValidLatitude, isValidLongitude } from '@/lib/geo';
import { getShopSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/** A query parameter that should be a number, or undefined if it is not one. */
function coordinate(raw: string | null, valid: (value: number) => boolean): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return valid(value) ? value : undefined;
}

/**
 * Answers the delivery gate, for a pincode and optionally a dropped pin.
 *
 * Public and unauthenticated by necessity — it runs before anyone has an
 * account. It reveals whether the shop delivers to a point and how far that
 * point is, which is information the shop wants public anyway.
 *
 * The shop's own location comes back so the map has somewhere to centre and a
 * circle to draw. A shop's address is not a secret; it is on the signboard.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pincode = params.get('pincode')?.trim() ?? '';

  // Distinguished from "not serviceable" so the gate can say "that is not a
  // valid PIN code" rather than "we do not deliver there", which would be a
  // confusing thing to tell someone who simply mistyped.
  if (!isValidPincode(pincode)) {
    return NextResponse.json({ error: 'Enter a valid 6-digit PIN code' }, { status: 400 });
  }

  const result = await isServiceable({
    pincode,
    lat: coordinate(params.get('lat'), isValidLatitude),
    lng: coordinate(params.get('lng'), isValidLongitude),
  });

  const settings = await getShopSettings();

  return NextResponse.json({
    ...result,
    message: result.serviceable ? undefined : serviceabilityMessage(result, pincode),
    shop:
      settings.shopLat !== null && settings.shopLng !== null
        ? { lat: settings.shopLat, lng: settings.shopLng, radiusKm: settings.deliveryRadiusKm }
        : null,
  });
}
