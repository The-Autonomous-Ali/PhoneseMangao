import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signSession, verifySession, SessionPayload } from './auth';

describe('signSession / verifySession', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long';
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('round-trips a valid payload', async () => {
    const payload: SessionPayload = { userId: 'user_1', role: 'ADMIN' };
    const token = await signSession(payload);
    await expect(verifySession(token)).resolves.toMatchObject(payload);
  });

  it('rejects a tampered token', async () => {
    const token = await signSession({ userId: 'user_1', role: 'CUSTOMER' });
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    await expect(verifySession(tampered)).resolves.toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession({ userId: 'user_1', role: 'CUSTOMER' });
    process.env.JWT_SECRET = 'a-completely-different-secret-value';
    await expect(verifySession(token)).resolves.toBeNull();
  });

  it('throws when JWT_SECRET is not set', async () => {
    delete process.env.JWT_SECRET;
    await expect(signSession({ userId: 'user_1', role: 'CUSTOMER' })).rejects.toThrow(
      'JWT_SECRET is not set'
    );
  });
});
