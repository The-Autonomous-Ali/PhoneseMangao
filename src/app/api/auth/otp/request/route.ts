import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = otpRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
  }

  const { phone } = parsed.data;
  const ip = getClientIp(request);

  const [phoneCount, ipCount] = await Promise.all([
    countRecentOtpRequestsByPhone(phone),
    countRecentOtpRequestsByIp(ip),
  ]);

  if (phoneCount >= PHONE_RATE_LIMIT_PER_HOUR || ipCount >= IP_RATE_LIMIT_PER_HOUR) {
    return NextResponse.json({ error: 'Too many requests, try again later' }, { status: 429 });
  }

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await db.otpRequest.create({
    data: { phone, ip, codeHash, purpose: 'LOGIN', expiresAt },
  });

  await sendOtp(phone, code);

  return NextResponse.json({ ok: true });
}
