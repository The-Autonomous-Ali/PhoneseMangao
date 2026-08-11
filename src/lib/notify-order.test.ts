import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { order: { findUnique: vi.fn() } } }));
vi.mock('@/lib/services/notify', () => ({ sendOwnerAlert: vi.fn() }));

import { Prisma, PaymentMethod, PaymentStatus, SlotType } from '@prisma/client';
import { db } from '@/lib/db';
import { sendOwnerAlert } from '@/lib/services/notify';
import { notifyOrderConfirmed } from './notify-order';

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o_1',
    orderNumber: 'KD-1042',
    paymentMethod: PaymentMethod.COD,
    paymentStatus: PaymentStatus.UNPAID,
    grandTotal: new Prisma.Decimal('480'),
    finalTotal: null,
    deliveryAddress: { name: 'Ramesh', phone: '+919876543210' },
    slot: { date: new Date('2026-08-11T00:00:00Z'), slotType: SlotType.MORNING },
    items: [{ id: 'oi_1' }, { id: 'oi_2' }, { id: 'oi_3' }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(db.order.findUnique).mockReset().mockResolvedValue(orderRow() as never);
  vi.mocked(sendOwnerAlert).mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('notifyOrderConfirmed', () => {
  it('describes the order the way the owner reads it', async () => {
    await notifyOrderConfirmed('o_1');

    const alert = vi.mocked(sendOwnerAlert).mock.calls[0][0];
    expect(alert.orderNumber).toBe('KD-1042');
    expect(alert.customerName).toBe('Ramesh');
    expect(alert.customerPhone).toBe('+919876543210');
    expect(alert.summary).toContain('3 items');
    expect(alert.summary).toContain('COD');
    expect(alert.summary).toContain('480');
  });

  it('reads the customer from the address snapshot taken at checkout', async () => {
    // That snapshot is what the driver works from; the saved address may have
    // been edited or deleted since.
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ deliveryAddress: { name: 'Sita', phone: '+911111111111' } }) as never
    );

    await notifyOrderConfirmed('o_1');

    expect(vi.mocked(sendOwnerAlert).mock.calls[0][0].customerName).toBe('Sita');
  });

  it('says nothing is to be collected on a prepaid order', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({
        paymentMethod: PaymentMethod.ONLINE,
        paymentStatus: PaymentStatus.PAID,
      }) as never
    );

    await notifyOrderConfirmed('o_1');

    expect(vi.mocked(sendOwnerAlert).mock.calls[0][0].summary).toContain('paid');
  });

  it('counts a single item without pluralising it', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ items: [{ id: 'oi_1' }] }) as never
    );

    await notifyOrderConfirmed('o_1');

    expect(vi.mocked(sendOwnerAlert).mock.calls[0][0].summary).toContain('1 item ');
  });

  it('NEVER throws when the channel fails', async () => {
    // Everything this runs after — a captured payment, a confirmed delivery —
    // is already committed. A failed alert must not surface as a failed order.
    vi.mocked(sendOwnerAlert).mockRejectedValue(new Error('Meta is down'));

    await expect(notifyOrderConfirmed('o_1')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('never throws when the order cannot be read', async () => {
    vi.mocked(db.order.findUnique).mockRejectedValue(new Error('connection lost'));

    await expect(notifyOrderConfirmed('o_1')).resolves.toBeUndefined();
  });

  it('does nothing quietly when the order has vanished', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null as never);

    await expect(notifyOrderConfirmed('o_1')).resolves.toBeUndefined();
    expect(sendOwnerAlert).not.toHaveBeenCalled();
  });
});
