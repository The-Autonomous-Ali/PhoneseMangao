import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';

export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 14;

/**
 * The delivery slots a customer may still choose.
 *
 * Full slots are returned rather than hidden, marked with `remaining: 0`. A
 * customer who can see that Saturday morning is full understands the shop is
 * busy; one who sees Saturday missing entirely assumes the site is broken.
 *
 * `remaining` is a snapshot and nothing more. Between rendering it and the
 * order landing, another customer can take the last place — the authoritative
 * check is the conditional UPDATE in bookSlot, which is what actually stops
 * two people claiming one van seat.
 */
export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get('days'));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_DAYS) : DEFAULT_DAYS;

  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const slots = await withDbRetry(() =>
    db.deliverySlot.findMany({
      where: {
        isOpen: true,
        // Past the cutoff the shop can no longer pack it, so it is not an
        // option however much capacity is left.
        cutoffAt: { gt: now },
        date: { lte: until },
      },
      orderBy: [{ date: 'asc' }, { slotType: 'asc' }],
    })
  );

  return NextResponse.json({
    slots: slots.map((slot) => ({
      id: slot.id,
      date: slot.date.toISOString(),
      slotType: slot.slotType,
      cutoffAt: slot.cutoffAt.toISOString(),
      remaining: Math.max(slot.capacity - slot.booked, 0),
    })),
  });
}
