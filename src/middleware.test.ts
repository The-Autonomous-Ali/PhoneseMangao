import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  verifySession: vi.fn(),
  SESSION_COOKIE_NAME: 'session',
}));

import { verifySession } from '@/lib/auth';
import { middleware } from './middleware';

function buildRequest(path: string, cookieValue?: string): NextRequest {
  const request = new NextRequest(new URL(path, 'http://localhost'));
  if (cookieValue) {
    request.cookies.set('session', cookieValue);
  }
  return request;
}

describe('middleware', () => {
  beforeEach(() => {
    vi.mocked(verifySession).mockReset();
  });

  it('redirects to /login when there is no session cookie for a page route', async () => {
    const response = await middleware(buildRequest('/admin'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });

  it('returns 401 when there is no session cookie for an API route', async () => {
    const response = await middleware(buildRequest('/api/admin/orders'));
    expect(response.status).toBe(401);
  });

  it('returns 403 for a valid CUSTOMER session on an API route', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'u1', role: 'CUSTOMER' });
    const response = await middleware(buildRequest('/api/admin/orders', 'token'));
    expect(response.status).toBe(403);
  });

  it('redirects a valid CUSTOMER session away from an admin page', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'u1', role: 'CUSTOMER' });
    const response = await middleware(buildRequest('/admin', 'token'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).not.toContain('/login');
  });

  it('allows a valid ADMIN session through', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'u1', role: 'ADMIN' });
    const response = await middleware(buildRequest('/admin', 'token'));
    expect(response.status).toBe(200);
  });
});
