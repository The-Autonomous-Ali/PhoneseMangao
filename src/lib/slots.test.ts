import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { $queryRaw: vi.fn() } }));

import { db } from '@/lib/db';
import { bookSlot, releaseSlot, SlotFullError } from './slots';

/** The SQL text the tagged template produced, with the interpolations removed. */
function lastSql(): string {
  const [strings] = vi.mocked(db.$queryRaw).mock.calls.at(-1) as [TemplateStringsArray];
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

function lastValues(): unknown[] {
  const [, ...values] = vi.mocked(db.$queryRaw).mock.calls.at(-1) as [
    TemplateStringsArray,
    ...unknown[],
  ];
  return values;
}

beforeEach(() => {
  vi.mocked(db.$queryRaw).mockReset();
});

describe('bookSlot', () => {
  it('resolves when the update claimed a place', async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ id: 'slot_1' }] as never);
    await expect(bookSlot('slot_1')).resolves.toBeUndefined();
  });

  it('throws SlotFullError when the update matched no row', async () => {
    // Zero rows is the whole answer: full, closed, or past cutoff. There is no
    // follow-up read, so there is no window for the state to change underneath.
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);

    await expect(bookSlot('slot_1')).rejects.toBeInstanceOf(SlotFullError);
  });

  it('names the slot on the error so the caller can offer alternatives', async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);
    await expect(bookSlot('slot_9')).rejects.toMatchObject({ slotId: 'slot_9' });
  });

  it('increments and guards in a single statement, never read-then-write', async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ id: 'slot_1' }] as never);

    await bookSlot('slot_1');

    const sql = lastSql();
    expect(sql).toContain('UPDATE "DeliverySlot"');
    expect(sql).toContain('SET booked = booked + 1');
    expect(sql).toContain('booked < capacity');
    expect(sql).toContain('"isOpen" = true');
    expect(sql).toContain('"cutoffAt" > NOW()');
    expect(sql).toContain('RETURNING id');
  });

  it('passes the slot id as a bound parameter, not as interpolated text', async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ id: 'x' }] as never);

    await bookSlot("slot'; DROP TABLE \"Order\"; --");

    expect(lastValues()).toEqual(["slot'; DROP TABLE \"Order\"; --"]);
    expect(lastSql()).not.toContain('DROP TABLE');
  });

  it('runs on the transaction client when one is given', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 'slot_1' }]) };

    await bookSlot('slot_1', tx as never);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('releaseSlot', () => {
  it('decrements the counter', async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);

    await releaseSlot('slot_1');

    expect(lastSql()).toContain('SET booked = booked - 1');
  });

  it('refuses to drive the counter below zero', async () => {
    // A cron expiry racing a customer cancellation releases the same order
    // twice; a negative counter would make the slot accept orders forever.
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);

    await releaseSlot('slot_1');

    expect(lastSql()).toContain('booked > 0');
  });

  it('releases regardless of cutoff, since a late cancellation still frees a place', async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);

    await releaseSlot('slot_1');

    expect(lastSql()).not.toContain('cutoffAt');
    expect(lastSql()).not.toContain('isOpen');
  });

  it('does not throw when the slot was already at zero', async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);
    await expect(releaseSlot('slot_1')).resolves.toBeUndefined();
  });
});
