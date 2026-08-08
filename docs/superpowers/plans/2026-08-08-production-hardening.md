# Phase 1.5 — Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 1 foundation survive production — no raw errors reach users, no work blocks on client-supplied credentials, and no misconfiguration is discovered by a customer.

**Architecture:** External services sit behind env-selected drivers with a stub default. Every API route runs inside one shared error wrapper that maps failures to safe status codes. Database calls that provably never executed are retried, so a sleeping Neon compute degrades to slowness rather than a 500. All configuration is validated once at server boot.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma 6 + Neon Postgres, Zod 4, Vitest 4, shadcn/ui, GitHub Actions.

**Spec:** [`docs/superpowers/specs/2026-08-08-production-hardening-design.md`](../specs/2026-08-08-production-hardening-design.md)

## Global Constraints

- Work on branch `phase1.5-hardening`, created from `master`. Never commit to `master` directly.
- Run every command from `D:\apps\Kadir_website` (the repo root — Phase 1's worktree was removed and `node_modules` now lives here).
- Tests live beside their source as `*.test.ts`; Vitest only collects `src/**/*.test.ts`, so **a test placed outside `src/` will silently never run**.
- Zod is v4. Use `z.url()`-free constructs as written in this plan; do not substitute deprecated v3 idioms.
- Never return a stack trace, Prisma message, or database hostname to a client. Phase 1's failure leaked the Neon hostname — that is the specific regression being prevented.
- `src/lib/auth.ts` is imported by `middleware.ts`, which runs on the **Edge runtime**. Do not import `node:crypto`, Prisma, or `src/lib/env.ts` into it. This is a deliberate, documented exception to the "no direct `process.env`" rule (Task 1).
- Keep the dev OTP log format exactly `[dev otp] <phone>: <code>` — the end-to-end verification greps for it.
- Commit after every task. Use Conventional Commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), matching existing history.

---

### Task 1: Environment validation

**Files:**
- Create: `src/lib/env.ts`
- Create: `src/lib/env.test.ts`
- Create: `src/instrumentation.ts`

**Interfaces:**
- Produces: `parseEnv(raw: NodeJS.ProcessEnv): Env`, `getEnv(): Env`, `resetEnvCache(): void`, and `type Env = { NODE_ENV: 'development'|'test'|'production'; DATABASE_URL: string; JWT_SECRET: string; SMS_DRIVER: 'console' }`. Tasks 2 and 7 consume `getEnv()`.

`parseEnv` is a pure function taking the raw environment so tests never mutate global state. `getEnv()` memoises it for application code.

- [ ] **Step 1: Write the failing test**

Create `src/lib/env.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/env.test.ts`
Expected: FAIL — cannot resolve `./env`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/env.ts`:

```ts
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
  const result = schema.safeParse({
    NODE_ENV: raw.NODE_ENV,
    DATABASE_URL: raw.DATABASE_URL,
    JWT_SECRET: raw.JWT_SECRET,
    SMS_DRIVER: raw.SMS_DRIVER,
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/env.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Fail at boot rather than at request time**

Create `src/instrumentation.ts`. Next.js calls `register()` once when the server starts, which turns a configuration mistake into a startup crash with a named variable instead of a mysterious 500 during someone's login:

```ts
export async function register() {
  // Node runtime only. The Edge runtime gets a different, smaller env surface
  // and does not need the database or SMS configuration.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('@/lib/env');
    getEnv();
  }
}
```

- [ ] **Step 6: Verify the app still builds and boots**

Run: `npm run build`
Expected: exits 0. (Type-checking took over six minutes on this machine — that is normal here, not a hang.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts src/instrumentation.ts
git commit -m "feat: validate environment configuration at startup"
```

---

### Task 2: SMS driver layer

**Files:**
- Create: `src/lib/services/sms/types.ts`
- Create: `src/lib/services/sms/console.ts`
- Create: `src/lib/services/sms/index.ts`
- Create: `src/lib/services/sms/index.test.ts`
- Modify: `src/lib/otp.ts` (replace `sendOtp`, lines 27–35)
- Modify: `src/lib/otp.test.ts` (replace the `describe('sendOtp')` block, lines 43–64)

**Interfaces:**
- Consumes: `getEnv()`, `resetEnvCache()` from Task 1.
- Produces: `interface SmsDriver { sendOtpSms(to: string, code: string): Promise<void> }`, `getSmsDriver(): SmsDriver`, `sendOtpSms(to, code): Promise<void>`. `sendOtp(phone, code)` in `otp.ts` keeps its existing signature so the calling route is unaffected.

**Why one method per message type:** Indian transactional SMS is sent as a DLT-registered template id plus variables, not free-form text. `sendOtpSms(to, code)` maps 1:1 onto one registered template; a generic `sendSms(to, message)` would need redesigning at the second message type.

- [ ] **Step 1: Write the failing test**

Create `src/lib/services/sms/index.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/services/sms/index.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Write the driver interface and console driver**

Create `src/lib/services/sms/types.ts`:

```ts
export interface SmsDriver {
  /** Stable identifier, used in logs and tests. */
  readonly name: string;
  /**
   * One method per message type, because each maps to one DLT-registered
   * template. Throws if delivery fails.
   */
  sendOtpSms(to: string, code: string): Promise<void>;
}
```

Create `src/lib/services/sms/console.ts`:

```ts
import type { SmsDriver } from './types';

/**
 * Stub driver: prints the code instead of texting it. This is what lets the
 * whole app be built and demoed before the client supplies SMS credentials.
 */
export const consoleDriver: SmsDriver = {
  name: 'console',
  async sendOtpSms(to: string, code: string): Promise<void> {
    // Format is depended on by the end-to-end verification — do not change it.
    console.log(`[dev otp] ${to}: ${code}`);
  },
};
```

- [ ] **Step 4: Write the selector**

Create `src/lib/services/sms/index.ts`:

```ts
import { getEnv } from '@/lib/env';
import { consoleDriver } from './console';
import type { SmsDriver } from './types';

export type { SmsDriver } from './types';

export function getSmsDriver(): SmsDriver {
  const env = getEnv();

  switch (env.SMS_DRIVER) {
    case 'console':
      if (env.NODE_ENV === 'production') {
        console.warn(
          '[sms] console driver is active in production: no real SMS is being sent, ' +
            'so customers cannot receive a login code.'
        );
      }
      return consoleDriver;
  }
}

export async function sendOtpSms(to: string, code: string): Promise<void> {
  return getSmsDriver().sendOtpSms(to, code);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/lib/services/sms/index.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Delegate `sendOtp` to the driver**

In `src/lib/otp.ts`, replace the whole `sendOtp` function (currently lines 27–35 — the one that throws in production) with:

```ts
export async function sendOtp(phone: string, code: string): Promise<void> {
  return sendOtpSms(phone, code);
}
```

and add to the imports at the top of the file:

```ts
import { sendOtpSms } from './services/sms';
```

This deletes the `NODE_ENV === 'production'` throw. That throw is the current production crash: `request/route.ts:46` awaits `sendOtp` with no `try`/`catch`, so every deployed login attempt returns an unhandled 500.

- [ ] **Step 7: Replace the obsolete tests**

In `src/lib/otp.test.ts`, delete the entire `describe('sendOtp', ...)` block (lines 43–64, including the `originalEnv`/`afterEach` it owns). Its second case asserts the production throw we just removed, so it *must* be deleted rather than left to fail. Replace it with:

```ts
vi.mock('./services/sms', () => ({ sendOtpSms: vi.fn() }));

import { sendOtpSms } from './services/sms';

describe('sendOtp', () => {
  it('delegates to the configured SMS driver', async () => {
    await sendOtp('+919876543210', '123456');
    expect(sendOtpSms).toHaveBeenCalledWith('+919876543210', '123456');
  });
});
```

Place the `vi.mock` call beside the existing `vi.mock('./db', ...)` at the top of the file — `vi.mock` is hoisted, so its position among the imports does not matter, but keeping the mocks together matches the file's existing shape.

- [ ] **Step 8: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, zero failures. The count changes from 34 (one `sendOtp` test removed, one added, plus Task 1's and this task's new tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/services src/lib/otp.ts src/lib/otp.test.ts
git commit -m "feat: put SMS delivery behind a swappable driver"
```

---

### Task 3: Database connection resilience

**Files:**
- Create: `src/lib/db-retry.ts`
- Create: `src/lib/db-retry.test.ts`

**Interfaces:**
- Produces: `isDbConnectionError(e: unknown): boolean`, `isRetryableDbError(e: unknown): boolean`, `withDbRetry<T>(operation: () => Promise<T>, options?: { attempts?: number; delaysMs?: number[] }): Promise<T>`. Task 4 consumes `isDbConnectionError`; Task 5 consumes `withDbRetry`.

**Two predicates, deliberately different.** `isDbConnectionError` decides the HTTP status (503) and includes `P1017`. `isRetryableDbError` decides whether to try again and **excludes** `P1017`: that code means the server closed the connection, which can happen *after* a statement was sent, so the write may or may not have landed. Retrying it is how you get duplicate orders. `P1001`/`P1002` and `PrismaClientInitializationError` all mean no connection was ever established, so the query provably never ran.

Observed in Phase 1: a suspended Neon compute surfaced as `PrismaClientInitializationError` with `errorCode: undefined` — so matching on codes alone is not enough, and the error class must be matched too.

- [ ] **Step 1: Write the failing test**

Create `src/lib/db-retry.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { isDbConnectionError, isRetryableDbError, withDbRetry } from './db-retry';

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: '6.19.3' });
}

function initError() {
  // Mirrors the real Phase 1 failure: a suspended Neon compute produced this
  // class with errorCode undefined.
  return new Prisma.PrismaClientInitializationError('Cannot reach database server', '6.19.3');
}

describe('isDbConnectionError', () => {
  it('treats P1001, P1002 and P1017 as connection failures', () => {
    for (const code of ['P1001', 'P1002', 'P1017']) {
      expect(isDbConnectionError(knownError(code))).toBe(true);
    }
  });

  it('treats an initialization error as a connection failure', () => {
    expect(isDbConnectionError(initError())).toBe(true);
  });

  it('does not treat a unique-constraint violation as a connection failure', () => {
    expect(isDbConnectionError(knownError('P2002'))).toBe(false);
  });
});

describe('isRetryableDbError', () => {
  it('retries only errors that prove the query never ran', () => {
    expect(isRetryableDbError(knownError('P1001'))).toBe(true);
    expect(isRetryableDbError(knownError('P1002'))).toBe(true);
    expect(isRetryableDbError(initError())).toBe(true);
  });

  it('does NOT retry P1017, because the write may already have landed', () => {
    expect(isRetryableDbError(knownError('P1017'))).toBe(false);
  });

  it('does not retry ordinary query errors', () => {
    expect(isRetryableDbError(knownError('P2002'))).toBe(false);
    expect(isRetryableDbError(new Error('nope'))).toBe(false);
  });
});

describe('withDbRetry', () => {
  const noDelay = { delaysMs: [0, 0] };

  it('returns the value when the operation succeeds first time', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    await expect(withDbRetry(op, noDelay)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries a cold-start failure and succeeds on a later attempt', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(initError())
      .mockRejectedValueOnce(initError())
      .mockResolvedValue('awake');
    await expect(withDbRetry(op, noDelay)).resolves.toBe('awake');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt cap and rethrows the last error', async () => {
    const op = vi.fn().mockRejectedValue(initError());
    await expect(withDbRetry(op, noDelay)).rejects.toBeInstanceOf(
      Prisma.PrismaClientInitializationError
    );
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-connection error', async () => {
    const op = vi.fn().mockRejectedValue(knownError('P2002'));
    await expect(withDbRetry(op, noDelay)).rejects.toBeDefined();
    expect(op).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/db-retry.test.ts`
Expected: FAIL — cannot resolve `./db-retry`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/db-retry.ts`:

```ts
import { Prisma } from '@prisma/client';

/** Codes that mean the connection itself failed. Drives the 503 response. */
const CONNECTION_CODES = new Set(['P1001', 'P1002', 'P1017']);

/**
 * Codes safe to retry: the connection was never established, so the statement
 * provably never executed. P1017 is excluded on purpose — the server closing
 * the connection can happen after a statement was sent, so a retry could
 * duplicate a write.
 */
const RETRYABLE_CODES = new Set(['P1001', 'P1002']);

export function isDbConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return CONNECTION_CODES.has(error.code);
  }
  return false;
}

export function isRetryableDbError(error: unknown): boolean {
  // A client that never initialised never sent anything.
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_CODES.has(error.code);
  }
  return false;
}

const DEFAULT_DELAYS_MS = [1000, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a database operation, retrying only connection failures.
 *
 * Sized against measured behaviour: a suspended Neon compute took roughly 90
 * seconds to wake, so three attempts against a 30s connect_timeout plus these
 * backoffs covers about 95 seconds. A single attempt does not.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; delaysMs?: number[] } = {}
): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const attempts = options.attempts ?? delays.length + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableDbError(error)) throw error;
      lastError = error;
      if (attempt < attempts - 1) {
        console.warn(
          `[db] connection failed (attempt ${attempt + 1}/${attempts}), retrying — ` +
            'the database is probably waking from idle'
        );
        await sleep(delays[attempt] ?? 0);
      }
    }
  }

  throw lastError;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/db-retry.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Raise the connection timeout**

In `.env` (untracked, local) append `&connect_timeout=30` to the existing `DATABASE_URL` value, so it ends `...?sslmode=require&connect_timeout=30`.

Then document it in the tracked `.env.example`, replacing its `DATABASE_URL` line:

```bash
# connect_timeout=30 gives Neon's free tier room to wake from idle suspend.
# Without it, the first request after a quiet period fails mid-handshake.
DATABASE_URL="postgresql://user:password@host.neon.tech/neondb?sslmode=require&connect_timeout=30"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/db-retry.ts src/lib/db-retry.test.ts .env.example
git commit -m "feat: retry database connection failures from free-tier cold starts"
```

---

### Task 4: Shared API error wrapper

**Files:**
- Create: `src/lib/api/handler.ts`
- Create: `src/lib/api/handler.test.ts`

**Interfaces:**
- Consumes: `isDbConnectionError` from Task 3.
- Produces: `class AppError extends Error { constructor(message: string, status: number); readonly status: number }` and `handleRoute(handler)`. Task 5 wraps all four auth routes in `handleRoute`.

| Cause | Status | Client sees |
|---|---|---|
| `ZodError` | 400 | `Invalid request` |
| `AppError` | its own | its own message |
| DB connection failure | 503 | `Service is starting up, please try again` |
| Anything else | 500 | `Something went wrong` |

- [ ] **Step 1: Write the failing test**

Create `src/lib/api/handler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, handleRoute } from './handler';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** A wrapped no-argument route that always throws the given error. */
function route(error: unknown) {
  return handleRoute(async () => {
    throw error;
  });
}

function connectionError() {
  return new Prisma.PrismaClientInitializationError(
    "Can't reach database server at ep-steep-grass.aws.neon.tech:5432",
    '6.19.3'
  );
}

describe('handleRoute', () => {
  it('passes a successful response straight through', async () => {
    const handler = handleRoute(async () => NextResponse.json({ ok: true }));
    const res = await handler();
    expect(res.status).toBe(200);
  });

  it('maps a Zod error to 400 without leaking field internals', async () => {
    const res = await route(new z.ZodError([]))();
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid request' });
  });

  it('maps an AppError to its own status and message', async () => {
    const res = await route(new AppError('Too many requests, try again later', 429))();
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Too many requests, try again later',
    });
  });

  it('maps a database connection failure to 503', async () => {
    const res = await route(connectionError())();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Service is starting up, please try again',
    });
  });

  it('never leaks the database hostname to the client', async () => {
    const res = await route(connectionError())();
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('neon.tech');
    expect(body).not.toContain('Can\'t reach');
  });

  it('maps an unknown error to a generic 500', async () => {
    const res = await route(new Error('inner detail'))();
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('Something went wrong');
    expect(body).not.toContain('inner detail');
  });

  it('returns a request id the server also logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await route(new Error('boom'))();
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(spy.mock.calls.flat().join(' ')).toContain(body.requestId);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/api/handler.test.ts`
Expected: FAIL — cannot resolve `./handler`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/api/handler.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isDbConnectionError } from '@/lib/db-retry';

/** Thrown deliberately by a route when it wants a specific status and message. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Variadic, so one wrapper serves both `GET()` (no arguments) and
// `POST(request)`. A fixed two-parameter signature would force every no-arg
// route to invent parameters it never uses.
type RouteHandler<Args extends unknown[]> = (...args: Args) => Promise<Response>;

/**
 * Wraps a route handler so no failure ever reaches the user raw.
 *
 * The client gets a safe message plus a request id; the server log gets the
 * full error under that same id. Prisma connection errors embed the database
 * hostname in their message, so they are never forwarded verbatim.
 */
export function handleRoute<Args extends unknown[]>(
  handler: RouteHandler<Args>
): RouteHandler<Args> {
  return async (...args: Args): Promise<Response> => {
    const requestId = randomUUID();

    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error(`[${requestId}] validation failed`, error.issues);
        return NextResponse.json({ error: 'Invalid request', requestId }, { status: 400 });
      }

      if (error instanceof AppError) {
        console.error(`[${requestId}] ${error.status}: ${error.message}`);
        return NextResponse.json({ error: error.message, requestId }, { status: error.status });
      }

      if (isDbConnectionError(error)) {
        console.error(`[${requestId}] database connection failed`, error);
        return NextResponse.json(
          { error: 'Service is starting up, please try again', requestId },
          { status: 503 }
        );
      }

      console.error(`[${requestId}] unhandled error`, error);
      return NextResponse.json({ error: 'Something went wrong', requestId }, { status: 500 });
    }
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/api/handler.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api
git commit -m "feat: add shared API error wrapper with safe client messages"
```

---

### Task 5: Migrate the auth routes onto the wrapper

**Files:**
- Modify: `src/app/api/auth/otp/request/route.ts`
- Modify: `src/app/api/auth/otp/verify/route.ts`
- Modify: `src/app/api/auth/me/route.ts`
- Modify: `src/app/api/auth/logout/route.ts`

**Interfaces:**
- Consumes: `handleRoute`, `AppError` (Task 4); `withDbRetry` (Task 3).
- Produces: no new exports. The existing route tests must pass **unchanged** — that is the proof this refactor preserved behaviour.

- [ ] **Step 1: Migrate `otp/request`**

Replace the body of `src/app/api/auth/otp/request/route.ts` from `export async function POST` onward with:

```ts
export const POST = handleRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const parsed = otpRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
  }

  const { phone } = parsed.data;
  const ip = getClientIp(request);

  const [phoneCount, ipCount] = await withDbRetry(() =>
    Promise.all([countRecentOtpRequestsByPhone(phone), countRecentOtpRequestsByIp(ip)])
  );

  if (phoneCount >= PHONE_RATE_LIMIT_PER_HOUR || ipCount >= IP_RATE_LIMIT_PER_HOUR) {
    throw new AppError('Too many requests, try again later', 429);
  }

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await withDbRetry(() =>
    db.otpRequest.create({ data: { phone, ip, codeHash, purpose: 'LOGIN', expiresAt } })
  );

  await sendOtp(phone, code);

  return NextResponse.json({ ok: true });
});
```

Add to the imports:

```ts
import { handleRoute, AppError } from '@/lib/api/handler';
import { withDbRetry } from '@/lib/db-retry';
```

Note the rate-limit branch now throws `AppError` instead of returning — same 429, same message, but it flows through one place.

- [ ] **Step 2: Migrate `otp/verify`**

In `src/app/api/auth/otp/verify/route.ts`, change `export async function POST(request: NextRequest) {` to `export const POST = handleRoute(async (request: NextRequest) => {`, change the closing `}` of the function to `});`, add the same two imports, and wrap each database call in `withDbRetry`:

```ts
const otpRequest = await withDbRetry(() =>
  db.otpRequest.findFirst({
    where: { phone, purpose: 'LOGIN', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
);
```

```ts
await withDbRetry(() =>
  db.otpRequest.update({ where: { id: otpRequest.id }, data: { consumedAt: new Date() } })
);

const user = await withDbRetry(() =>
  db.user.upsert({ where: { phone }, update: {}, create: { phone } })
);
```

Leave the failed-attempt `update` (inside the `if (!isValid)` branch) **unwrapped**. It is a best-effort attempt counter; if the database is unreachable the whole request is failing anyway, and wrapping it adds retry latency to the error path for no benefit.

- [ ] **Step 3: Migrate `me` and `logout`**

`src/app/api/auth/me/route.ts` — wrap the handler and its query:

```ts
export const GET = handleRoute(async () => {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = await withDbRetry(() =>
    db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, phone: true, name: true, role: true },
    })
  );

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return NextResponse.json(user);
});
```

`src/app/api/auth/logout/route.ts` — no database call, so wrapper only:

```ts
export const POST = handleRoute(async () => {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: PASS with zero failures, and **no edits to any existing route test**. If a route test needed changing, the refactor altered behaviour — stop and investigate rather than editing the test.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/auth
git commit -m "refactor: route all auth endpoints through the shared error wrapper"
```

---

### Task 6: Error boundaries

**Files:**
- Create: `src/app/error.tsx`
- Create: `src/app/global-error.tsx`
- Create: `src/app/not-found.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button`, `Card`/`CardContent`/`CardHeader`/`CardTitle` from `@/components/ui/card` — the same components the login page uses.

- [ ] **Step 1: Add the route error boundary**

Create `src/app/error.tsx`. It must be a client component and must offer a working retry:

```tsx
'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side detail stays server-side; this is the client's own record.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            That didn&apos;t work. Please try again — if it keeps happening, wait a moment and
            reload.
          </p>
          <Button onClick={reset} className="w-full">
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

Note: `error.digest` is deliberately not shown. Next.js strips the real message in production and leaves only that hash; showing it to a shopper communicates nothing.

- [ ] **Step 2: Add the root-layout error boundary**

Create `src/app/global-error.tsx`. This one replaces the whole document when the root layout itself fails, so it must render its own `<html>` and `<body>` and cannot rely on the app's components:

```tsx
'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
        <p style={{ marginBottom: '1.5rem' }}>Please reload the page to continue.</p>
        <button
          onClick={reset}
          style={{ padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid #ccc' }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Add the 404 page**

Create `src/app/not-found.tsx`:

```tsx
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            That page doesn&apos;t exist or has moved.
          </p>
          <Button asChild className="w-full">
            <Link href="/">Back to the shop</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: exits 0, and the route list now includes `/_not-found` as before plus the new boundaries compiled into their segments.

- [ ] **Step 5: Commit**

```bash
git add src/app/error.tsx src/app/global-error.tsx src/app/not-found.tsx
git commit -m "feat: add error boundaries and a 404 page"
```

---

### Task 7: Move the seeded admin phone into configuration

**Files:**
- Modify: `prisma/seed.ts` (lines 12–19)
- Modify: `.env.example`

**Interfaces:**
- Produces: optional `ADMIN_PHONE` environment variable. Not added to `src/lib/env.ts`, because `prisma/seed.ts` runs under `tsx` outside the Next.js runtime and must not depend on the app's module graph.

- [ ] **Step 1: Read the phone from the environment**

In `prisma/seed.ts`, replace the `// TODO: replace with the real admin phone number before go-live` comment and the `upsert` that follows it with:

```ts
const PLACEHOLDER_ADMIN_PHONE = '+911234567890';
const adminPhone = process.env.ADMIN_PHONE ?? PLACEHOLDER_ADMIN_PHONE;

if (adminPhone === PLACEHOLDER_ADMIN_PHONE) {
  console.warn(
    `WARNING: seeding the placeholder admin phone ${PLACEHOLDER_ADMIN_PHONE}. ` +
      'Set ADMIN_PHONE to the shop owner\'s real number before go-live.'
  );
}

const admin = await prisma.user.upsert({
  where: { phone: adminPhone },
  update: { role: 'ADMIN' },
  create: { phone: adminPhone, role: 'ADMIN', name: 'Shop Owner' },
});
```

This replaces a silent TODO with a warning that fires on every seed — the difference between a note nobody re-reads and a reminder that keeps arriving.

- [ ] **Step 2: Document the variable**

Add to `.env.example`, under the Phase 1 section:

```bash
# The shop owner's phone, in E.164 format. Seeding without it creates a
# placeholder admin and prints a warning.
ADMIN_PHONE="+919876543210"
```

- [ ] **Step 3: Verify the seed still runs**

Run: `npm run db:seed`
Expected: exits 0 and prints the placeholder warning (no `ADMIN_PHONE` is set locally). The seed is idempotent — Phase 1 confirmed running it twice produces identical output.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts .env.example
git commit -m "feat: seed the admin phone from ADMIN_PHONE instead of a hardcoded placeholder"
```

---

### Task 8: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `lint`, `test`, and `build` scripts already in `package.json`.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    env:
      # Dummy values: they only have to satisfy startup validation. No step in
      # this job contacts a real database.
      DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ci?sslmode=disable'
      JWT_SECRET: 'ci-secret-that-is-long-enough-to-pass-validation'
      SMS_DRIVER: 'console'

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      # The Prisma client is generated code, not checked in — nothing type-checks
      # or builds without this step.
      - run: npx prisma generate

      - run: npm run lint

      - run: npx tsc --noEmit

      - run: npx vitest run

      - run: npm run build
```

The 20-minute timeout is deliberate: type-checking alone took over six minutes on the development machine, so a default-length timeout would flake.

- [ ] **Step 2: Verify each command locally first**

Run each in turn, confirming exit 0 before trusting CI:

```powershell
npm run lint
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: all four exit 0. Fixing a failure locally is far faster than through push-and-wait cycles.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, typecheck, tests and build on every push"
```

---

### Task 9: Client details checklist

**Files:**
- Create: `docs/client-details-needed.md`

- [ ] **Step 1: Write the checklist**

Create `docs/client-details-needed.md`:

```markdown
# Client details still needed

Everything here is **configuration, not code** — the app is built and works
without it. Supplying an item means setting an environment variable, not
changing application logic.

Status: `waiting` (not yet requested), `requested`, `received`, `done`.

## Blocking a real launch

| What | Needed for | Lead time | Status |
|---|---|---|---|
| Shop owner's phone number (E.164, e.g. `+9198…`) | `ADMIN_PHONE` — who can log into `/admin` | none | waiting |
| SMS account (MSG91 or Fast2SMS) | Real OTP delivery | days | waiting |
| TRAI DLT registration — business documents, sender ID, OTP template | Legally required before any transactional SMS sends in India | **weeks** | waiting |
| Shop details: name, address, delivery fee, minimum order value, WhatsApp number | Storefront copy and the `Setting` rows | none | waiting |

Until the SMS items land, `SMS_DRIVER=console` prints the OTP to the server log
instead of texting it. That is fine for a demo and unusable for real customers —
which is why production refuses to start unless `SMS_DRIVER` is set explicitly.

**DLT registration is the critical path.** It is paperwork, it is measured in
weeks, and no amount of finished code shortens it. Start it as early as possible.

## Needed by later phases

| What | Needed for | Phase |
|---|---|---|
| Cloudinary account | Product image upload | 2 |
| Razorpay key id + secret | Online payment | 5 |
| Telegram bot token + chat id | Order alerts to the shop owner | 6 |

## Decisions for the owner, not tasks

- **Hosting plan.** Vercel's free Hobby tier is intended for non-commercial
  projects; a shop selling groceries is commercial. Confirm current terms and
  budget for a paid plan before launch.
- **Database tier.** Neon's free tier suspends after idle, so the first visit
  after a quiet period is slow. The code retries and degrades gracefully, but
  only a paid tier removes the delay. See §6 of the hardening spec.
```

- [ ] **Step 2: Commit**

```bash
git add docs/client-details-needed.md
git commit -m "docs: track outstanding client details and launch blockers"
```

---

### Task 10: End-to-end verification

**Files:** none created — this exercises the whole phase.

- [ ] **Step 1: Full suite and build**

```powershell
npx vitest run
npm run build
```

Expected: zero test failures; build exits 0.

- [ ] **Step 2: Prove misconfiguration fails loudly**

**Do not use `npm run build` for this check.** Measured during Task 1: `next build` does *not* execute the `instrumentation.ts` hook, so a build passes happily with invalid configuration. Boot validation only runs when a server starts. Verify against `next start`:

```powershell
$env:JWT_SECRET = 'tooshort'
$env:PORT = '3005'
npm run start *> boot-check.log
```

Run it with `run_in_background`, give it ~15 seconds, then inspect:

```powershell
Get-Content boot-check.log | Select-String 'JWT_SECRET'
curl.exe -s -o NUL --max-time 20 -w "http_code=%{http_code}`n" http://localhost:3005/login
```

Expected: the log contains `An error occurred while loading instrumentation hook: Invalid environment configuration:` followed by a line naming `JWT_SECRET`, and the request returns **500**.

Note the exact behaviour, confirmed in Task 1: the process keeps listening and serves 500 to every request rather than exiting. That still satisfies the requirement — the failure is total, immediate, and names its cause in the log — but do not expect the process to die, and do not "fix" it so that it does.

Then stop it and restore the environment:

```powershell
Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
Remove-Item Env:\JWT_SECRET, Env:\PORT -ErrorAction SilentlyContinue
Remove-Item boot-check.log -ErrorAction SilentlyContinue
```

- [ ] **Step 3: Start the dev server**

```powershell
npm run dev *> dev-server.log
```

Run it with `run_in_background`, then wait for the port rather than the log — output is buffered and `Ready` can take over 150 seconds on this machine:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

- [ ] **Step 4: Verify the auth flow still works end to end**

**Use `curl.exe`, not `Invoke-WebRequest`.** PowerShell 5.1 refuses to store a `Secure` cookie received over `http://localhost` and silently drops the restricted `Cookie` request header; both produce convincing false 401s. This cost real time in Phase 1.

```powershell
curl.exe -s -X POST -H "content-type: application/json" -d '{\"phone\":\"+911234567890\"}' http://localhost:3000/api/auth/otp/request
Select-String -Path dev-server.log -Pattern '\[dev otp\]' | Select-Object -Last 1
```

Expected: `{"ok":true}` and a `[dev otp] +911234567890: <code>` line — proving the driver layer replaced the old code path without changing observable behaviour.

Then verify and use the session:

```powershell
curl.exe -s -i -X POST -H "content-type: application/json" -d '{\"phone\":\"+911234567890\",\"code\":\"<code>\"}' http://localhost:3000/api/auth/otp/verify
curl.exe -s -o NUL -w "me=%{http_code}`n" -H "Cookie: session=<token>" http://localhost:3000/api/auth/me
curl.exe -s -o NUL -w "admin=%{http_code}`n" -H "Cookie: session=<token>" http://localhost:3000/admin
curl.exe -s -o NUL -w "anon=%{http_code}`n" http://localhost:3000/admin
```

Expected: verify returns `{"role":"ADMIN"}` with a `Set-Cookie`; `me=200`; `admin=200`; `anon=307`.

- [ ] **Step 5: Verify the 404 page**

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/no-such-page
```

Expected: `404`, and opening it in a browser shows the designed card, not a bare Next.js page.

- [ ] **Step 6: Stop the server and clean up**

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
Remove-Item dev-server.log -ErrorAction SilentlyContinue
```

- [ ] **Step 7: Final commit**

```bash
git status
git commit --allow-empty -m "chore: Phase 1.5 (Production Hardening) complete and verified"
```

---

## What's next

Phase 1.5 done means every later phase inherits the same error wrapper, the same retry behaviour, the same configuration discipline, and a CI job that will not let Phase 5 quietly break Phase 1's login. Phase 2 (Admin Catalog) is the next spec — categories, products, variants and image upload — and its routes should be written on `handleRoute` and `withDbRetry` from the first commit rather than retrofitted.
