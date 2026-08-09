import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';

export const CRON_SECRET_HEADER = 'x-cron-secret';

/**
 * Constant-time check of the shared secret the host crontab sends.
 *
 * Hashing first sidesteps timingSafeEqual's equal-length requirement without
 * leaking the secret's length through a fast-path return, and a plain `===`
 * would leak the matching prefix through its own comparison time.
 */
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const expected = getEnv().CRON_SECRET;
  // No secret configured means no way to tell a legitimate call from anyone
  // else's, so nothing is authorized. Refusing to run a cron job is a missed
  // sweep; running it for a stranger is theirs to trigger at will.
  if (!expected) return false;

  const provided = request.headers.get(CRON_SECRET_HEADER);
  if (!provided) return false;

  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Runs `job` while holding a Postgres advisory lock, or skips it if another
 * run already holds one.
 *
 * Transaction-scoped (`_xact_`) rather than the session-scoped variant, for two
 * reasons. Prisma hands out pooled connections, so a session lock taken on one
 * connection and released on another leaks permanently — the `finally` runs,
 * the lock does not lift, and every later run skips forever. And a process
 * killed mid-job never reaches its `finally` at all. A transaction lock is
 * released by Postgres at commit or rollback either way.
 */
export async function withAdvisoryLock<T>(
  name: string,
  job: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeoutMs?: number } = {}
): Promise<{ skipped: true } | { skipped: false; result: T }> {
  return db.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS locked
      `;
      if (!locked) return { skipped: true as const };

      return { skipped: false as const, result: await job(tx) };
    },
    // Sweeps touch every open order, and the default 5s transaction timeout is
    // sized for request handlers, not for these.
    { timeout: options.timeoutMs ?? 120_000 }
  );
}
