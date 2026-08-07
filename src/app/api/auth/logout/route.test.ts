import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

import { POST as logout } from './route';

describe('POST /api/auth/logout', () => {
  beforeEach(() => cookieStore.delete.mockReset());

  it('clears the session cookie', async () => {
    const response = await logout();
    expect(response.status).toBe(200);
    expect(cookieStore.delete).toHaveBeenCalledWith('session');
  });
});
