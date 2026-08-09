import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildAuthUrl, getRedirectUri, exchangeCode } from './google';
import { resetEnvCache } from '@/lib/env';

const ORIGINAL = { ...process.env };

const CONFIGURED = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  APP_URL: 'https://shop.example.in',
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
};

function setEnv(overrides: Record<string, string | undefined> = {}) {
  process.env = { ...ORIGINAL, ...CONFIGURED, ...overrides } as NodeJS.ProcessEnv;
  resetEnvCache();
}

const PROFILE = {
  sub: '108123',
  email: 'customer@example.com',
  email_verified: true,
  name: 'A Customer',
  picture: 'https://lh3.googleusercontent.com/a/abc',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Token endpoint succeeds, userinfo returns `profile`. */
function mockHappyPath(profile: unknown = PROFILE) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ access_token: 'ya29.token' }))
    .mockResolvedValueOnce(jsonResponse(profile));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => setEnv());

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('getRedirectUri', () => {
  it('builds the callback URI from APP_URL, not from the request host', () => {
    expect(getRedirectUri()).toBe('https://shop.example.in/api/auth/google/callback');
  });

  it('fails with a readable message when Google is not configured', () => {
    setEnv({ GOOGLE_CLIENT_ID: undefined });
    expect(() => getRedirectUri()).toThrow(/GOOGLE_CLIENT_ID/);
  });
});

describe('buildAuthUrl', () => {
  it('sends the code flow with the openid scopes and the given state', () => {
    const url = new URL(buildAuthUrl('state-abc'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://shop.example.in/api/auth/google/callback'
    );
  });

  it('forces the account chooser, because shared phones are the norm here', () => {
    expect(new URL(buildAuthUrl('s')).searchParams.get('prompt')).toBe('select_account');
  });
});

describe('exchangeCode', () => {
  it('posts the authorization code with the client credentials', async () => {
    const fetchMock = mockHappyPath();

    await exchangeCode('auth-code-123');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const sent = new URLSearchParams(tokenInit.body as string);
    expect(sent.get('code')).toBe('auth-code-123');
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('client_secret')).toBe('client-secret');
    expect(sent.get('redirect_uri')).toBe('https://shop.example.in/api/auth/google/callback');
  });

  it('calls userinfo with the returned access token and returns the profile', async () => {
    const fetchMock = mockHappyPath();

    const profile = await exchangeCode('auth-code-123');

    const [, userinfoInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((userinfoInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer ya29.token'
    );
    expect(profile.email).toBe('customer@example.com');
    expect(profile.sub).toBe('108123');
  });

  it('throws when the token exchange is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 400)));
    await expect(exchangeCode('x')).rejects.toThrow(/400/);
  });

  it('never puts the client secret in the thrown error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('client-secret', { status: 401 })));
    await expect(exchangeCode('x')).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('client-secret') })
    );
  });

  it('throws when the token response carries no access token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ scope: 'openid' })));
    await expect(exchangeCode('x')).rejects.toThrow(/no access token/);
  });

  it('throws when userinfo is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'ya29.token' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 403));
    vi.stubGlobal('fetch', fetchMock);
    await expect(exchangeCode('x')).rejects.toThrow(/403/);
  });

  it('rejects a profile missing the fields the callback writes to the user row', async () => {
    // Casting the response instead of parsing it would put `undefined` into the
    // email column and fail much later, at the unique index.
    mockHappyPath({ sub: '1', email_verified: true });
    await expect(exchangeCode('x')).rejects.toThrow();
  });
});
