import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cron', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cron')>('@/lib/cron');
  return { ...actual, withAdvisoryLock: vi.fn() };
});

vi.mock('@/lib/slots', () => ({ releaseSlot: vi.fn() }));

import { withAdvisoryLock, CRON_SECRET_HEADER } from '@/lib/cron';
import { releaseSlot } from '@/lib/slots';
import { resetEnvCache } from '@/lib/env';
import { POST as expireUnpaid } from './route';

const ORIGINAL = { ...process.env };
const SECRET = 'cron-secret-at-least-16';

const STALE_ORDERS = [
  { id: 'order_1', slotId: 'slot_a', paymentMethod: 'ONLINE' },
  { id: 'order_2', slotId: 'slot_b', paymentMethod: 'ONLINE' },
];

const tx = {
  order: { findMany: vi.fn(), update: vi.fn() },
  orderEvent: { create: vi.fn() },
};

/** Runs the job body against the fake transaction client. */
function runJob(found = STALE_ORDERS) {
  tx.order.findMany.mockResolvedValue(found);
  vi.mocked(withAdvisoryLock).mockImplementation((async (
    _name: string,
    job: (client: typeof tx) => Promise<number>
  ) => ({ skipped: false, result: await job(tx) })) as never);
}

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cron/expire-unpaid', { method: 'POST', headers });
}

const authorized = () => buildRequest({ [CRON_SECRET_HEADER]: SECRET });

beforeEach(() => {
  process.env = {
    ...ORIGINAL,
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    CRON_SECRET: SECRET,
  } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.mocked(withAdvisoryLock).mockReset();
  vi.mocked(releaseSlot).mockReset();
  tx.order.findMany.mockReset();
  tx.order.update.mockReset();
  tx.orderEvent.create.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('POST /api/cron/expire-unpaid — authorization', () => {
  it('rejects a request without the cron secret', async () => {
    const response = await expireUnpaid(buildRequest());
    expect(response.status).toBe(401);
    expect(withAdvisoryLock).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong cron secret', async () => {
    const response = await expireUnpaid(buildRequest({ [CRON_SECRET_HEADER]: 'wrong' }));
    expect(response.status).toBe(401);
  });
});

describe('POST /api/cron/expire-unpaid — sweep', () => {
  /** The two independent arms of the sweep, by payment method. */
  function sweepArms() {
    const { where } = tx.order.findMany.mock.calls[0][0];
    return {
      online: where.OR.find((arm: { paymentMethod: string }) => arm.paymentMethod === 'ONLINE'),
      cod: where.OR.find((arm: { paymentMethod: string }) => arm.paymentMethod === 'COD'),
    };
  }

  it('sweeps online orders on payment status, past the payment window', async () => {
    runJob();

    await expireUnpaid(authorized());

    const { online } = sweepArms();
    expect(online).toMatchObject({
      paymentStatus: 'UNPAID',
      status: { in: ['PENDING_OTP', 'PENDING'] },
    });
    expect(online.placedAt.lt.getTime()).toBeLessThan(Date.now());
  });

  it('sweeps COD orders on confirmation, never on payment status', async () => {
    // A COD order is unpaid until the driver is at the door. Sweeping those on
    // payment status would cancel every genuine cash order the shop has.
    runJob();

    await expireUnpaid(authorized());

    const { cod } = sweepArms();
    expect(cod.status).toBe('PENDING_OTP');
    expect(cod).not.toHaveProperty('paymentStatus');
    expect(cod.placedAt.lt.getTime()).toBeLessThan(Date.now());
  });

  it('gives COD a shorter window, since nothing external is being waited on', async () => {
    runJob();

    await expireUnpaid(authorized());

    const { online, cod } = sweepArms();
    expect(cod.placedAt.lt.getTime()).toBeGreaterThan(online.placedAt.lt.getTime());
  });

  it('cancels each stale order with a reason', async () => {
    runJob();

    await expireUnpaid(authorized());

    expect(tx.order.update).toHaveBeenCalledTimes(2);
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: { status: 'CANCELLED', cancelReason: expect.stringContaining('30 minutes') },
    });
  });

  it('tells a COD customer what they did not do, not which sweep caught them', async () => {
    runJob([{ id: 'order_3', slotId: 'slot_c', paymentMethod: 'COD' }]);

    await expireUnpaid(authorized());

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_3' },
      data: { status: 'CANCELLED', cancelReason: expect.stringContaining('confirmed') },
    });
  });

  it('gives each cancelled order its delivery place back', async () => {
    runJob();

    await expireUnpaid(authorized());

    expect(releaseSlot).toHaveBeenCalledWith('slot_a', tx);
    expect(releaseSlot).toHaveBeenCalledWith('slot_b', tx);
  });

  it('releases the slot on the same transaction client as the cancellation', async () => {
    // A separate connection could commit the cancellation and lose the
    // release, leaving a cancelled order still holding a place in the van.
    runJob();

    await expireUnpaid(authorized());

    const clients = vi.mocked(releaseSlot).mock.calls.map(([, client]) => client as unknown);
    expect(clients).toHaveLength(2);
    expect(clients.every((client) => client === tx)).toBe(true);
  });

  it('records an order event for the audit trail', async () => {
    runJob();

    await expireUnpaid(authorized());

    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'order_1', status: 'CANCELLED', note: expect.any(String) },
    });
  });

  it('reports zero and touches nothing when there is nothing stale', async () => {
    runJob([]);

    const response = await expireUnpaid(authorized());

    await expect(response.json()).resolves.toEqual({ expired: 0 });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(releaseSlot).not.toHaveBeenCalled();
  });

  it('reports a skip when another run already holds the lock', async () => {
    vi.mocked(withAdvisoryLock).mockResolvedValue({ skipped: true });

    const response = await expireUnpaid(authorized());

    await expect(response.json()).resolves.toEqual({ skipped: true });
    expect(tx.order.findMany).not.toHaveBeenCalled();
  });
});
