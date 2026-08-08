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
