import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { buildAuthUrl, OAUTH_STATE_COOKIE_NAME, OAUTH_STATE_MAX_AGE_SECONDS } from '@/lib/google';

/**
 * Kicks off the Google consent flow.
 *
 * The random `state` is stored in an httpOnly cookie and echoed back by Google
 * on the callback. An attacker can forge a request to our callback URL, but
 * cannot forge this cookie, so the two failing to match is what marks the
 * request as not ours. See the callback for the comparison.
 */
export async function GET() {
  const state = randomBytes(16).toString('hex');

  (await cookies()).set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: true,
    // 'lax', not 'strict': the callback arrives as a top-level redirect from
    // accounts.google.com. A strict cookie would not be sent with it, and every
    // sign-in would fail the state check.
    sameSite: 'lax',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    path: '/',
  });

  return NextResponse.redirect(buildAuthUrl(state));
}
