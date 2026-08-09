import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  db: { user: { upsert: vi.fn() } },
}));

vi.mock('@/lib/google', async () => {
  const actual = await vi.importActual<typeof import('@/lib/google')>('@/lib/google');
  return { ...actual, exchangeCode: vi.fn() };
});

const cookieStore = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { db } from '@/lib/db';
import { exchangeCode } from '@/lib/google';
import { resetEnvCache } from '@/lib/env';
import { GET as callback } from './route';

const ORIGINAL = { ...process.env };

const PROFILE = {
  sub: '108123',
  email: 'customer@example.com',
  email_verified: true,
  name: 'A Customer',
  picture: 'https://lh3.googleusercontent.com/a/abc',
};

function buildRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/auth/google/callback');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

/** Cookie store holding the state we claim to have issued. */
function withStoredState(state: string | undefined) {
  cookieStore.get.mockImplementation((name: string) =>
    name === 'oauth_state' && state !== undefined ? { value: state } : undefined
  );
}

function location(response: Response): string {
  return response.headers.get('location') ?? '';
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL,
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    APP_URL: 'https://shop.example.in',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
  } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.mocked(db.user.upsert).mockReset();
  vi.mocked(exchangeCode).mockReset();
  cookieStore.set.mockReset();
  cookieStore.get.mockReset();
  cookieStore.delete.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('GET /api/auth/google/callback — state check', () => {
  it('rejects a callback whose state does not match the issued cookie', async () => {
    withStoredState('issued-state');

    const response = await callback(buildRequest({ code: 'c', state: 'forged-state' }));

    expect(location(response)).toContain('/login?error=oauth');
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a callback with no state cookie at all', async () => {
    withStoredState(undefined);

    const response = await callback(buildRequest({ code: 'c', state: 'anything' }));

    expect(location(response)).toContain('/login?error=oauth');
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a callback carrying no authorization code', async () => {
    withStoredState('issued-state');

    const response = await callback(buildRequest({ state: 'issued-state' }));

    expect(location(response)).toContain('/login?error=oauth');
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('consumes the state cookie even when the check fails, so it cannot be replayed', async () => {
    withStoredState('issued-state');

    await callback(buildRequest({ code: 'c', state: 'forged-state' }));

    expect(cookieStore.delete).toHaveBeenCalledWith('oauth_state');
  });
});

describe('GET /api/auth/google/callback — profile handling', () => {
  beforeEach(() => withStoredState('issued-state'));

  it('refuses a Google account whose email is not verified', async () => {
    vi.mocked(exchangeCode).mockResolvedValue({ ...PROFILE, email_verified: false });

    const response = await callback(buildRequest({ code: 'c', state: 'issued-state' }));

    expect(location(response)).toContain('/login?error=unverified');
    expect(db.user.upsert).not.toHaveBeenCalled();
  });

  it('upserts on email so an existing account is adopted, not duplicated', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(PROFILE);
    vi.mocked(db.user.upsert).mockResolvedValue({
      id: 'user_1',
      role: 'CUSTOMER',
      phoneVerifiedAt: null,
    } as never);

    await callback(buildRequest({ code: 'c', state: 'issued-state' }));

    expect(db.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'customer@example.com' } })
    );
  });

  it('issues a session cookie for a good profile', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(PROFILE);
    vi.mocked(db.user.upsert).mockResolvedValue({
      id: 'user_1',
      role: 'CUSTOMER',
      phoneVerifiedAt: null,
    } as never);

    await callback(buildRequest({ code: 'c', state: 'issued-state' }));

    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    expect(cookieStore.set.mock.calls[0][0]).toBe('session');
  });

  it('sends a customer with no verified phone to /verify-phone', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(PROFILE);
    vi.mocked(db.user.upsert).mockResolvedValue({
      id: 'user_1',
      role: 'CUSTOMER',
      phoneVerifiedAt: null,
    } as never);

    const response = await callback(buildRequest({ code: 'c', state: 'issued-state' }));

    expect(location(response)).toBe('https://shop.example.in/verify-phone');
  });

  it('sends a customer with a verified phone to the storefront', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(PROFILE);
    vi.mocked(db.user.upsert).mockResolvedValue({
      id: 'user_1',
      role: 'CUSTOMER',
      phoneVerifiedAt: new Date(),
    } as never);

    const response = await callback(buildRequest({ code: 'c', state: 'issued-state' }));

    expect(location(response)).toBe('https://shop.example.in/');
  });

  it('sends an admin to the dashboard', async () => {
    vi.mocked(exchangeCode).mockResolvedValue(PROFILE);
    vi.mocked(db.user.upsert).mockResolvedValue({
      id: 'user_1',
      role: 'ADMIN',
      phoneVerifiedAt: null,
    } as never);

    const response = await callback(buildRequest({ code: 'c', state: 'issued-state' }));

    expect(location(response)).toBe('https://shop.example.in/admin');
  });

  it('redirects to /login rather than throwing when the exchange fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(exchangeCode).mockRejectedValue(new Error('Google token exchange failed'));

    const response = await callback(buildRequest({ code: 'c', state: 'issued-state' }));

    expect(location(response)).toContain('/login?error=oauth');
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('redirects on the absolute APP_URL, not the internal request host', async () => {
    // Behind Caddy the app sees plain http on localhost; a relative redirect
    // would land the customer on an origin that is not the shop.
    vi.mocked(exchangeCode).mockResolvedValue(PROFILE);
    vi.mocked(db.user.upsert).mockResolvedValue({
      id: 'user_1',
      role: 'CUSTOMER',
      phoneVerifiedAt: null,
    } as never);

    const response = await callback(buildRequest({ code: 'c', state: 'issued-state' }));

    expect(location(response).startsWith('https://shop.example.in')).toBe(true);
  });
});
