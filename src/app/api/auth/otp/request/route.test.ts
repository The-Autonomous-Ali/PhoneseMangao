import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  db: { otpRequest: { count: vi.fn(), create: vi.fn() } },
}));

vi.mock('@/lib/otp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/otp')>('@/lib/otp');
  return { ...actual, sendOtp: vi.fn(async () => {}) };
});

import { db } from '@/lib/db';
import { sendOtp } from '@/lib/otp';
import { POST as requestOtp } from './route';

function buildRequest(body: unknown, ip?: string) {
  return new NextRequest('http://localhost/api/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
  });
}

describe('POST /api/auth/otp/request', () => {
  beforeEach(() => {
    vi.mocked(db.otpRequest.count).mockReset().mockResolvedValue(0);
    vi.mocked(db.otpRequest.create).mockReset().mockResolvedValue({} as never);
    vi.mocked(sendOtp).mockClear();
  });

  it('accepts a valid phone, stores an OTP request, and sends the code', async () => {
    const response = await requestOtp(buildRequest({ phone: '+919876543210' }, '203.0.113.4'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(db.otpRequest.create).toHaveBeenCalledTimes(1);
    expect(sendOtp).toHaveBeenCalledWith('+919876543210', expect.stringMatching(/^\d{6}$/));
  });

  it('rejects an invalid phone with 400', async () => {
    const response = await requestOtp(buildRequest({ phone: 'not-a-phone' }));
    expect(response.status).toBe(400);
    expect(db.otpRequest.create).not.toHaveBeenCalled();
  });

  it('returns 429 when the phone has hit the rate limit', async () => {
    vi.mocked(db.otpRequest.count).mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const response = await requestOtp(buildRequest({ phone: '+919876543210' }));
    expect(response.status).toBe(429);
  });

  it('returns 429 when the IP has hit the rate limit', async () => {
    vi.mocked(db.otpRequest.count).mockResolvedValueOnce(0).mockResolvedValueOnce(10);
    const response = await requestOtp(buildRequest({ phone: '+919876543210' }));
    expect(response.status).toBe(429);
  });

  it('returns 502 when the code could not be delivered', async () => {
    // Distinct from a 500 on purpose: the client turns this one into the shop's
    // phone number rather than a generic retry, so a WhatsApp outage does not
    // leave a customer on a dead screen with no way to order.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendOtp).mockRejectedValueOnce(new Error('WhatsApp send failed with status 401'));

    const response = await requestOtp(buildRequest({ phone: '+919876543210' }));

    expect(response.status).toBe(502);
    // The request row is written before the send, so the code stays usable if
    // delivery recovers and they retry.
    expect(db.otpRequest.create).toHaveBeenCalledTimes(1);
  });
});
