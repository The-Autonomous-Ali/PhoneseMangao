import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Never cached, and never prerendered at build time: a health check answered
// from a cache reports the health of the cache.
export const dynamic = 'force-dynamic';

/**
 * What UptimeRobot polls.
 *
 * Touches the database on purpose. A check that only proves Next is listening
 * would stay green through the failure that actually takes the shop down —
 * Postgres gone, disk full, connection pool exhausted — which on a free tier
 * with no SLA is the failure worth being paged for.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    // The message can carry the database host and credentials, so it goes to
    // the log and not into a response any monitor can read.
    console.error('[health] database check failed', error);
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503 });
  }
}
