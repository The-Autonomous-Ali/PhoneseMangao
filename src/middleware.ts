import { NextRequest, NextResponse } from 'next/server';
import { verifySession, signSession, SESSION_COOKIE_NAME } from '@/lib/auth';

export const config = {
  // Every route, so a customer browsing the catalog keeps their session alive.
  // Only build output and static assets are excluded: they need no session, and
  // attaching a Set-Cookie to them would make them uncacheable.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|webmanifest)$).*)'],
};

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, same as auth.ts

/**
 * Routes that own the session cookie themselves. Login, logout and phone
 * verification each write their own Set-Cookie, and a merge or a logout changes
 * which value is correct. Refreshing here too would put two Set-Cookie headers
 * for the same name on one response — and if ours landed last, logout would not
 * log anybody out.
 */
function managesItsOwnSession(pathname: string): boolean {
  return pathname.startsWith('/api/auth');
}

function isAdminRoute(pathname: string): { page: boolean; api: boolean } {
  return {
    page: pathname === '/admin' || pathname.startsWith('/admin/'),
    api: pathname === '/api/admin' || pathname.startsWith('/api/admin/'),
  };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  const admin = isAdminRoute(pathname);

  // The gate stays scoped to admin paths. The matcher above covers the whole
  // site now, so anything broader here would redirect anonymous shoppers away
  // from the storefront — including away from /login itself.
  if (admin.page || admin.api) {
    if (!session) {
      if (admin.api) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (session.role !== 'ADMIN') {
      if (admin.api) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  const response = NextResponse.next();

  // Rolling expiry. The cookie's 30 days used to count from login, so a weekly
  // customer was signed out on day 31 regardless of how often they came back.
  // Re-signing on each request restarts the clock from their last visit.
  if (session && !managesItsOwnSession(pathname)) {
    response.cookies.set(SESSION_COOKIE_NAME, await signSession(session), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: '/',
    });
  }

  return response;
}
