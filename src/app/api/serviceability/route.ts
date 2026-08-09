import { NextRequest, NextResponse } from 'next/server';
import { isServiceable, isValidPincode } from '@/lib/serviceability';

export const dynamic = 'force-dynamic';

/**
 * Answers the pincode gate.
 *
 * Public and unauthenticated by necessity — it runs before anyone has an
 * account. It reveals only whether the shop delivers to a pincode, which is
 * information the shop wants public anyway.
 */
export async function GET(request: NextRequest) {
  const pincode = request.nextUrl.searchParams.get('pincode')?.trim() ?? '';

  // Distinguished from "not serviceable" so the gate can say "that is not a
  // valid PIN code" rather than "we do not deliver there", which would be a
  // confusing thing to tell someone who simply mistyped.
  if (!isValidPincode(pincode)) {
    return NextResponse.json({ error: 'Enter a valid 6-digit PIN code' }, { status: 400 });
  }

  const result = await isServiceable({ pincode });
  return NextResponse.json(result);
}
