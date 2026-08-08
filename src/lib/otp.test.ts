import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
  sendOtp,
  countRecentOtpRequestsByPhone,
  countRecentOtpRequestsByIp,
} from './otp';

vi.mock('./db', () => ({
  db: { otpRequest: { count: vi.fn() } },
}));

vi.mock('./services/sms', () => ({ sendOtpSms: vi.fn() }));

import { db } from './db';
import { sendOtpSms } from './services/sms';

describe('generateOtpCode', () => {
  it('produces a 6-digit numeric string', () => {
    expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it('stays within the 6-digit range', () => {
    for (let i = 0; i < 50; i++) {
      const n = Number(generateOtpCode());
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
});

describe('hashOtpCode / verifyOtpCode', () => {
  it('round-trips: a hashed code verifies against the original', async () => {
    const hash = await hashOtpCode('123456');
    await expect(verifyOtpCode('123456', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect code against the hash', async () => {
    const hash = await hashOtpCode('123456');
    await expect(verifyOtpCode('000000', hash)).resolves.toBe(false);
  });
});

describe('sendOtp', () => {
  it('delegates to the configured SMS driver', async () => {
    await sendOtp('+919876543210', '123456');
    expect(sendOtpSms).toHaveBeenCalledWith('+919876543210', '123456');
  });
});

describe('rate limit counters', () => {
  beforeEach(() => {
    vi.mocked(db.otpRequest.count).mockReset();
  });

  it('counts recent requests for a phone number', async () => {
    vi.mocked(db.otpRequest.count).mockResolvedValue(2);
    await expect(countRecentOtpRequestsByPhone('+919876543210')).resolves.toBe(2);
    expect(db.otpRequest.count).toHaveBeenCalledWith({
      where: { phone: '+919876543210', createdAt: { gte: expect.any(Date) } },
    });
  });

  it('counts recent requests for an IP address', async () => {
    vi.mocked(db.otpRequest.count).mockResolvedValue(5);
    await expect(countRecentOtpRequestsByIp('203.0.113.4')).resolves.toBe(5);
    expect(db.otpRequest.count).toHaveBeenCalledWith({
      where: { ip: '203.0.113.4', createdAt: { gte: expect.any(Date) } },
    });
  });
});
