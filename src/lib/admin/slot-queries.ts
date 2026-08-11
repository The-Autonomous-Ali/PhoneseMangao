import { SlotType } from '@prisma/client';
import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';

export interface AdminSlot {
  id: string;
  slotType: SlotType;
  capacity: number;
  booked: number;
  isOpen: boolean;
  /** ISO string; a Date cannot cross into a client component. */
  cutoffAt: string;
}

export interface SlotDay {
  /** 'YYYY-MM-DD' — a calendar day, which is what the column stores. */
  date: string;
  /** Empty when the cron has not generated this day yet. */
  slots: AdminSlot[];
}

export interface SlotWeek {
  from: string;
  days: SlotDay[];
}

const DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A `@db.Date` column means a calendar day, so it is matched at UTC midnight. */
function calendarDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * A week of delivery slots for the admin grid.
 *
 * Days the cron has not reached come back with an empty `slots` array rather
 * than being left out. A short week would read as "that is the week", which is
 * exactly the wrong impression when the real story is that slot generation has
 * stopped running.
 */
export async function getSlotWeek(fromDate: string): Promise<SlotWeek> {
  const from = calendarDay(fromDate);
  const to = new Date(from.getTime() + (DAYS - 1) * DAY_MS);

  const slots = await withReadRetry(() =>
    db.deliverySlot.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }, { slotType: 'asc' }],
    })
  );

  const byDay = new Map<string, AdminSlot[]>();
  for (const slot of slots) {
    const key = isoDay(slot.date);
    const list = byDay.get(key) ?? [];
    list.push({
      id: slot.id,
      slotType: slot.slotType,
      capacity: slot.capacity,
      booked: slot.booked,
      isOpen: slot.isOpen,
      cutoffAt: slot.cutoffAt.toISOString(),
    });
    byDay.set(key, list);
  }

  const days: SlotDay[] = [];
  for (let offset = 0; offset < DAYS; offset++) {
    const date = isoDay(new Date(from.getTime() + offset * DAY_MS));
    days.push({ date, slots: byDay.get(date) ?? [] });
  }

  return { from: fromDate, days };
}
