import { describe, it, expect } from 'vitest';
import { parseEnv } from './env';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@host.neon.tech/neondb?sslmode=require',
  JWT_SECRET: 'x'.repeat(32),
} as NodeJS.ProcessEnv;

// Production demands more than development does, so the production cases start
// from their own fixture rather than bolting NODE_ENV onto `valid`.
const prod = {
  ...valid,
  NODE_ENV: 'production',
  SMS_DRIVER: 'console',
  IMAGE_DRIVER: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'shopcloud',
  CLOUDINARY_API_KEY: '123456789',
  CLOUDINARY_API_SECRET: 'cloudinary-secret',
  APP_URL: 'https://shop.example.in',
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  CRON_SECRET: 'y'.repeat(16),
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
    expect(() => parseEnv({ ...prod, SMS_DRIVER: undefined })).toThrow(/SMS_DRIVER/);
  });

  it('allows the console driver in production when chosen explicitly', () => {
    expect(parseEnv(prod).SMS_DRIVER).toBe('console');
  });

  it('rejects an unknown SMS_DRIVER value', () => {
    expect(() => parseEnv({ ...valid, SMS_DRIVER: 'carrier-pigeon' })).toThrow(/SMS_DRIVER/);
  });

  it('treats an empty-string SMS_DRIVER as absent', () => {
    // A bare `SMS_DRIVER=` line in a copied .env, or a blank variable in the
    // Vercel dashboard, arrives as '' rather than undefined. Failing there
    // would be a trap, since .env.example ships the variable.
    expect(parseEnv({ ...valid, SMS_DRIVER: '' }).SMS_DRIVER).toBe('console');
  });

  it('treats an empty-string NODE_ENV as absent', () => {
    // @types/node types NODE_ENV as the three-way union, but the runtime hands
    // us whatever the shell exported — a bare `NODE_ENV=` line arrives as ''.
    // The cast asserts the value the type system forbids and the process can
    // still produce; weakening the assertion instead would stop testing it.
    const blank = '' as NodeJS.ProcessEnv['NODE_ENV'];
    expect(parseEnv({ ...valid, NODE_ENV: blank }).NODE_ENV).toBe('development');
  });
});

// Not cast to ProcessEnv: it is a fragment spread onto `valid`, and on its own
// it is missing the keys ProcessEnv requires.
const whatsapp = {
  SMS_DRIVER: 'whatsapp',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_ACCESS_TOKEN: 'EAAG...system-user-token',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'shop_login_code',
};

describe('parseEnv — WhatsApp driver', () => {
  it('accepts the whatsapp driver when its credentials are present', () => {
    const env = parseEnv({ ...valid, ...whatsapp });
    expect(env.SMS_DRIVER).toBe('whatsapp');
    expect(env.WHATSAPP_PHONE_NUMBER_ID).toBe('1234567890');
  });

  it.each([
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_AUTH_TEMPLATE_NAME',
  ])('rejects the whatsapp driver when %s is missing', (missing) => {
    // Selecting a driver whose credentials are absent is the failure this file
    // exists to catch: it would deploy green and then fail on every login.
    expect(() => parseEnv({ ...valid, ...whatsapp, [missing]: undefined })).toThrow(
      new RegExp(missing)
    );
  });

  it('does not require WhatsApp credentials while the console driver is active', () => {
    expect(() => parseEnv({ ...valid, SMS_DRIVER: 'console' })).not.toThrow();
  });
});

describe('parseEnv — production-only requirements', () => {
  it('accepts a fully configured production environment', () => {
    expect(parseEnv(prod).APP_URL).toBe('https://shop.example.in');
  });

  it.each(['APP_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CRON_SECRET'])(
    'requires %s in production',
    (key) => {
      expect(() => parseEnv({ ...prod, [key]: undefined })).toThrow(new RegExp(key));
    }
  );

  it.each(['APP_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CRON_SECRET'])(
    'does not require %s in development',
    (key) => {
      expect(() => parseEnv({ ...valid, [key]: undefined })).not.toThrow();
    }
  );

  it('rejects an APP_URL that is not an absolute http(s) URL', () => {
    // The OAuth redirect URI is built by concatenation. A relative or trailing-
    // slash value produces a URI Google rejects, and the error surfaces at the
    // consent screen rather than here.
    expect(() => parseEnv({ ...prod, APP_URL: 'shop.example.in' })).toThrow(/APP_URL/);
  });

  it('rejects an APP_URL with a trailing slash', () => {
    expect(() => parseEnv({ ...prod, APP_URL: 'https://shop.example.in/' })).toThrow(/APP_URL/);
  });

  it('rejects a CRON_SECRET short enough to guess', () => {
    expect(() => parseEnv({ ...prod, CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/);
  });
});

describe('parseEnv — Razorpay', () => {
  const keys = {
    RAZORPAY_KEY_ID: 'rzp_test_abc',
    RAZORPAY_KEY_SECRET: 'secret',
    RAZORPAY_WEBHOOK_SECRET: 'webhook-secret',
  };

  it('accepts no Razorpay configuration at all, since payments are opt-in', () => {
    expect(() => parseEnv(valid)).not.toThrow();
  });

  it('accepts a complete set of keys', () => {
    expect(() => parseEnv({ ...valid, ...keys })).not.toThrow();
  });

  it.each(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'])(
    'rejects a half-configured Razorpay missing %s',
    (missing) => {
      // Keys without a webhook secret is the dangerous state: payments are
      // taken and never confirmed, because the webhook is the only thing that
      // marks an order paid.
      expect(() => parseEnv({ ...valid, ...keys, [missing]: undefined })).toThrow(/RAZORPAY/);
    }
  );
});

describe('parseEnv — image driver', () => {
  it('defaults to the local driver in development', () => {
    expect(parseEnv(valid).IMAGE_DRIVER).toBe('local');
  });

  it('requires IMAGE_DRIVER to be set explicitly in production', () => {
    expect(() => parseEnv({ ...prod, IMAGE_DRIVER: undefined })).toThrow(/IMAGE_DRIVER/);
  });

  it('refuses the local driver in production', () => {
    // The container filesystem is ephemeral and the runtime user cannot write
    // to public/. Every uploaded image would vanish on the next restart, and
    // the shop would only find out from a customer.
    expect(() => parseEnv({ ...prod, IMAGE_DRIVER: 'local' })).toThrow(/ephemeral/);
  });

  it.each(['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'])(
    'rejects the cloudinary driver when %s is missing',
    (missing) => {
      expect(() => parseEnv({ ...prod, [missing]: undefined })).toThrow(new RegExp(missing));
    }
  );

  it('does not require Cloudinary credentials while the local driver is active', () => {
    expect(() => parseEnv({ ...valid, IMAGE_DRIVER: 'local' })).not.toThrow();
  });
});
