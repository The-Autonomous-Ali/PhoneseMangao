import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = {
  order: { updateMany: vi.fn(), update: vi.fn() },
  orderItem: { update: vi.fn() },
  orderEvent: { create: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  db: {
    order: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock('@/lib/slots', () => ({ releaseSlot: vi.fn() }));
vi.mock('@/lib/notify-order', () => ({ notifyOrderConfirmed: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Prisma, OrderStatus, PaymentMethod, PaymentStatus, UnitType } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin, NotAdminError } from '@/lib/admin-auth';
import { releaseSlot } from '@/lib/slots';
import { notifyOrderConfirmed } from '@/lib/notify-order';
import { advanceOrderStatus, cancelOrder, settleAndDeliver } from './actions';

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o_1',
    slotId: 's_1',
    status: OrderStatus.OUT_FOR_DELIVERY,
    paymentMethod: PaymentMethod.COD,
    paymentStatus: PaymentStatus.UNPAID,
    deliveryFee: new Prisma.Decimal('30'),
    grandTotal: new Prisma.Decimal('120'),
    items: [
      {
        id: 'oi_1',
        productName: 'Potato',
        variantLabel: '5 kg',
        unitType: UnitType.KG,
        unitPrice: new Prisma.Decimal('160'),
        unitValue: new Prisma.Decimal('5'),
        quantity: 1,
        lineTotal: new Prisma.Decimal('160'),
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ userId: 'admin_1', role: 'ADMIN' });
  vi.mocked(releaseSlot).mockReset();
  vi.mocked(notifyOrderConfirmed).mockReset().mockResolvedValue(undefined);
  vi.mocked(db.order.findUnique).mockReset();
  tx.order.updateMany.mockReset().mockResolvedValue({ count: 1 });
  tx.order.update.mockReset();
  tx.orderItem.update.mockReset();
  tx.orderEvent.create.mockReset();
});

describe('advanceOrderStatus', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    const result = await advanceOrderStatus('o_1', OrderStatus.CONFIRMED);

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('moves the order one step and records it', async () => {
    const result = await advanceOrderStatus('o_1', OrderStatus.CONFIRMED);

    expect(result.ok).toBe(true);
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o_1', status: OrderStatus.CONFIRMED },
      data: { status: OrderStatus.PACKED },
    });
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'o_1', status: OrderStatus.PACKED, actorId: 'admin_1', note: null },
    });
  });

  it('refuses to advance an order awaiting its OTP', async () => {
    const result = await advanceOrderStatus('o_1', OrderStatus.PENDING_OTP);

    expect(result.ok).toBe(false);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('reports a lost race instead of writing a second event', async () => {
    // Two tabs open on one order is ordinary in a shop. The conditional write
    // matches nothing the second time, and that is the whole answer.
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    const result = await advanceOrderStatus('o_1', OrderStatus.CONFIRMED);

    expect(result).toEqual({
      ok: false,
      error: 'This order was already updated. Refresh to see where it is.',
    });
    expect(tx.orderEvent.create).not.toHaveBeenCalled();
  });

  it('alerts the owner when an order becomes real', async () => {
    await advanceOrderStatus('o_1', OrderStatus.PENDING);

    expect(notifyOrderConfirmed).toHaveBeenCalledWith('o_1');
  });

  it('stays quiet on every other step', async () => {
    // The owner does not need a message when he himself clicks Packed.
    await advanceOrderStatus('o_1', OrderStatus.CONFIRMED);

    expect(notifyOrderConfirmed).not.toHaveBeenCalled();
  });

  it('does not alert on a transition that lost its race', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await advanceOrderStatus('o_1', OrderStatus.PENDING);

    expect(notifyOrderConfirmed).not.toHaveBeenCalled();
  });

  it('sends a delivery to settlement rather than writing DELIVERED directly', async () => {
    const result = await advanceOrderStatus('o_1', OrderStatus.OUT_FOR_DELIVERY);

    expect(result.ok).toBe(false);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
});

describe('cancelOrder', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    const result = await cancelOrder('o_1', 'Customer called');

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
  });

  it('cancels and gives the delivery place back', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ status: OrderStatus.CONFIRMED }) as never
    );

    const result = await cancelOrder('o_1', 'Out of stock');

    expect(result.ok).toBe(true);
    expect(releaseSlot).toHaveBeenCalledWith('s_1', tx);
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: {
        orderId: 'o_1',
        status: OrderStatus.CANCELLED,
        actorId: 'admin_1',
        note: 'Out of stock',
      },
    });
  });

  it('will not cancel a delivered order', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ status: OrderStatus.DELIVERED }) as never
    );

    const result = await cancelOrder('o_1', 'Too late');

    expect(result.ok).toBe(false);
    expect(releaseSlot).not.toHaveBeenCalled();
  });

  it('does not release the slot twice when the order moved under it', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ status: OrderStatus.CONFIRMED }) as never
    );
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    const result = await cancelOrder('o_1', 'Duplicate click');

    expect(result.ok).toBe(false);
    expect(releaseSlot).not.toHaveBeenCalled();
  });

  it('insists on a reason', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ status: OrderStatus.CONFIRMED }) as never
    );

    const result = await cancelOrder('o_1', '   ');

    expect(result.ok).toBe(false);
    expect(releaseSlot).not.toHaveBeenCalled();
  });
});

describe('settleAndDeliver', () => {
  beforeEach(() => {
    vi.mocked(db.order.findUnique).mockResolvedValue(orderRow() as never);
  });

  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    const result = await settleAndDeliver('o_1', { oi_1: '4.700' });

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('writes the adjusted line and the final total', async () => {
    // 5 kg at Rs 160 is Rs 32/kg, so 4.7 kg is Rs 150.40, plus the Rs 30 fee.
    const result = await settleAndDeliver('o_1', { oi_1: '4.700' });

    expect(result.ok).toBe(true);
    expect(tx.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'oi_1' },
      data: { actualQuantity: '4.700', adjustedTotal: '150.40' },
    });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o_1' },
        data: expect.objectContaining({
          finalTotal: '180.40',
        }),
      })
    );
  });

  it('marks a cash order paid, because the driver collected', async () => {
    await settleAndDeliver('o_1', { oi_1: '4.700' });

    const data = tx.order.update.mock.calls[0][0].data;
    expect(data.paymentStatus).toBe(PaymentStatus.PAID);
    expect(data.deliveredAt).toBeInstanceOf(Date);
  });

  it('leaves an online order alone, absorbing the difference', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ paymentMethod: PaymentMethod.ONLINE, paymentStatus: PaymentStatus.PAID }) as never
    );

    await settleAndDeliver('o_1', { oi_1: '4.700' });

    expect(tx.order.update.mock.calls[0][0].data.paymentStatus).toBeUndefined();
  });

  it('only settles an order that is out for delivery', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ status: OrderStatus.PACKED }) as never
    );

    const result = await settleAndDeliver('o_1', { oi_1: '4.700' });

    expect(result.ok).toBe(false);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('writes a final total even when nothing was adjusted', async () => {
    // A uniformly populated column keeps the revenue query a plain sum.
    const result = await settleAndDeliver('o_1', {});

    expect(result.ok).toBe(true);
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.order.update.mock.calls[0][0].data.finalTotal).toBe('190.00');
  });

  it('rejects a weight that is not a number', async () => {
    const result = await settleAndDeliver('o_1', { oi_1: '4.7kg' });

    expect(result.ok).toBe(false);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});
