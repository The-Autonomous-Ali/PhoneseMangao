import { OrderStatus } from '@prisma/client';
import type { db } from '@/lib/db';

/** Accepts either the shared client or a transaction client from `$transaction`. */
type StockClient = Pick<typeof db, 'orderItem' | 'variant'>;

/**
 * Statuses an order has reached only by having its stock taken.
 *
 * Stock comes down at confirmation — the moment an order becomes real, for cash
 * and card alike — so anything from CONFIRMED onwards is holding inventory. An
 * order still awaiting payment or a confirmation code is not: an abandoned
 * checkout must not consume stock, which is why the line is drawn here and not
 * at checkout.
 *
 * The distinction matters on cancellation. Returning stock for an order that
 * never took any would invent inventory out of nothing, and the shop would
 * discover it by overselling.
 */
const STOCK_HELD = new Set<OrderStatus>([
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
]);

export function hasTakenStock(status: OrderStatus): boolean {
  return STOCK_HELD.has(status);
}

async function adjust(
  orderId: string,
  client: StockClient,
  direction: 'decrement' | 'increment'
): Promise<void> {
  const items = await client.orderItem.findMany({
    where: { orderId },
    select: { variantId: true, quantity: true },
  });

  for (const item of items) {
    // `stockQty: { not: null }` belongs in the WHERE rather than in an `if`.
    // Null means the shop does not count that line — the normal case for loose
    // produce — and a conditional in application code would still race with a
    // variant switching to tracked between the read and the write. Here the
    // untracked row is simply matched by nothing.
    await client.variant.updateMany({
      where: { id: item.variantId, stockQty: { not: null } },
      data: { stockQty: { [direction]: item.quantity } },
    });
  }
}

/**
 * Takes an order's stock out of inventory, at confirmation.
 *
 * Call inside the transaction that confirms the order, so stock and status
 * cannot disagree — an order that is CONFIRMED with its stock still on the
 * shelf is exactly how a shop oversells.
 */
export async function takeStock(orderId: string, client: StockClient): Promise<void> {
  return adjust(orderId, client, 'decrement');
}

/**
 * Puts an order's stock back, on cancellation.
 *
 * Only for orders that actually took it — see `hasTakenStock`. Callers check
 * that against the status they are cancelling *from*, not the one they are
 * writing, since by then it is CANCELLED and tells you nothing.
 */
export async function returnStock(orderId: string, client: StockClient): Promise<void> {
  return adjust(orderId, client, 'increment');
}
