import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

const tx = {
  order: { update: vi.fn() },
  orderEvent: { create: vi.fn() },
  orderItem: { findMany: vi.fn() },
  variant: { updateMany: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  db: {
    order: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

import { db } from '@/lib/db';
import { resetEnvCache } from '@/lib/env';
import { POST as webhook } from './route';

const ORIGINAL = { ...process.env };
const WEBHOOK_SECRET = 'webhook-secret';

const ORDER = {
  id: 'order_1',
  slotId: 'slot_1',
  status: 'PENDING',
  paymentStatus: 'UNPAID',
  razorpayOrderId: 'rzp_order_1',
};

function capturedBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_123', order_id: 'rzp_order_1' } } },
    ...overrides,
  });
}

function buildRequest(rawBody: string, signature?: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const sig =
    signature === undefined
      ? createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')
      : signature;
  if (sig) headers['x-razorpay-signature'] = sig;

  return new NextRequest('http://localhost/api/webhooks/razorpay', {
    method: 'POST',
    body: rawBody,
    headers,
  });
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL,
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    RAZORPAY_KEY_ID: 'rzp_test_abc',
    RAZORPAY_KEY_SECRET: 'secret',
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  } as NodeJS.ProcessEnv;
  resetEnvCache();

  vi.mocked(db.order.findUnique).mockReset().mockResolvedValue(ORDER as never);
  vi.mocked(db.$transaction).mockClear();
  tx.order.update.mockReset().mockResolvedValue({});
  tx.orderEvent.create.mockReset().mockResolvedValue({});
  tx.orderItem.findMany.mockReset().mockResolvedValue([{ variantId: 'v1', quantity: 2 }]);
  tx.variant.updateMany.mockReset().mockResolvedValue({ count: 1 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('razorpay webhook — authentication', () => {
  it('rejects an unsigned request', async () => {
    const response = await webhook(buildRequest(capturedBody(), null));

    expect(response.status).toBe(401);
    expect(db.order.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a wrongly signed request', async () => {
    const forged = createHmac('sha256', 'wrong-secret').update(capturedBody()).digest('hex');

    const response = await webhook(buildRequest(capturedBody(), forged));

    expect(response.status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a body altered after signing', async () => {
    // The endpoint marks orders paid, so the bytes that were signed must be
    // the bytes acted on.
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(capturedBody()).digest('hex');
    const tampered = capturedBody({
      payload: { payment: { entity: { id: 'pay_x', order_id: 'rzp_order_OTHER' } } },
    });

    const response = await webhook(buildRequest(tampered, signature));

    expect(response.status).toBe(401);
  });

  it('accepts a correctly signed request', async () => {
    expect((await webhook(buildRequest(capturedBody()))).status).toBe(200);
  });
});

describe('razorpay webhook — payment captured', () => {
  it('marks the order paid and confirmed', async () => {
    await webhook(buildRequest(capturedBody()));

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: {
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        razorpayPaymentId: 'pay_123',
      },
    });
  });

  it('records an event for the audit trail', async () => {
    await webhook(buildRequest(capturedBody()));

    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'order_1', status: 'CONFIRMED', note: 'Payment received' },
    });
  });

  it('decrements stock only when the money has arrived', async () => {
    // An abandoned checkout must not consume stock, so this happens here and
    // not at order creation.
    await webhook(buildRequest(capturedBody()));

    expect(tx.variant.updateMany).toHaveBeenCalledWith({
      where: { id: 'v1', stockQty: { not: null } },
      data: { stockQty: { decrement: 2 } },
    });
  });

  it('leaves untracked stock alone', async () => {
    // Loose produce carries a null count; the predicate keeps it null rather
    // than turning it into a negative number.
    await webhook(buildRequest(capturedBody()));

    const { where } = tx.variant.updateMany.mock.calls[0][0];
    expect(where.stockQty).toEqual({ not: null });
  });
});

describe('razorpay webhook — idempotency', () => {
  it('does nothing when the order is already paid', async () => {
    // Razorpay retries on any non-2xx and can redeliver regardless, so a
    // repeated capture must not decrement stock twice.
    vi.mocked(db.order.findUnique).mockResolvedValue({
      ...ORDER,
      paymentStatus: 'PAID',
    } as never);

    const response = await webhook(buildRequest(capturedBody()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ alreadyProcessed: true });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('acknowledges an event for an order it does not know', async () => {
    // A 4xx would have Razorpay redeliver forever, and no retry can fix it.
    vi.mocked(db.order.findUnique).mockResolvedValue(null as never);

    const response = await webhook(buildRequest(capturedBody()));

    expect(response.status).toBe(200);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('acknowledges events it does not act on', async () => {
    const body = capturedBody({ event: 'payment.authorized' });

    const response = await webhook(buildRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ignored: 'payment.authorized' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a signed body that is not JSON', async () => {
    expect((await webhook(buildRequest('not json'))).status).toBe(400);
  });
});

describe('razorpay webhook — payment failed', () => {
  const failedBody = () =>
    JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: { id: 'pay_9', order_id: 'rzp_order_1', error_description: 'UPI timed out' },
        },
      },
    });

  it('marks the payment failed without cancelling the order', async () => {
    await webhook(buildRequest(failedBody()));

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: { paymentStatus: 'FAILED' },
    });
  });

  it('keeps the delivery slot, since a failed UPI attempt is usually retried', async () => {
    // The expire-unpaid sweep reclaims it if the customer really has gone.
    await webhook(buildRequest(failedBody()));

    const updates = tx.order.update.mock.calls.map(([args]) => args.data);
    expect(updates.every((data: Record<string, unknown>) => data.status === undefined)).toBe(true);
  });

  it('records why the payment failed', async () => {
    await webhook(buildRequest(failedBody()));

    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: expect.stringContaining('UPI timed out') }),
    });
  });

  it('never touches stock on a failed payment', async () => {
    await webhook(buildRequest(failedBody()));
    expect(tx.variant.updateMany).not.toHaveBeenCalled();
  });
});
