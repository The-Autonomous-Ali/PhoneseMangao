import { z } from 'zod';
import { getEnv } from '@/lib/env';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** How long the CSRF state cookie is good for. One consent screen, no more. */
export const OAUTH_STATE_COOKIE_NAME = 'oauth_state';
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

function requireGoogleConfig(): { clientId: string; clientSecret: string; appUrl: string } {
  const env = getEnv();
  // Validated at boot in production. In development these are frequently unset,
  // and this is where that turns into a readable message instead of Google
  // rendering "invalid_client" on its own error page.
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.APP_URL) {
    throw new Error(
      'Google sign-in is not configured: set APP_URL, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
    );
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    appUrl: env.APP_URL,
  };
}

/**
 * Built from APP_URL rather than the incoming request. Google matches this
 * against the registered URI exactly, so it must not vary with the host header
 * — which an attacker controls and a proxy rewrites.
 */
export function getRedirectUri(): string {
  return `${requireGoogleConfig().appUrl}/api/auth/google/callback`;
}

export function buildAuthUrl(state: string): string {
  const { clientId } = requireGoogleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Shared phones are common here. Without this Google silently reuses the
    // last session, and the second person in the household ends up in the
    // first person's account.
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

// Google documents more fields than this; only these are read. Parsing rather
// than casting means a shape change surfaces as one clear error here instead of
// as `undefined` written into the users table.
const profileSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

export type GoogleProfile = z.infer<typeof profileSchema>;

/**
 * Trades the one-time authorization code for the caller's profile.
 *
 * The access token is used once, here, and never stored: this app authenticates
 * with Google, it does not act on the user's behalf afterwards.
 */
export async function exchangeCode(code: string): Promise<GoogleProfile> {
  const { clientId, clientSecret } = requireGoogleConfig();

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  // Status only: Google's error body echoes the request, which carries the
  // client secret, and this message reaches the server log.
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed with status ${tokenRes.status}`);
  }

  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
  if (!accessToken) throw new Error('Google token exchange returned no access token');

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileRes.ok) {
    throw new Error(`Google userinfo failed with status ${profileRes.status}`);
  }

  return profileSchema.parse(await profileRes.json());
}
