import { PaymentStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { sendOwnerAlert } from '@/lib/services/notify';
import { formatRupees, formatSlotDate, formatSlotType } from '@/lib/format';

/**
 * Tells the owner an order has been confirmed.
 *
 * Never throws, and every caller invokes it after its transaction has
 * committed. By the time this runs the money may already have been captured
 * and the slot claimed; a Meta outage must not turn that into a failed request
 * the customer sees. The shop losing a notification is recoverable — the order
 * is on the admin screen either way — and `orders/route.ts` already takes this
 * position for the confirmation OTP, for the same reason.
 */
export async function notifyOrderConfirmed(orderId: string): Promise<void> {
  try {
    const order = await withDbRetry(() =>
      db.order.findUnique({
        where: { id: orderId },
        include: {
          items: { select: { id: true } },
          slot: { select: { date: true, slotType: true } },
        },
      })
    );

    if (!order) return;

    // The snapshot taken at checkout, not the saved address: the customer may
    // have edited or deleted that since, and this is what the driver works from.
    const address = (order.deliveryAddress ?? {}) as { name?: string; phone?: string };
    const total = (order.finalTotal ?? order.grandTotal).toFixed(2);
    const count = order.items.length;

    const payment =
      order.paymentStatus === PaymentStatus.PAID
        ? `${order.paymentMethod} · paid`
        : `${order.paymentMethod} · collect ${formatRupees(total)}`;

    await sendOwnerAlert({
      orderNumber: order.orderNumber,
      customerName: address.name ?? 'Customer',
      customerPhone: address.phone ?? '',
      slot: `${formatSlotDate(order.slot.date.toISOString())} ${formatSlotType(order.slot.slotType)}`,
      summary: `${count} item${count === 1 ? '' : 's'} · ${payment}`,
    });
  } catch (error) {
    console.error(`[alert] could not notify the owner about order ${orderId}`, error);
  }
}
