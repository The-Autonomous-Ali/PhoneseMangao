import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  db: {
    otpRequest: { findFirst: vi.fn(), update: vi.fn() },
    user: { upsert: vi.fn() },
  },
}));

const cookieStore = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { db } from '@/lib/db';
import { hashOtpCode } from '@/lib/otp';
import { POST as verifyOtp } from './route';

const PHONE = '+919876543210';

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/auth/otp/verify', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long';
    vi.mocked(db.otpRequest.findFirst).mockReset();
    vi.mocked(db.otpRequest.update).mockReset();
    vi.mocked(db.user.upsert).mockReset();
    cookieStore.set.mockReset();
  });

  it('verifies a correct code, upserts the user, and sets a session cookie', async () => {
    const codeHash = await hashOtpCode('123456');
    vi.mocked(db.otpRequest.findFirst).mockResolvedValue({
      id: 'otp_1',
      phone: PHONE,
      codeHash,
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    vi.mocked(db.user.upsert).mockResolvedValue({
      id: 'user_1',
      phone: PHONE,
      role: 'ADMIN',
    } as never);

    const response = await verifyOtp(buildRequest({ phone: PHONE, code: '123456' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: 'ADMIN' });
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    expect(cookieStore.set.mock.calls[0][0]).toBe('session');
  });

  it('marks the number verified, since the code proves the caller holds it', async () => {
    // Otherwise someone who signs in by phone is sent to /verify-phone at
    // checkout and asked to confirm the number they just logged in with.
    const codeHash = await hashOtpCode('123456');
    vi.mocked(db.otpRequest.findFirst).mockResolvedValue({
      id: 'otp_1',
      phone: PHONE,
      codeHash,
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    vi.mocked(db.user.upsert).mockResolvedValue({ id: 'u1', phone: PHONE, role: 'CUSTOMER' } as never);

    await verifyOtp(buildRequest({ phone: PHONE, code: '123456' }));

    expect(db.user.upsert).toHaveBeenCalledWith({
      where: { phone: PHONE },
      update: { phoneVerifiedAt: expect.any(Date) },
      create: { phone: PHONE, phoneVerifiedAt: expect.any(Date) },
    });
  });

  it('rejects an incorrect code with 400 and increments attempts', async () => {
    const codeHash = await hashOtpCode('123456');
    vi.mocked(db.otpRequest.findFirst).mockResolvedValue({
      id: 'otp_1',
      phone: PHONE,
      codeHash,
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);

    const response = await verifyOtp(buildRequest({ phone: PHONE, code: '000000' }));

    expect(response.status).toBe(400);
    expect(db.otpRequest.update).toHaveBeenCalledWith({
      where: { id: 'otp_1' },
      data: { attempts: 1 },
    });
  });

  it('invalidates the request after the 3rd failed attempt', async () => {
    const codeHash = await hashOtpCode('123456');
    vi.mocked(db.otpRequest.findFirst).mockResolvedValue({
      id: 'otp_1',
      phone: PHONE,
      codeHash,
      attempts: 2,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);

    await verifyOtp(buildRequest({ phone: PHONE, code: '000000' }));

    expect(db.otpRequest.update).toHaveBeenCalledWith({
      where: { id: 'otp_1' },
      data: { attempts: 3, consumedAt: expect.any(Date) },
    });
  });

  it('rejects when no matching OTP request exists', async () => {
    vi.mocked(db.otpRequest.findFirst).mockResolvedValue(null);
    const response = await verifyOtp(buildRequest({ phone: PHONE, code: '123456' }));
    expect(response.status).toBe(400);
  });
});
