import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

/** Accepts either the shared client or a transaction client from `$transaction`. */
type SqlClient = Pick<typeof db, '$queryRaw'> | Prisma.TransactionClient;

/**
 * The slot could not take another order: it filled, closed, or passed its
 * cutoff. Distinct from a database failure — the customer's fix is to pick a
 * different slot, so callers surface this rather than retrying.
 */
export class SlotFullError extends Error {
  constructor(readonly slotId: string) {
    super('SLOT_FULL');
    this.name = 'SlotFullError';
  }
}

/**
 * Claims one delivery place in a slot.
 *
 * Read-then-write overbooks. Two checkouts landing together both read
 * `booked = 19` against a capacity of 20, both decide there is room, and both
 * increment — 21 orders in a 20-order van, discovered at 6am by the person
 * loading it. Wrapping that in a transaction does not help: the default
 * isolation level still lets both read the pre-increment value.
 *
 * So the guard is part of the write. Postgres takes a row lock for the UPDATE,
 * re-evaluates `booked < capacity` against the committed row, and the second
 * writer matches nothing. Zero rows returned is the full answer — no follow-up
 * read, no window in between.
 */
export async function bookSlot(slotId: string, client: SqlClient = db): Promise<void> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    UPDATE "DeliverySlot"
    SET booked = booked + 1
    WHERE id = ${slotId}
      AND "isOpen" = true
      AND booked < capacity
      AND "cutoffAt" > NOW()
    RETURNING id
  `;

  if (rows.length === 0) throw new SlotFullError(slotId);
}

/**
 * Returns a place to a slot, on cancellation or when an unpaid order expires.
 *
 * `booked > 0` is not defensive noise: without it a double release — a cron
 * expiry racing a customer cancelling the same order — drives the counter
 * negative, and the slot then accepts orders forever.
 *
 * Deliberately not conditioned on `isOpen` or `cutoffAt`. A cancellation after
 * the cutoff still has to give the place back, and a closed slot that keeps a
 * phantom booking reads as full to the admin.
 */
export async function releaseSlot(slotId: string, client: SqlClient = db): Promise<void> {
  await client.$queryRaw`
    UPDATE "DeliverySlot"
    SET booked = booked - 1
    WHERE id = ${slotId}
      AND booked > 0
  `;
}
