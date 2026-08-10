import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { getNotifyDriver } from './index';

const ORIGINAL = { ...process.env };

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('getNotifyDriver', () => {
  it('follows SMS_DRIVER, because alerts travel the same channel as OTPs', () => {
    process.env = {
      ...ORIGINAL,
      ...BASE,
      NODE_ENV: 'development',
      SMS_DRIVER: 'console',
    } as NodeJS.ProcessEnv;
    resetEnvCache();

    expect(getNotifyDriver().name).toBe('console');
  });

  it('selects WhatsApp when the OTP channel is WhatsApp', () => {
    process.env = {
      ...ORIGINAL,
      ...BASE,
      NODE_ENV: 'development',
      SMS_DRIVER: 'whatsapp',
      WHATSAPP_PHONE_NUMBER_ID: '555000111',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_AUTH_TEMPLATE_NAME: 'shop_login_code',
    } as NodeJS.ProcessEnv;
    resetEnvCache();

    expect(getNotifyDriver().name).toBe('whatsapp');
  });
});
