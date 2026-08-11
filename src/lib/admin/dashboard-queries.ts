import { OrderStatus, PaymentMethod, Prisma, SlotType } from '@prisma/client';
import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';

/**
 * Below this, a variant is worth warning about. A constant rather than a
 * setting: one number, and no evidence yet that the owner wants to tune it. It
 * can become a setting the day he asks.
 */
const LOW_STOCK_THRESHOLD = 5;

/** Statuses that are waiting on somebody. */
const OPEN_STATUSES = [
  OrderStatus.PENDING_OTP,
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
];

export interface DashboardSummary {
  date: string;
  collected: { orders: number; total: string; cash: string; prepaid: string };
  upcoming: { slotType: SlotType; orders: number; estimated: string }[];
  needsAction: { pendingOtp: number; pending: number; confirmed: number; packed: number };
  lowStock: { productName: string; variantLabel: string; stockQty: number }[];
}

function calendarDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * The shop's day, for the admin landing screen.
 *
 * `collected` and `upcoming` are scoped to the date. `needsAction` and
 * `lowStock` are not, on purpose: an order left PENDING since yesterday is
 * precisely what the owner has to see, and the older it gets the less likely a
 * date filter is to show it.
 */
export async function getDashboard(date: string): Promise<DashboardSummary> {
  const dayStart = calendarDay(date);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const deliveredOrders = await withReadRetry(() =>
    db.order.findMany({
      where: { deliveredAt: { gte: dayStart, lt: dayEnd } },
      select: { paymentMethod: true, finalTotal: true, grandTotal: true },
    })
  );

  const upcomingOrders = await withReadRetry(() =>
    db.order.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        slot: { date: dayStart },
      },
      select: { grandTotal: true, slot: { select: { slotType: true } } },
    })
  );

  const openCounts = await withReadRetry(() =>
    db.order.groupBy({
      by: ['status'],
      where: { status: { in: OPEN_STATUSES } },
      _count: true,
    })
  );

  const lowStock = await withReadRetry(() =>
    db.variant.findMany({
      // `not: null` matters as much as the threshold. A null stockQty means the
      // shop does not track that line, which is normal for loose produce, and
      // listing it as "0 left" would bury the warnings that are real.
      where: { stockQty: { not: null, lte: LOW_STOCK_THRESHOLD }, isAvailable: true },
      select: { label: true, stockQty: true, product: { select: { name: true } } },
      orderBy: { stockQty: 'asc' },
    })
  );

  let cash = new Prisma.Decimal(0);
  let prepaid = new Prisma.Decimal(0);
  for (const order of deliveredOrders) {
    // finalTotal is written on every delivered order by the settlement step, so
    // this needs no fallback. grandTotal is only ever the estimate.
    const amount = order.finalTotal ?? order.grandTotal;
    if (order.paymentMethod === PaymentMethod.COD) cash = cash.add(amount);
    else prepaid = prepaid.add(amount);
  }

  const bySlot = new Map<SlotType, { orders: number; estimated: Prisma.Decimal }>();
  for (const order of upcomingOrders) {
    const existing = bySlot.get(order.slot.slotType) ?? {
      orders: 0,
      estimated: new Prisma.Decimal(0),
    };
    existing.orders += 1;
    existing.estimated = existing.estimated.add(order.grandTotal);
    bySlot.set(order.slot.slotType, existing);
  }

  const counted = (status: OrderStatus): number =>
    openCounts.find((row) => row.status === status)?._count ?? 0;

  return {
    date,
    collected: {
      orders: deliveredOrders.length,
      total: cash.add(prepaid).toFixed(2),
      cash: cash.toFixed(2),
      prepaid: prepaid.toFixed(2),
    },
    upcoming: [...bySlot.entries()].map(([slotType, totals]) => ({
      slotType,
      orders: totals.orders,
      estimated: totals.estimated.toFixed(2),
    })),
    needsAction: {
      pendingOtp: counted(OrderStatus.PENDING_OTP),
      pending: counted(OrderStatus.PENDING),
      confirmed: counted(OrderStatus.CONFIRMED),
      packed: counted(OrderStatus.PACKED),
    },
    lowStock: lowStock.map((variant) => ({
      productName: variant.product.name,
      variantLabel: variant.label,
      stockQty: variant.stockQty ?? 0,
    })),
  };
}
