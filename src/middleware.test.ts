import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth', () => ({
  verifySession: vi.fn(),
  signSession: vi.fn(async () => 'refreshed-token'),
  SESSION_COOKIE_NAME: 'session',
}));

import { verifySession, signSession } from '@/lib/auth';
import { middleware } from './middleware';

function buildRequest(path: string, cookieValue?: string): NextRequest {
  const request = new NextRequest(new URL(path, 'http://localhost'));
  if (cookieValue) {
    request.cookies.set('session', cookieValue);
  }
  return request;
}

/** The Set-Cookie the middleware attached for the session, if any. */
function sessionCookie(response: Response) {
  return (response as ReturnType<typeof NextResponse.next>).cookies.get('session');
}

describe('middleware', () => {
  beforeEach(() => {
    vi.mocked(verifySession).mockReset();
    vi.mocked(signSession).mockClear();
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

describe('middleware — public routes', () => {
  beforeEach(() => {
    vi.mocked(verifySession).mockReset();
    vi.mocked(signSession).mockClear();
  });

  // The matcher now covers the whole site so sessions can be refreshed
  // anywhere. That makes it this handler's job to let anonymous traffic past.
  it.each(['/', '/login', '/products/tomatoes', '/api/auth/otp/request'])(
    'lets an anonymous visitor reach %s',
    async (path) => {
      const response = await middleware(buildRequest(path));
      expect(response.status).toBe(200);
    }
  );

  it('does not redirect an anonymous visitor to /login from the storefront', async () => {
    const response = await middleware(buildRequest('/'));
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets a CUSTOMER session reach the storefront', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'u1', role: 'CUSTOMER' });
    const response = await middleware(buildRequest('/', 'token'));
    expect(response.status).toBe(200);
  });
});

describe('middleware — rolling session refresh', () => {
  beforeEach(() => {
    vi.mocked(verifySession).mockReset();
    vi.mocked(signSession).mockClear();
  });

  it('re-issues the cookie so the 30 days count from the last visit', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'u1', role: 'CUSTOMER' });

    const response = await middleware(buildRequest('/', 'token'));

    expect(signSession).toHaveBeenCalledWith({ userId: 'u1', role: 'CUSTOMER' });
    expect(sessionCookie(response)).toMatchObject({
      value: 'refreshed-token',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
  });

  it('refreshes for an admin who passed the role gate', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'u1', role: 'ADMIN' });
    const response = await middleware(buildRequest('/admin', 'token'));
    expect(sessionCookie(response)?.value).toBe('refreshed-token');
  });

  it('issues nothing for an anonymous visitor', async () => {
    const response = await middleware(buildRequest('/'));
    expect(signSession).not.toHaveBeenCalled();
    expect(sessionCookie(response)).toBeUndefined();
  });

  it.each(['/api/auth/logout', '/api/auth/phone/verify', '/api/auth/otp/verify'])(
    'leaves %s to write its own session cookie',
    async (path) => {
      // These routes clear or replace the session. A refresh here would add a
      // second Set-Cookie for the same name, and logout would not stick.
      vi.mocked(verifySession).mockResolvedValue({ userId: 'u1', role: 'CUSTOMER' });

      const response = await middleware(buildRequest(path, 'token'));

      expect(signSession).not.toHaveBeenCalled();
      expect(sessionCookie(response)).toBeUndefined();
    }
  );

  it('does not refresh on a response that redirects away for lack of a role', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'u1', role: 'CUSTOMER' });
    const response = await middleware(buildRequest('/admin', 'token'));
    expect(response.status).toBe(307);
    expect(signSession).not.toHaveBeenCalled();
  });
});
