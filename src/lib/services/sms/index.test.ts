import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSmsDriver, sendOtpSms } from './index';
import { resetEnvCache } from '@/lib/env';

const ORIGINAL = { ...process.env };

const BASE = {
  DATABASE_URL: 'postgresql://u:p@h.neon.tech/db',
  JWT_SECRET: 'x'.repeat(32),
};

// Everything production insists on beyond BASE, so a test that only cares about
// driver selection does not have to restate the Google and cron configuration.
const PROD_BASE = {
  ...BASE,
  NODE_ENV: 'production',
  APP_URL: 'https://shop.example.in',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  CRON_SECRET: 'y'.repeat(16),
  IMAGE_DRIVER: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'shopcloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
};

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
    setEnv({ ...BASE, NODE_ENV: 'development', SMS_DRIVER: undefined });
    expect(getSmsDriver().name).toBe('console');
  });

  it('warns when the console driver is used in production', () => {
    setEnv({ ...PROD_BASE, SMS_DRIVER: 'console' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSmsDriver();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no real SMS'));
  });

  it('selects the whatsapp driver when configured for it', () => {
    setEnv({
      ...PROD_BASE,
      SMS_DRIVER: 'whatsapp',
      WHATSAPP_PHONE_NUMBER_ID: '555000111',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_AUTH_TEMPLATE_NAME: 'shop_login_code',
    });
    expect(getSmsDriver().name).toBe('whatsapp');
  });

  it('does not warn about undelivered SMS when a real driver is active', () => {
    setEnv({
      ...PROD_BASE,
      SMS_DRIVER: 'whatsapp',
      WHATSAPP_PHONE_NUMBER_ID: '555000111',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_AUTH_TEMPLATE_NAME: 'shop_login_code',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSmsDriver();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('sendOtpSms', () => {
  it('delivers through the active driver in the documented log format', async () => {
    setEnv({ ...BASE, NODE_ENV: 'development', SMS_DRIVER: undefined });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendOtpSms('+919876543210', '123456');
    expect(log).toHaveBeenCalledWith('[dev otp] +919876543210: 123456');
  });
});
