import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { exchangeCode, OAUTH_STATE_COOKIE_NAME } from '@/lib/google';
import { signSession, setSessionCookie } from '@/lib/auth';
import { getEnv } from '@/lib/env';

/**
 * Builds an absolute redirect target.
 *
 * APP_URL wins over the request URL because behind Caddy and Cloudflare the
 * app sees plain http on an internal host; redirecting relative to that sends
 * the customer to an origin that is not the site.
 */
function appUrl(path: string, request: NextRequest): URL {
  const base = getEnv().APP_URL;
  return base ? new URL(path, base) : new URL(path, request.url);
}

function failure(reason: string, request: NextRequest): NextResponse {
  return NextResponse.redirect(appUrl(`/login?error=${reason}`, request));
}

/**
 * Completes the Google consent flow and issues our own session.
 *
 * Google is only an identity check here. Once the profile is confirmed the
 * handshake ends and everything downstream uses the existing jose session — the
 * access token is not stored and never used again.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const store = await cookies();
  const expected = store.get(OAUTH_STATE_COOKIE_NAME)?.value;

  // CSRF: the state we issued must come back unchanged. Consumed either way, so
  // a captured callback URL cannot be replayed.
  store.delete(OAUTH_STATE_COOKIE_NAME);
  if (!code || !state || !expected || state !== expected) {
    return failure('oauth', request);
  }

  let user;
  try {
    const profile = await exchangeCode(code);

    // An unverified Google email is not proof of anything: anyone can attach an
    // address they do not control. Accepting it would let them claim the row
    // belonging to whoever verifies that address later.
    if (!profile.email_verified) {
      return failure('unverified', request);
    }

    // Upsert on email, so signing in with Google adopts an account that already
    // exists under that address rather than creating a second one. The phone
    // side of the same problem is handled in /api/auth/phone/verify, which
    // merges when a phone-created row turns up.
    user = await withDbRetry(() =>
      db.user.upsert({
        where: { email: profile.email },
        update: { googleId: profile.sub, name: profile.name, imageUrl: profile.picture },
        create: {
          email: profile.email,
          googleId: profile.sub,
          name: profile.name,
          imageUrl: profile.picture,
        },
      })
    );
  } catch (error) {
    // Never surface the raw error: it can carry the client secret or the
    // database host. The log keeps the detail, the customer gets a retry.
    console.error('[auth] Google callback failed', error);
    return failure('oauth', request);
  }

  await setSessionCookie(await signSession({ userId: user.id, role: user.role }));

  // Signed in, but a delivery still needs a number the driver can call, so an
  // unverified customer is routed to /verify-phone before anything else.
  if (user.role === 'ADMIN') return NextResponse.redirect(appUrl('/admin', request));
  return NextResponse.redirect(
    appUrl(user.phoneVerifiedAt ? '/' : '/verify-phone', request)
  );
}
