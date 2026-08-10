'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { requireAdmin } from '@/lib/admin-auth';
import { toActionError, type ActionResult } from '@/lib/actions';
import { slotCapacitySchema } from '@/lib/validation/config';

/** 'YYYY-MM-DD'. The column is a calendar day, matched at UTC midnight. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date');

function calendarDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function refresh() {
  revalidatePath('/admin/slots');
}

/**
 * Sets how many orders one slot may take.
 *
 * Deliberately permits a capacity below the slot's current `booked` count. That
 * is the shape of the real request — "we have four already, take no more" — and
 * it needs no special handling: `bookSlot` re-evaluates `booked < capacity`
 * inside its conditional UPDATE, so existing orders stand and new ones stop.
 */
export async function setSlotCapacity(slotId: string, capacity: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const value = slotCapacitySchema.parse(capacity);

    await withDbRetry(() =>
      db.deliverySlot.update({ where: { id: slotId }, data: { capacity: value } })
    );

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setSlotCapacity');
  }
}

/**
 * Opens or closes a single slot.
 *
 * Closing stops new orders and nothing else. Orders already booked into it
 * still have customers expecting a delivery, so cancelling them stays a
 * deliberate, per-order act on the orders screen — the count is shown at the
 * confirm step so the decision is made knowingly.
 */
export async function setSlotOpen(slotId: string, isOpen: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    await withDbRetry(() => db.deliverySlot.update({ where: { id: slotId }, data: { isOpen } }));

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setSlotOpen');
  }
}

/**
 * Opens or closes every slot on one date — a holiday, or the end of one.
 *
 * One statement rather than three, so a half-applied block cannot survive a
 * failure partway through. It takes a boolean rather than being a one-way
 * "block", because a festival gets cancelled and a date blocked by mis-click
 * has to be recoverable: reopening three slots individually is exactly the
 * fiddly step that leaves one of them still closed.
 */
export async function setDateOpen(date: string, isOpen: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();
    const day = dateSchema.parse(date);

    await withDbRetry(() =>
      db.deliverySlot.updateMany({ where: { date: calendarDay(day) }, data: { isOpen } })
    );

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setDateOpen');
  }
}
