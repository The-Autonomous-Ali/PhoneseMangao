import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  db: { $transaction: vi.fn(), $queryRaw: vi.fn() },
}));

import { db } from '@/lib/db';
import { resetEnvCache } from '@/lib/env';
import { isAuthorizedCronRequest, withAdvisoryLock, CRON_SECRET_HEADER } from './cron';

const ORIGINAL = { ...process.env };
const SECRET = 'cron-secret-at-least-16';

function setEnv(overrides: Record<string, string | undefined> = {}) {
  process.env = {
    ...ORIGINAL,
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    CRON_SECRET: SECRET,
    ...overrides,
  } as NodeJS.ProcessEnv;
  resetEnvCache();
}

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cron/expire-unpaid', { method: 'POST', headers });
}

beforeEach(() => setEnv());

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('isAuthorizedCronRequest', () => {
  it('accepts the configured secret', () => {
    expect(isAuthorizedCronRequest(buildRequest({ [CRON_SECRET_HEADER]: SECRET }))).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(isAuthorizedCronRequest(buildRequest({ [CRON_SECRET_HEADER]: 'nope' }))).toBe(false);
  });

  it('rejects a request with no header at all', () => {
    expect(isAuthorizedCronRequest(buildRequest())).toBe(false);
  });

  it('rejects a prefix of the real secret', () => {
    const prefix = SECRET.slice(0, -1);
    expect(isAuthorizedCronRequest(buildRequest({ [CRON_SECRET_HEADER]: prefix }))).toBe(false);
  });

  it('authorizes nobody when no secret is configured', () => {
    // Otherwise an unset CRON_SECRET in development would leave these routes
    // open to anyone who can reach the app.
    setEnv({ CRON_SECRET: undefined });
    expect(isAuthorizedCronRequest(buildRequest({ [CRON_SECRET_HEADER]: '' }))).toBe(false);
    expect(isAuthorizedCronRequest(buildRequest())).toBe(false);
  });
});

/** Stands in for Prisma's interactive transaction client. */
function mockTransaction(locked: boolean) {
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ locked }]) };
  vi.mocked(db.$transaction).mockImplementation((async (
    fn: (client: typeof tx) => unknown
  ) => fn(tx)) as never);
  return tx;
}

describe('withAdvisoryLock', () => {
  it('runs the job when the lock is granted', async () => {
    mockTransaction(true);
    const job = vi.fn().mockResolvedValue('done');

    const outcome = await withAdvisoryLock('expire-unpaid', job);

    expect(job).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ skipped: false, result: 'done' });
  });

  it('skips the job when another run holds the lock', async () => {
    mockTransaction(false);
    const job = vi.fn();

    const outcome = await withAdvisoryLock('expire-unpaid', job);

    expect(job).not.toHaveBeenCalled();
    expect(outcome).toEqual({ skipped: true });
  });

  it('takes a transaction-scoped lock, which a pooled connection cannot leak', async () => {
    // A session lock taken on one pooled connection and released on another
    // never lifts, and every later run skips forever.
    const tx = mockTransaction(true);

    await withAdvisoryLock('expire-unpaid', vi.fn());

    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('pg_try_advisory_xact_lock');
    expect(values).toEqual(['expire-unpaid']);
  });

  it('runs the job on the same transaction client that holds the lock', async () => {
    const tx = mockTransaction(true);
    const job = vi.fn();

    await withAdvisoryLock('expire-unpaid', job);

    expect(job).toHaveBeenCalledWith(tx);
  });

  it('raises the transaction timeout above the request-handler default', async () => {
    mockTransaction(true);

    await withAdvisoryLock('expire-unpaid', vi.fn());

    const [, options] = vi.mocked(db.$transaction).mock.calls[0] as [unknown, { timeout: number }];
    expect(options.timeout).toBeGreaterThanOrEqual(60_000);
  });
});
