import { z } from 'zod';

// Only drivers that actually exist belong here. Adding a driver later means
// implementing it, then adding its name to this tuple — in that order.
// Listing a driver before it works would let a deploy pass validation and then
// fail on every login, which is the exact failure mode this file prevents.
const SMS_DRIVERS = ['console', 'whatsapp'] as const;

// 'local' writes into public/uploads. That is fine on a developer's machine and
// useless in production: the container filesystem is ephemeral and the runtime
// user cannot write there, so images would disappear on the next restart.
// Hence the production rule below.
const IMAGE_DRIVERS = ['local', 'cloudinary'] as const;

const CLOUDINARY_REQUIRED_KEYS = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
] as const;

// Credentials the whatsapp driver reads at send time. Validating them here,
// keyed off the selected driver, is what turns "every OTP fails in production"
// into "the process refuses to boot with the missing variable named".
const WHATSAPP_REQUIRED_KEYS = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_AUTH_TEMPLATE_NAME',
] as const;

// Needed the moment real customers arrive, but not to run the app locally:
// Google sign-in and the cron routes both degrade to unusable rather than
// insecure in development, and requiring them there would block `next dev`
// on credentials a contributor may not have.
const PRODUCTION_REQUIRED_KEYS = [
  'APP_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'CRON_SECRET',
] as const;

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z
      .string()
      .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
        message: 'must be a postgres:// or postgresql:// connection string',
      }),
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    SMS_DRIVER: z.enum(SMS_DRIVERS).optional(),
    IMAGE_DRIVER: z.enum(IMAGE_DRIVERS).optional(),

    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),

    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    // No trailing slash: the OAuth redirect URI is built by concatenating
    // `${APP_URL}/api/auth/google/callback`, and Google matches the registered
    // URI byte for byte, so a stray slash fails at the consent screen.
    APP_URL: z
      .string()
      .refine((v) => /^https?:\/\/[^\s/]+(\/[^\s]*[^\s/])?$/.test(v), {
        message: 'must be an absolute http(s) URL with no trailing slash, e.g. https://shop.in',
      })
      .optional(),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_AUTH_TEMPLATE_NAME: z.string().optional(),
    WHATSAPP_OWNER_NUMBER: z.string().optional(),

    // A guessable cron secret is the same as no secret: these routes mutate
    // orders and slots, and they are reachable from anywhere the app is.
    CRON_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.SMS_DRIVER === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_DRIVER'],
        message:
          'must be set explicitly in production. Use "console" only for a demo — ' +
          'it logs the OTP instead of texting it, so real customers cannot log in.',
      });
    }

    if (value.NODE_ENV === 'production') {
      if (value.IMAGE_DRIVER === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['IMAGE_DRIVER'],
          message: 'must be set explicitly in production. Use "cloudinary".',
        });
      } else if (value.IMAGE_DRIVER === 'local') {
        ctx.addIssue({
          code: 'custom',
          path: ['IMAGE_DRIVER'],
          message:
            'cannot be "local" in production — the container filesystem is ephemeral, ' +
            'so every uploaded image would be lost on the next restart. Use "cloudinary".',
        });
      }
    }

    if (value.IMAGE_DRIVER === 'cloudinary') {
      for (const key of CLOUDINARY_REQUIRED_KEYS) {
        if (!value[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required when IMAGE_DRIVER is "cloudinary"',
          });
        }
      }
    }

    // Razorpay is switched on from Settings, not from the environment, so this
    // cannot demand the keys outright. What it can catch is the dangerous
    // half-state: keys present but no webhook secret means payments would be
    // taken and never confirmed, because the webhook is the only thing that
    // marks an order paid.
    const razorpayKeys = [
      value.RAZORPAY_KEY_ID,
      value.RAZORPAY_KEY_SECRET,
      value.RAZORPAY_WEBHOOK_SECRET,
    ];
    if (razorpayKeys.some(Boolean) && !razorpayKeys.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['RAZORPAY_WEBHOOK_SECRET'],
        message:
          'RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must be set together. ' +
          'Without the webhook secret, payments are taken and never confirmed.',
      });
    }

    if (value.SMS_DRIVER === 'whatsapp') {
      for (const key of WHATSAPP_REQUIRED_KEYS) {
        if (!value[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required when SMS_DRIVER is "whatsapp"',
          });
        }
      }
    }

    if (value.NODE_ENV === 'production') {
      for (const key of PRODUCTION_REQUIRED_KEYS) {
        if (!value[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
        }
      }
    }
  });

export type Env = {
  NODE_ENV: 'development' | 'test' | 'production';
  DATABASE_URL: string;
  JWT_SECRET: string;
  SMS_DRIVER: (typeof SMS_DRIVERS)[number];
  IMAGE_DRIVER: (typeof IMAGE_DRIVERS)[number];
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  APP_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_AUTH_TEMPLATE_NAME?: string;
  WHATSAPP_OWNER_NUMBER?: string;
  CRON_SECRET?: string;
};

// Every optional variable goes through this. An empty string means "not
// configured", not "configured as ''" — a bare `KEY=` line in a copied .env, or
// a blank variable in a hosting dashboard, must take the same path as an absent
// value. DATABASE_URL and JWT_SECRET are deliberately excluded: they are
// required, so '' must still fail, and it fails with a clearer message as an
// empty string than as a missing key.
function blankToUndefined(value: string | undefined): string | undefined {
  return value || undefined;
}

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse({
    NODE_ENV: blankToUndefined(raw.NODE_ENV),
    DATABASE_URL: raw.DATABASE_URL,
    JWT_SECRET: raw.JWT_SECRET,
    SMS_DRIVER: blankToUndefined(raw.SMS_DRIVER),
    IMAGE_DRIVER: blankToUndefined(raw.IMAGE_DRIVER),
    CLOUDINARY_CLOUD_NAME: blankToUndefined(raw.CLOUDINARY_CLOUD_NAME),
    CLOUDINARY_API_KEY: blankToUndefined(raw.CLOUDINARY_API_KEY),
    CLOUDINARY_API_SECRET: blankToUndefined(raw.CLOUDINARY_API_SECRET),
    RAZORPAY_KEY_ID: blankToUndefined(raw.RAZORPAY_KEY_ID),
    RAZORPAY_KEY_SECRET: blankToUndefined(raw.RAZORPAY_KEY_SECRET),
    RAZORPAY_WEBHOOK_SECRET: blankToUndefined(raw.RAZORPAY_WEBHOOK_SECRET),
    APP_URL: blankToUndefined(raw.APP_URL),
    GOOGLE_CLIENT_ID: blankToUndefined(raw.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: blankToUndefined(raw.GOOGLE_CLIENT_SECRET),
    WHATSAPP_PHONE_NUMBER_ID: blankToUndefined(raw.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_ACCESS_TOKEN: blankToUndefined(raw.WHATSAPP_ACCESS_TOKEN),
    WHATSAPP_AUTH_TEMPLATE_NAME: blankToUndefined(raw.WHATSAPP_AUTH_TEMPLATE_NAME),
    WHATSAPP_OWNER_NUMBER: blankToUndefined(raw.WHATSAPP_OWNER_NUMBER),
    CRON_SECRET: blankToUndefined(raw.CRON_SECRET),
  });

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  return {
    ...result.data,
    SMS_DRIVER: result.data.SMS_DRIVER ?? 'console',
    IMAGE_DRIVER: result.data.IMAGE_DRIVER ?? 'local',
  };
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

// Test-only escape hatch: lets a test re-evaluate after changing process.env.
export function resetEnvCache(): void {
  cached = undefined;
}
