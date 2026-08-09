import { NextRequest, NextResponse } from 'next/server';
import { SlotType, type Prisma } from '@prisma/client';
import { isAuthorizedCronRequest, withAdvisoryLock } from '@/lib/cron';

/** How far ahead slots exist. Long enough to plan, short enough to change. */
const DAYS_AHEAD = 7;

/** Orders one van can carry in a single window. Not exported: a route module
 *  may only export handlers and Next's own config keys. */
const SLOT_CAPACITY = 20;

/**
 * Ordering cut-offs, as hours from midnight IST on the delivery date. Negative
 * means the evening before: a morning delivery has to be packed the night
 * before, so its orders close at 22:00 the previous day.
 */
const CUTOFF_HOURS_IST: Record<SlotType, number> = {
  [SlotType.MORNING]: -2,
  [SlotType.AFTERNOON]: 9,
  [SlotType.EVENING]: 14,
};

// The shop, its customers and its drivers are all in one timezone. The server
// is not necessarily — a container runs UTC unless told otherwise — so the
// offset is applied explicitly rather than trusting the host clock's zone.
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** Midnight IST on `date`, as the UTC instant Postgres will store. */
function istMidnightUtc(date: Date): Date {
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return new Date(utcMidnight - IST_OFFSET_MINUTES * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Creates the next week of delivery slots. Runs daily at 00:30 IST.
 *
 * Idempotent by construction: `@@unique([date, slotType])` plus skipDuplicates
 * means a retry, a double-fire, or a manual run adds nothing. That matters
 * because the crontab has no memory of whether the last run succeeded.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const today = new Date();
  const rows: Prisma.DeliverySlotCreateManyInput[] = [];

  for (let offset = 0; offset < DAYS_AHEAD; offset++) {
    const date = istMidnightUtc(addDays(today, offset));
    for (const slotType of Object.values(SlotType)) {
      rows.push({
        date,
        slotType,
        capacity: SLOT_CAPACITY,
        cutoffAt: new Date(date.getTime() + CUTOFF_HOURS_IST[slotType] * 60 * 60 * 1000),
      });
    }
  }

  const outcome = await withAdvisoryLock('generate-slots', async (tx) => {
    const { count } = await tx.deliverySlot.createMany({ data: rows, skipDuplicates: true });
    return count;
  });

  if (outcome.skipped) {
    return NextResponse.json({ skipped: true });
  }

  console.log(`[cron] generate-slots created ${outcome.result} slot(s)`);
  return NextResponse.json({ created: outcome.result });
}
