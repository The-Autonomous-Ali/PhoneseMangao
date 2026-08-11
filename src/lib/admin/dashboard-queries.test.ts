import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    order: { findMany: vi.fn(), groupBy: vi.fn() },
    variant: { findMany: vi.fn() },
  },
}));

import { Prisma, OrderStatus, PaymentMethod, SlotType } from '@prisma/client';
import { db } from '@/lib/db';
import { getDashboard } from './dashboard-queries';

function delivered(overrides: Record<string, unknown> = {}) {
  return {
    paymentMethod: PaymentMethod.COD,
    finalTotal: new Prisma.Decimal('480'),
    grandTotal: new Prisma.Decimal('520'),
    ...overrides,
  };
}

function upcoming(overrides: Record<string, unknown> = {}) {
  return {
    grandTotal: new Prisma.Decimal('300'),
    slot: { slotType: SlotType.MORNING },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(db.order.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(db.order.groupBy).mockReset().mockResolvedValue([] as never);
  vi.mocked(db.variant.findMany).mockReset().mockResolvedValue([] as never);
});

describe('getDashboard — collected', () => {
  it('sums the settled figure, not the estimate', async () => {
    // The driver handed over finalTotal. grandTotal is what was quoted before
    // anything was weighed, and it is not money anyone received.
    vi.mocked(db.order.findMany).mockResolvedValueOnce([delivered()] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.collected.total).toBe('480.00');
    expect(summary.collected.orders).toBe(1);
  });

  it('splits cash from prepaid, because only one is in the cash box', async () => {
    vi.mocked(db.order.findMany).mockResolvedValueOnce([
      delivered({ paymentMethod: PaymentMethod.COD, finalTotal: new Prisma.Decimal('480') }),
      delivered({ paymentMethod: PaymentMethod.ONLINE, finalTotal: new Prisma.Decimal('320') }),
    ] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.collected.cash).toBe('480.00');
    expect(summary.collected.prepaid).toBe('320.00');
    expect(summary.collected.total).toBe('800.00');
  });

  it('reports zeroes rather than nothing on a day with no deliveries', async () => {
    const summary = await getDashboard('2026-08-11');

    expect(summary.collected).toEqual({
      orders: 0,
      total: '0.00',
      cash: '0.00',
      prepaid: '0.00',
    });
  });

  it('asks only for orders delivered on the day in question', async () => {
    await getDashboard('2026-08-11');

    const where = vi.mocked(db.order.findMany).mock.calls[0][0]!.where as {
      deliveredAt: { gte: Date; lt: Date };
    };
    expect(where.deliveredAt.gte).toEqual(new Date('2026-08-11T00:00:00.000Z'));
    expect(where.deliveredAt.lt).toEqual(new Date('2026-08-12T00:00:00.000Z'));
  });
});

describe('getDashboard — upcoming', () => {
  it('groups what is still to come by slot, at the quoted price', async () => {
    vi.mocked(db.order.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        upcoming({ slot: { slotType: SlotType.MORNING }, grandTotal: new Prisma.Decimal('300') }),
        upcoming({ slot: { slotType: SlotType.MORNING }, grandTotal: new Prisma.Decimal('200') }),
        upcoming({ slot: { slotType: SlotType.EVENING }, grandTotal: new Prisma.Decimal('150') }),
      ] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.upcoming).toEqual([
      { slotType: SlotType.MORNING, orders: 2, estimated: '500.00' },
      { slotType: SlotType.EVENING, orders: 1, estimated: '150.00' },
    ]);
  });
});

describe('getDashboard — needs action', () => {
  it('counts the whole backlog, not just the selected day', async () => {
    // An order left PENDING since yesterday is exactly what has to be seen. A
    // date filter would hide it on the screen built to surface it.
    vi.mocked(db.order.groupBy).mockResolvedValue([
      { status: OrderStatus.PENDING, _count: 2 },
      { status: OrderStatus.CONFIRMED, _count: 5 },
    ] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.needsAction.pending).toBe(2);
    expect(summary.needsAction.confirmed).toBe(5);
    expect(summary.needsAction.packed).toBe(0);

    const args = vi.mocked(db.order.groupBy).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).not.toHaveProperty('placedAt');
    expect(args.where).not.toHaveProperty('deliveredAt');
  });
});

describe('getDashboard — low stock', () => {
  it('lists variants at or below the threshold', async () => {
    vi.mocked(db.variant.findMany).mockResolvedValue([
      { label: '1 kg', stockQty: 3, product: { name: 'Onion' } },
    ] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.lowStock).toEqual([{ productName: 'Onion', variantLabel: '1 kg', stockQty: 3 }]);
  });

  it('excludes untracked stock rather than reporting it as none left', async () => {
    // stockQty null means the shop does not count this line — normal for loose
    // produce. Showing it as "0 left" would bury the real warnings.
    await getDashboard('2026-08-11');

    const where = vi.mocked(db.variant.findMany).mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where.stockQty).toEqual({ not: null, lte: 5 });
  });
});
