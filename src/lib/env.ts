import { z } from 'zod';

// Only drivers that actually exist belong here. Adding MSG91 later means
// implementing its driver, then adding 'msg91' to this tuple — in that order.
// Listing a driver before it works would let a deploy pass validation and then
// fail on every login, which is the exact failure mode this file prevents.
const SMS_DRIVERS = ['console'] as const;

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
  });

export type Env = {
  NODE_ENV: 'development' | 'test' | 'production';
  DATABASE_URL: string;
  JWT_SECRET: string;
  SMS_DRIVER: (typeof SMS_DRIVERS)[number];
};

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  // An empty string means "not configured", not "configured as ''". A bare
  // `SMS_DRIVER=` line in a copied .env, or a blank variable in a hosting
  // dashboard, arrives as '' — it must take the same path as an absent value
  // rather than failing with `expected "console"`. DATABASE_URL and JWT_SECRET
  // are deliberately left alone: they are required, so '' must still fail, and
  // it fails with a clearer message as an empty string than as a missing key.
  const result = schema.safeParse({
    NODE_ENV: raw.NODE_ENV || undefined,
    DATABASE_URL: raw.DATABASE_URL,
    JWT_SECRET: raw.JWT_SECRET,
    SMS_DRIVER: raw.SMS_DRIVER || undefined,
  });

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  return { ...result.data, SMS_DRIVER: result.data.SMS_DRIVER ?? 'console' };
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
