import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';
import {
  generateOtpCode,
  hashOtpCode,
  sendOtp,
  countRecentOtpRequestsByPhone,
  countRecentOtpRequestsByIp,
  OTP_EXPIRY_MINUTES,
  PHONE_RATE_LIMIT_PER_HOUR,
  IP_RATE_LIMIT_PER_HOUR,
} from '@/lib/otp';
import { otpRequestSchema } from '@/lib/validation/auth';

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/**
 * Sends a WhatsApp code to a number an already-signed-in customer wants to
 * attach to their account.
 *
 * Unlike /api/auth/otp/request this requires a session: it adds a number to a
 * known account rather than creating one, so an anonymous caller has nothing to
 * add it to. The rate limits are shared with the login flow deliberately — they
 * are counted per phone and per IP across all purposes, so this route cannot be
 * used to bypass the login limit.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = otpRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
  }

  const { phone } = parsed.data;
  const ip = getClientIp(request);

  const [phoneCount, ipCount] = await withDbRetry(() =>
    Promise.all([countRecentOtpRequestsByPhone(phone), countRecentOtpRequestsByIp(ip)])
  );

  if (phoneCount >= PHONE_RATE_LIMIT_PER_HOUR || ipCount >= IP_RATE_LIMIT_PER_HOUR) {
    return NextResponse.json({ error: 'Too many requests, try again later' }, { status: 429 });
  }

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await withDbRetry(() =>
    db.otpRequest.create({
      data: { phone, ip, codeHash, purpose: 'PHONE_VERIFY', expiresAt },
    })
  );

  try {
    await sendOtp(phone, code);
  } catch (error) {
    // The row is already written, so the code stays valid if they retry. What
    // must not happen is a dead screen: the client shows the shop's number so
    // the customer can call instead.
    console.error('[auth] phone verification OTP send failed', error);
    return NextResponse.json(
      { error: 'We could not send the code right now. Please call the shop.' },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
