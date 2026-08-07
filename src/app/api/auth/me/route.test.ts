import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: vi.fn() } },
}));

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

import { db } from '@/lib/db';
import { signSession } from '@/lib/auth';
import { GET as me } from './route';

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long';
    cookieStore.get.mockReset();
    vi.mocked(db.user.findUnique).mockReset();
  });

  it('returns 401 when there is no session cookie', async () => {
    cookieStore.get.mockReturnValue(undefined);
    const response = await me();
    expect(response.status).toBe(401);
  });

  it('returns the user for a valid session', async () => {
    const token = await signSession({ userId: 'user_1', role: 'ADMIN' });
    cookieStore.get.mockReturnValue({ value: token });
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'user_1',
      phone: '+919876543210',
      name: null,
      role: 'ADMIN',
    } as never);

    const response = await me();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'user_1',
      phone: '+919876543210',
      name: null,
      role: 'ADMIN',
    });
  });
});
