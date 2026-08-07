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
    // Tamper the FIRST character of the signature, not the last. An HS256
    // signature is 32 bytes -> 43 base64url chars, so the final char encodes
    // only 4 significant bits and its low 2 bits are padding: swapping e.g.
    // 'Y' (24) for 'a' (26) leaves the decoded bytes identical and the token
    // still verifies. The first char's 6 bits are all significant.
    const [header, payload, signature] = token.split('.');
    const tamperedSignature =
      (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    const tampered = `${header}.${payload}.${tamperedSignature}`;
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
