import { describe, it, expect } from 'vitest';
import { parseEnv } from './env';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@host.neon.tech/neondb?sslmode=require',
  JWT_SECRET: 'x'.repeat(32),
} as NodeJS.ProcessEnv;

describe('parseEnv', () => {
  it('accepts a valid environment and defaults SMS_DRIVER to console', () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toContain('neon.tech');
    expect(env.SMS_DRIVER).toBe('console');
  });

  it('rejects a missing DATABASE_URL and names the variable', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/
    );
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: 'tooshort' })).toThrow(/JWT_SECRET/);
  });

  it('requires SMS_DRIVER to be set explicitly in production', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/SMS_DRIVER/);
  });

  it('allows the console driver in production when chosen explicitly', () => {
    const env = parseEnv({ ...valid, NODE_ENV: 'production', SMS_DRIVER: 'console' });
    expect(env.SMS_DRIVER).toBe('console');
  });

  it('rejects an unknown SMS_DRIVER value', () => {
    expect(() => parseEnv({ ...valid, SMS_DRIVER: 'carrier-pigeon' })).toThrow(/SMS_DRIVER/);
  });
});
