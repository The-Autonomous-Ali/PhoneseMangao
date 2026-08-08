import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSmsDriver, sendOtpSms } from './index';
import { resetEnvCache } from '@/lib/env';

const ORIGINAL = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL, ...overrides } as NodeJS.ProcessEnv;
  resetEnvCache();
}

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('getSmsDriver', () => {
  it('defaults to the console driver in development', () => {
    setEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://u:p@h.neon.tech/db',
      JWT_SECRET: 'x'.repeat(32),
      SMS_DRIVER: undefined,
    });
    expect(getSmsDriver().name).toBe('console');
  });

  it('warns when the console driver is used in production', () => {
    setEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@h.neon.tech/db',
      JWT_SECRET: 'x'.repeat(32),
      SMS_DRIVER: 'console',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSmsDriver();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no real SMS'));
  });
});

describe('sendOtpSms', () => {
  it('delivers through the active driver in the documented log format', async () => {
    setEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://u:p@h.neon.tech/db',
      JWT_SECRET: 'x'.repeat(32),
      SMS_DRIVER: undefined,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendOtpSms('+919876543210', '123456');
    expect(log).toHaveBeenCalledWith('[dev otp] +919876543210: 123456');
  });
});
