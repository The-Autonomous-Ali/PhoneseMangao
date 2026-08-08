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
