import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { deliverySlot: { findMany: vi.fn() } } }));

import { SlotType } from '@prisma/client';
import { db } from '@/lib/db';
import { getSlotWeek } from './slot-queries';

function slotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's_1',
    date: new Date('2026-08-11T00:00:00Z'),
    slotType: SlotType.MORNING,
    capacity: 20,
    booked: 3,
    isOpen: true,
    cutoffAt: new Date('2026-08-10T16:30:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(db.deliverySlot.findMany).mockReset().mockResolvedValue([] as never);
});

describe('getSlotWeek', () => {
  it('always returns seven days, starting from the date given', async () => {
    const week = await getSlotWeek('2026-08-11');

    expect(week.days).toHaveLength(7);
    expect(week.days[0].date).toBe('2026-08-11');
    expect(week.days[6].date).toBe('2026-08-17');
  });

  it('shows a day with no generated slots as empty rather than skipping it', async () => {
    // A short week would read as "that is the week", hiding the fact that the
    // cron has not run.
    const week = await getSlotWeek('2026-08-11');

    expect(week.days.every((day) => day.slots.length === 0)).toBe(true);
  });

  it('files each slot under its own date', async () => {
    vi.mocked(db.deliverySlot.findMany).mockResolvedValue([
      slotRow({ id: 's_1', date: new Date('2026-08-11T00:00:00Z') }),
      slotRow({ id: 's_2', date: new Date('2026-08-13T00:00:00Z') }),
    ] as never);

    const week = await getSlotWeek('2026-08-11');

    expect(week.days[0].slots.map((s) => s.id)).toEqual(['s_1']);
    expect(week.days[2].slots.map((s) => s.id)).toEqual(['s_2']);
  });

  it('carries capacity and booked through, since both drive the screen', async () => {
    vi.mocked(db.deliverySlot.findMany).mockResolvedValue([
      slotRow({ capacity: 5, booked: 3 }),
    ] as never);

    const [slot] = (await getSlotWeek('2026-08-11')).days[0].slots;

    expect(slot.capacity).toBe(5);
    expect(slot.booked).toBe(3);
    expect(slot.isOpen).toBe(true);
    expect(typeof slot.cutoffAt).toBe('string');
  });

  it('queries exactly the seven-day window', async () => {
    await getSlotWeek('2026-08-11');

    const where = vi.mocked(db.deliverySlot.findMany).mock.calls[0][0]!.where as {
      date: { gte: Date; lte: Date };
    };
    expect(where.date.gte).toEqual(new Date('2026-08-11T00:00:00.000Z'));
    expect(where.date.lte).toEqual(new Date('2026-08-17T00:00:00.000Z'));
  });
});
