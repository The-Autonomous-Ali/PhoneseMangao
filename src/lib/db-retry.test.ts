import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { isDbConnectionError, isRetryableDbError, withDbRetry, withReadRetry } from './db-retry';

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

  it('does not retry P1017 through the wrapper, because the write may have landed', async () => {
    const op = vi.fn().mockRejectedValue(knownError('P1017'));
    await expect(withDbRetry(op, noDelay)).rejects.toBeDefined();
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryableDbError — read-only', () => {
  it('adds P1017 to what may be retried', () => {
    // The reason P1017 is excluded by default is that the server can close a
    // connection *after* a statement was sent, so a retry could duplicate a
    // write. A read has no write to duplicate.
    expect(isRetryableDbError(knownError('P1017'), { readOnly: true })).toBe(true);
  });

  it('still retries the codes that were already safe', () => {
    expect(isRetryableDbError(knownError('P1001'), { readOnly: true })).toBe(true);
    expect(isRetryableDbError(initError(), { readOnly: true })).toBe(true);
  });

  it('does not widen the net to ordinary query errors', () => {
    // Read-only says the statement is safe to repeat, not that every failure is
    // worth repeating. A malformed query fails identically the second time.
    expect(isRetryableDbError(knownError('P2002'), { readOnly: true })).toBe(false);
    expect(isRetryableDbError(knownError('P2025'), { readOnly: true })).toBe(false);
    expect(isRetryableDbError(new Error('nope'), { readOnly: true })).toBe(false);
  });
});

describe('withReadRetry', () => {
  const noDelay = { delaysMs: [0, 0] };

  it('recovers from a dropped connection instead of surfacing a 500', async () => {
    // The exact failure a customer hit on /orders: Neon closed an idle
    // connection, and the page fell over on a query that was safe to repeat.
    const op = vi.fn().mockRejectedValueOnce(knownError('P1017')).mockResolvedValue('rows');

    await expect(withReadRetry(op, noDelay)).resolves.toBe('rows');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('still gives up eventually rather than hammering a dead database', async () => {
    const op = vi.fn().mockRejectedValue(knownError('P1017'));

    await expect(withReadRetry(op, noDelay)).rejects.toBeDefined();
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('does not retry a genuine query error', async () => {
    const op = vi.fn().mockRejectedValue(knownError('P2002'));

    await expect(withReadRetry(op, noDelay)).rejects.toBeDefined();
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('returns the value untouched when nothing goes wrong', async () => {
    const op = vi.fn().mockResolvedValue({ id: 'x' });

    await expect(withReadRetry(op, noDelay)).resolves.toEqual({ id: 'x' });
    expect(op).toHaveBeenCalledTimes(1);
  });
});
