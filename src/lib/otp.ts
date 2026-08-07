import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db';

export const OTP_EXPIRY_MINUTES = 5;
export const MAX_OTP_ATTEMPTS = 3;
export const PHONE_RATE_LIMIT_PER_HOUR = 3;
export const IP_RATE_LIMIT_PER_HOUR = 10;

export type OtpPurpose = 'LOGIN' | 'COD_CONFIRM';

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
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[dev otp] ${phone}: ${code}`);
    return;
  }
  throw new Error(
    'SMS provider not configured — MSG91/Fast2SMS integration lands in a later phase'
  );
}

export async function countRecentOtpRequestsByPhone(phone: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return db.otpRequest.count({ where: { phone, createdAt: { gte: since } } });
}

export async function countRecentOtpRequestsByIp(ip: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return db.otpRequest.count({ where: { ip, createdAt: { gte: since } } });
}
