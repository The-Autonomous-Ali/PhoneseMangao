import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { order: { findMany: vi.fn() } },
}));

import {
  Prisma,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  SlotType,
  UnitType,
} from '@prisma/client';
import { db } from '@/lib/db';
import { listAdminOrders, getSlotPickingList } from './order-queries';

const ADDRESS = {
  label: 'Home',
  line1: '12 MG Road',
  line2: null,
  landmark: 'near temple',
  city: 'Bengaluru',
  pincode: '560001',
  phone: '+919876543210',
  name: 'Ramesh',
};

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'oi_1',
    productName: 'Onion',
    variantLabel: '1 kg',
    unitType: UnitType.KG,
    unitPrice: new Prisma.Decimal('45'),
    unitValue: new Prisma.Decimal('1'),
    quantity: 2,
    lineTotal: new Prisma.Decimal('90'),
    actualQuantity: null,
    adjustedTotal: null,
    ...overrides,
  };
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o_1',
    orderNumber: 'KD-1042',
    status: OrderStatus.CONFIRMED,
    paymentMethod: PaymentMethod.COD,
    paymentStatus: PaymentStatus.UNPAID,
    placedAt: new Date('2026-08-10T08:47:00Z'),
    itemsTotal: new Prisma.Decimal('90'),
    deliveryFee: new Prisma.Decimal('30'),
    grandTotal: new Prisma.Decimal('120'),
    finalTotal: null,
    customerNote: null,
    adminNote: null,
    deliveryAddress: ADDRESS,
    slot: { id: 's_1', date: new Date('2026-08-11T00:00:00Z'), slotType: SlotType.MORNING },
    items: [itemRow()],
    ...overrides,
  };
}

/** The `where` clause the query layer handed Prisma. */
function whereOf(call = 0) {
  return vi.mocked(db.order.findMany).mock.calls[call][0]!.where as Record<string, unknown>;
}

beforeEach(() => {
  vi.mocked(db.order.findMany).mockReset();
});

describe('listAdminOrders', () => {
  it('serialises every Decimal to a string, because a client component cannot receive one', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([orderRow()] as never);

    const [row] = await listAdminOrders({});

    expect(row.grandTotal).toBe('120.00');
    expect(row.items[0].unitPrice).toBe('45.00');
    expect(row.items[0].unitValue).toBe('1.000');
    expect(row.finalTotal).toBeNull();
    expect(typeof row.placedAt).toBe('string');
  });

  it('reads the customer from the address snapshot taken at checkout', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([orderRow()] as never);

    const [row] = await listAdminOrders({});

    // The snapshot is what the driver has to work with. The customer may have
    // edited or deleted the saved address since.
    expect(row.address.name).toBe('Ramesh');
    expect(row.address.phone).toBe('+919876543210');
  });

  it('filters by date, slot and status together', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([] as never);

    await listAdminOrders({
      date: '2026-08-11',
      slotType: SlotType.MORNING,
      status: OrderStatus.CONFIRMED,
    });

    expect(whereOf().status).toBe(OrderStatus.CONFIRMED);
    expect(whereOf().slot).toEqual({
      date: new Date('2026-08-11T00:00:00.000Z'),
      slotType: SlotType.MORNING,
    });
  });

  it('applies no filters when none are given', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([] as never);

    await listAdminOrders({});

    expect(whereOf()).toEqual({});
  });
});

describe('getSlotPickingList', () => {
  it('totals the same product across orders for the stock-pull sheet', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([
      orderRow({ id: 'o_1', orderNumber: 'KD-1042', items: [itemRow({ id: 'oi_1', quantity: 2 })] }),
      orderRow({ id: 'o_2', orderNumber: 'KD-1043', items: [itemRow({ id: 'oi_2', quantity: 3 })] }),
    ] as never);

    const list = await getSlotPickingList('2026-08-11', SlotType.MORNING);

    expect(list.aggregate).toEqual([{ productName: 'Onion', variantLabel: '1 kg', quantity: 5 }]);
    expect(list.orderCount).toBe(2);
  });

  it('keeps different sizes of one product apart', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([
      orderRow({
        items: [
          itemRow({ id: 'oi_1', variantLabel: '1 kg', quantity: 2 }),
          itemRow({ id: 'oi_2', variantLabel: '5 kg', quantity: 1 }),
        ],
      }),
    ] as never);

    const list = await getSlotPickingList('2026-08-11', SlotType.MORNING);

    expect(list.aggregate).toHaveLength(2);
  });

  it('tells the driver what to collect on a cash order and nothing on a paid one', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([
      orderRow({ id: 'o_1', paymentMethod: PaymentMethod.COD }),
      orderRow({
        id: 'o_2',
        paymentMethod: PaymentMethod.ONLINE,
        paymentStatus: PaymentStatus.PAID,
      }),
    ] as never);

    const list = await getSlotPickingList('2026-08-11', SlotType.MORNING);

    expect(list.orders[0].amountToCollect).toBe('120.00');
    expect(list.orders[1].amountToCollect).toBeNull();
  });

  it('collects the settled figure once one exists', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([
      orderRow({ finalTotal: new Prisma.Decimal('108.40') }),
    ] as never);

    const list = await getSlotPickingList('2026-08-11', SlotType.MORNING);

    expect(list.orders[0].amountToCollect).toBe('108.40');
  });

  it('only lists orders that are actually due to be packed', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([] as never);

    await getSlotPickingList('2026-08-11', SlotType.MORNING);

    // An unconfirmed or cancelled order must never reach the packing bench.
    expect(whereOf().status).toEqual({ in: [OrderStatus.CONFIRMED, OrderStatus.PACKED] });
  });
});
