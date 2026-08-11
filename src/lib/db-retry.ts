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

/**
 * The same set plus P1017, for statements that cannot have a side effect.
 *
 * The doubt about P1017 is entirely about *repeating* something: the server may
 * have closed the connection after receiving the statement, so we cannot know
 * whether it ran. For a read that does not matter, because running it twice and
 * running it once are the same thing. For a write it matters a great deal,
 * which is why the caller has to say which it has.
 */
const READ_RETRYABLE_CODES = new Set([...RETRYABLE_CODES, 'P1017']);

export function isDbConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return CONNECTION_CODES.has(error.code);
  }
  return false;
}

export function isRetryableDbError(
  error: unknown,
  options: { readOnly?: boolean } = {}
): boolean {
  // A client that never initialised never sent anything.
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const codes = options.readOnly ? READ_RETRYABLE_CODES : RETRYABLE_CODES;
    return codes.has(error.code);
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
  options: { attempts?: number; delaysMs?: number[]; readOnly?: boolean } = {}
): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const attempts = options.attempts ?? delays.length + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableDbError(error, { readOnly: options.readOnly })) throw error;
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

/**
 * `withDbRetry` for an operation that only reads.
 *
 * A separate name rather than a `readOnly: true` flag at the call site, because
 * the claim it makes is load-bearing and easy to get wrong in a hurry. Reading
 * `withReadRetry(...)` around something that writes looks wrong; reading
 * `{ readOnly: true }` at the end of an options object does not.
 *
 * What it buys: a dropped connection on a page render stops being a 500 the
 * customer sees. That is not hypothetical — the end-to-end pass hit exactly
 * this on the order-history page, where Neon closed an idle connection and a
 * findMany that was safe to repeat took the page down instead.
 *
 * Only use this where the operation genuinely has no side effect. A transaction
 * that writes is not a read, however much of it is made of selects.
 */
export function withReadRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; delaysMs?: number[] } = {}
): Promise<T> {
  return withDbRetry(operation, { ...options, readOnly: true });
}
