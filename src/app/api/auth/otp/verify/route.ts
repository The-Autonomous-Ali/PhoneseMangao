import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyOtpCode, MAX_OTP_ATTEMPTS } from '@/lib/otp';
import { otpVerifySchema } from '@/lib/validation/auth';
import { signSession, setSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = otpVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid phone number or code' }, { status: 400 });
  }

  const { phone, code } = parsed.data;

  const otpRequest = await db.otpRequest.findFirst({
    where: { phone, purpose: 'LOGIN', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!otpRequest || otpRequest.expiresAt < new Date()) {
    return NextResponse.json(
      { error: 'Code expired or not found, request a new one' },
      { status: 400 }
    );
  }

  const isValid = await verifyOtpCode(code, otpRequest.codeHash);

  if (!isValid) {
    const attempts = otpRequest.attempts + 1;
    const exceeded = attempts >= MAX_OTP_ATTEMPTS;
    await db.otpRequest.update({
      where: { id: otpRequest.id },
      data: {
        attempts,
        ...(exceeded ? { consumedAt: new Date() } : {}),
      },
    });
    return NextResponse.json({ error: 'Incorrect code' }, { status: 400 });
  }

  await db.otpRequest.update({
    where: { id: otpRequest.id },
    data: { consumedAt: new Date() },
  });

  // Completing an OTP sent to this number *is* proof the caller holds it, so
  // the number is marked verified here. Without this, someone who signs in by
  // phone is sent to /verify-phone at checkout and asked to confirm the very
  // number they just used to log in.
  const user = await db.user.upsert({
    where: { phone },
    update: { phoneVerifiedAt: new Date() },
    create: { phone, phoneVerifiedAt: new Date() },
  });

  const token = await signSession({ userId: user.id, role: user.role });
  await setSessionCookie(token);

  return NextResponse.json({ role: user.role });
}
