import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { sendOtpSms } from './services/sms';

export const OTP_EXPIRY_MINUTES = 5;
export const MAX_OTP_ATTEMPTS = 3;
export const PHONE_RATE_LIMIT_PER_HOUR = 3;
export const IP_RATE_LIMIT_PER_HOUR = 10;

/**
 * 'LOGIN'        — the legacy phone-only sign-in.
 * 'PHONE_VERIFY' — attaching a number to an account that signed in with Google.
 * 'COD_CONFIRM'  — confirming a cash-on-delivery order.
 *
 * Scoping every lookup by purpose is what stops a code issued for one flow from
 * being spent on another: a PHONE_VERIFY code must not log anybody in.
 */
export type OtpPurpose = 'LOGIN' | 'PHONE_VERIFY' | 'COD_CONFIRM';

export function generateOtpCode(): string {
  // crypto.randomInt, not Math.random: this code is the only credential in the
  // login flow, and Math.random's output is predictable from prior draws.
  // Upper bound is exclusive, so this yields 100000-999999.
  return randomInt(100000, 1000000).toString();
}

export function hashOtpCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export function verifyOtpCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export async function sendOtp(phone: string, code: string): Promise<void> {
  return sendOtpSms(phone, code);
}

export type ConsumeOtpResult =
  | { ok: true }
  /** 'NOT_FOUND' also covers expired — the customer's next step is the same. */
  | { ok: false; reason: 'NOT_FOUND' | 'INCORRECT' };

/**
 * Checks a code against the newest unconsumed request for this phone and
 * purpose, and spends it on success.
 *
 * A wrong code burns an attempt, and the third wrong attempt consumes the
 * request outright, so a stolen 6-digit code cannot be brute-forced: three
 * guesses out of a million, inside five minutes.
 */
export async function consumeOtp(
  phone: string,
  code: string,
  purpose: OtpPurpose
): Promise<ConsumeOtpResult> {
  const otpRequest = await db.otpRequest.findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!otpRequest || otpRequest.expiresAt < new Date()) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  if (!(await verifyOtpCode(code, otpRequest.codeHash))) {
    const attempts = otpRequest.attempts + 1;
    const exceeded = attempts >= MAX_OTP_ATTEMPTS;
    await db.otpRequest.update({
      where: { id: otpRequest.id },
      data: { attempts, ...(exceeded ? { consumedAt: new Date() } : {}) },
    });
    return { ok: false, reason: 'INCORRECT' };
  }

  await db.otpRequest.update({
    where: { id: otpRequest.id },
    data: { consumedAt: new Date() },
  });
  return { ok: true };
}

export async function countRecentOtpRequestsByPhone(phone: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return db.otpRequest.count({ where: { phone, createdAt: { gte: since } } });
}

export async function countRecentOtpRequestsByIp(ip: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return db.otpRequest.count({ where: { ip, createdAt: { gte: since } } });
}
