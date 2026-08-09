import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const tx = {
  order: { update: vi.fn() },
  orderEvent: { create: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  db: {
    order: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, getSession: vi.fn() };
});

vi.mock('@/lib/otp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/otp')>('@/lib/otp');
  return { ...actual, consumeOtp: vi.fn() };
});

vi.mock('@/lib/slots', () => ({ releaseSlot: vi.fn() }));

import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { consumeOtp } from '@/lib/otp';
import { releaseSlot } from '@/lib/slots';
import { POST as verifyOrderOtp } from './verify-otp/route';
import { POST as cancelOrder } from './cancel/route';

const ORDER = {
  id: 'order_1',
  userId: 'user_1',
  slotId: 'slot_1',
  status: 'PENDING_OTP',
};

function buildRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/orders/order_1/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const params = { params: Promise.resolve({ id: 'order_1' }) };

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ userId: 'user_1', role: 'CUSTOMER' });
  vi.mocked(db.order.findFirst).mockReset().mockResolvedValue(ORDER as never);
  vi.mocked(db.user.findUnique)
    .mockReset()
    .mockResolvedValue({ id: 'user_1', phone: '+919876543210' } as never);
  vi.mocked(consumeOtp).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(releaseSlot).mockReset().mockResolvedValue(undefined);
  vi.mocked(db.$transaction).mockClear();
  tx.order.update.mockReset().mockResolvedValue({ status: 'CONFIRMED' });
  tx.orderEvent.create.mockReset().mockResolvedValue({});
});

describe('POST /api/orders/:id/verify-otp', () => {
  it('requires a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await verifyOrderOtp(buildRequest({ code: '123456' }), params)).status).toBe(401);
  });

  it('scopes the order lookup to the caller', async () => {
    await verifyOrderOtp(buildRequest({ code: '123456' }), params);

    expect(db.order.findFirst).toHaveBeenCalledWith({
      where: { id: 'order_1', userId: 'user_1' },
    });
  });

  it('confirms the order on a correct code', async () => {
    const response = await verifyOrderOtp(buildRequest({ code: '123456' }), params);

    expect(response.status).toBe(200);
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: { status: 'CONFIRMED' },
    });
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'CONFIRMED' }),
    });
  });

  it('scopes the code to COD_CONFIRM, so a login code cannot confirm an order', async () => {
    await verifyOrderOtp(buildRequest({ code: '123456' }), params);
    expect(consumeOtp).toHaveBeenCalledWith('+919876543210', '123456', 'COD_CONFIRM');
  });

  it('rejects an incorrect code without touching the order', async () => {
    vi.mocked(consumeOtp).mockResolvedValue({ ok: false, reason: 'INCORRECT' });

    const response = await verifyOrderOtp(buildRequest({ code: '000000' }), params);

    expect(response.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('treats an already-confirmed order as success, not failure', async () => {
    // A double-submitted form or a retried request should not read as an error.
    vi.mocked(db.order.findFirst).mockResolvedValue({ ...ORDER, status: 'CONFIRMED' } as never);

    const response = await verifyOrderOtp(buildRequest({ code: '123456' }), params);

    expect(response.status).toBe(200);
    expect(consumeOtp).not.toHaveBeenCalled();
  });

  it('refuses to confirm a cancelled order', async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({ ...ORDER, status: 'CANCELLED' } as never);

    expect((await verifyOrderOtp(buildRequest({ code: '123456' }), params)).status).toBe(409);
  });

  it('rejects a malformed code', async () => {
    expect((await verifyOrderOtp(buildRequest({ code: '12' }), params)).status).toBe(400);
  });
});

describe('POST /api/orders/:id/cancel', () => {
  it('requires a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await cancelOrder(buildRequest(), params)).status).toBe(401);
  });

  it('returns 404 for an order belonging to somebody else', async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue(null as never);
    expect((await cancelOrder(buildRequest(), params)).status).toBe(404);
  });

  it.each(['PENDING_OTP', 'PENDING', 'CONFIRMED'])('cancels a %s order', async (status) => {
    vi.mocked(db.order.findFirst).mockResolvedValue({ ...ORDER, status } as never);

    const response = await cancelOrder(buildRequest(), params);

    expect(response.status).toBe(200);
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    });
  });

  it('gives the delivery place back in the same transaction', async () => {
    // Otherwise the van keeps a seat reserved for an order that no longer
    // exists, and the slot shows full for the rest of the day.
    await cancelOrder(buildRequest(), params);

    expect(releaseSlot).toHaveBeenCalledWith('slot_1', tx);
  });

  it.each(['PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'])(
    'refuses to cancel a %s order',
    async (status) => {
      // Loose produce already weighed and bagged cannot go back on the shelf.
      vi.mocked(db.order.findFirst).mockResolvedValue({ ...ORDER, status } as never);

      const response = await cancelOrder(buildRequest(), params);

      expect(response.status).toBe(409);
      expect(releaseSlot).not.toHaveBeenCalled();
    }
  );

  it('is idempotent, so a double tap does not release the slot twice', async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({ ...ORDER, status: 'CANCELLED' } as never);

    const response = await cancelOrder(buildRequest(), params);

    expect(response.status).toBe(200);
    expect(releaseSlot).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('records the customer’s reason', async () => {
    await cancelOrder(buildRequest({ reason: 'Ordered by mistake' }), params);

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: expect.objectContaining({ cancelReason: 'Ordered by mistake' }),
    });
  });
});
