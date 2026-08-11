import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus } from '@prisma/client';
import { takeStock, returnStock, hasTakenStock } from './stock';

const tx = {
  orderItem: { findMany: vi.fn() },
  variant: { updateMany: vi.fn() },
};

const client = tx as unknown as Parameters<typeof takeStock>[1];

beforeEach(() => {
  tx.orderItem.findMany.mockReset().mockResolvedValue([
    { variantId: 'v_rice', quantity: 2 },
    { variantId: 'v_onion', quantity: 1 },
  ]);
  tx.variant.updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('hasTakenStock', () => {
  it('is true from the moment an order is confirmed', () => {
    // Confirmation is when stock comes down, for cash and card alike.
    expect(hasTakenStock(OrderStatus.CONFIRMED)).toBe(true);
    expect(hasTakenStock(OrderStatus.PACKED)).toBe(true);
    expect(hasTakenStock(OrderStatus.OUT_FOR_DELIVERY)).toBe(true);
    expect(hasTakenStock(OrderStatus.DELIVERED)).toBe(true);
  });

  it('is false before it, so an unconfirmed order gives nothing back', () => {
    // An abandoned checkout never consumed stock. Returning it on cancel would
    // invent inventory out of nothing.
    expect(hasTakenStock(OrderStatus.PENDING_OTP)).toBe(false);
    expect(hasTakenStock(OrderStatus.PENDING)).toBe(false);
    expect(hasTakenStock(OrderStatus.CANCELLED)).toBe(false);
    expect(hasTakenStock(OrderStatus.FAILED)).toBe(false);
  });
});

describe('takeStock', () => {
  it('decrements each line by the quantity ordered', async () => {
    await takeStock('o_1', client);

    expect(tx.variant.updateMany).toHaveBeenCalledWith({
      where: { id: 'v_rice', stockQty: { not: null } },
      data: { stockQty: { decrement: 2 } },
    });
    expect(tx.variant.updateMany).toHaveBeenCalledWith({
      where: { id: 'v_onion', stockQty: { not: null } },
      data: { stockQty: { decrement: 1 } },
    });
  });

  it('leaves untracked stock alone', async () => {
    // A null stockQty means the shop does not count that line, which is the
    // normal case for loose produce. The guard is in the WHERE so an untracked
    // variant is matched by nothing rather than driven negative.
    await takeStock('o_1', client);

    for (const call of tx.variant.updateMany.mock.calls) {
      expect(call[0].where.stockQty).toEqual({ not: null });
    }
  });

  it('reads the lines of the order it was given', async () => {
    await takeStock('o_1', client);

    expect(tx.orderItem.findMany).toHaveBeenCalledWith({
      where: { orderId: 'o_1' },
      select: { variantId: true, quantity: true },
    });
  });

  it('does nothing on an order with no lines', async () => {
    tx.orderItem.findMany.mockResolvedValue([]);

    await takeStock('o_1', client);

    expect(tx.variant.updateMany).not.toHaveBeenCalled();
  });
});

describe('returnStock', () => {
  it('increments each line by the quantity ordered', async () => {
    await returnStock('o_1', client);

    expect(tx.variant.updateMany).toHaveBeenCalledWith({
      where: { id: 'v_rice', stockQty: { not: null } },
      data: { stockQty: { increment: 2 } },
    });
    expect(tx.variant.updateMany).toHaveBeenCalledWith({
      where: { id: 'v_onion', stockQty: { not: null } },
      data: { stockQty: { increment: 1 } },
    });
  });

  it('leaves untracked stock alone', async () => {
    await returnStock('o_1', client);

    for (const call of tx.variant.updateMany.mock.calls) {
      expect(call[0].where.stockQty).toEqual({ not: null });
    }
  });
});
