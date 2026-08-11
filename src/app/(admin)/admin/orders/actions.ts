'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { requireAdmin } from '@/lib/admin-auth';
import { releaseSlot } from '@/lib/slots';
import { toActionError, type ActionResult } from '@/lib/actions';
import { nextStatus, canCancel } from '@/lib/admin/order-status';
import { settleLines, finalTotalFor, type SettleableLine } from '@/lib/admin/settlement';
import { notifyOrderConfirmed } from '@/lib/notify-order';

/** Shown whenever a conditional write matches nothing. */
const LOST_RACE = 'This order was already updated. Refresh to see where it is.';

function refresh() {
  revalidatePath('/admin/orders');
  revalidatePath('/admin');
}

/**
 * Moves an order one step along the pipeline.
 *
 * `from` is not decoration. Read-then-write lets two open tabs both see PACKED,
 * both decide the next state is OUT_FOR_DELIVERY, and both write an event — a
 * history showing the order dispatched twice. Making the current status part of
 * the WHERE closes that window inside the write itself, exactly as `bookSlot`
 * does for slot capacity, and a count of zero is the complete answer.
 */
export async function advanceOrderStatus(
  orderId: string,
  from: OrderStatus
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const to = nextStatus(from);
    if (!to) return { ok: false, error: 'This order cannot be advanced from here' };

    // Delivery is not a status change, it is a settlement. Coming through this
    // path would skip deciding what the driver collects.
    if (to === OrderStatus.DELIVERED) {
      return { ok: false, error: 'Use the delivery form to settle and close this order' };
    }

    const moved = await withDbRetry(() =>
      db.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: orderId, status: from },
          data: { status: to },
        });

        if (count === 0) return false;

        await tx.orderEvent.create({
          data: { orderId, status: to, actorId: admin.userId, note: null },
        });
        return true;
      })
    );

    if (!moved) return { ok: false, error: LOST_RACE };

    // Only on the transition that means "a new order is real". The owner does
    // not need a message when he himself clicks Packed.
    if (to === OrderStatus.CONFIRMED) await notifyOrderConfirmed(orderId);

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'advanceOrderStatus');
  }
}

const reasonSchema = z.string().trim().min(1, 'Give a reason').max(200);

/**
 * Cancels an order and returns its delivery place.
 *
 * The release shares the cancellation's transaction so the van can never keep a
 * seat reserved for an order that no longer exists, and it is reached only when
 * the conditional write actually moved the row — otherwise a double-click would
 * hand the same place back twice and the slot would accept orders forever.
 */
export async function cancelOrder(orderId: string, reason: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const note = reasonSchema.parse(reason);

    const order = await withDbRetry(() =>
      db.order.findUnique({ where: { id: orderId }, select: { status: true, slotId: true } })
    );
    if (!order) return { ok: false, error: 'Order not found' };
    if (!canCancel(order.status)) {
      return { ok: false, error: 'This order is already finished and cannot be cancelled' };
    }

    const cancelled = await withDbRetry(() =>
      db.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: orderId, status: order.status },
          data: { status: OrderStatus.CANCELLED, cancelReason: note },
        });

        if (count === 0) return false;

        await tx.orderEvent.create({
          data: { orderId, status: OrderStatus.CANCELLED, actorId: admin.userId, note },
        });
        await releaseSlot(order.slotId, tx);
        return true;
      })
    );

    if (!cancelled) return { ok: false, error: LOST_RACE };

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'cancelOrder');
  }
}

const actualsSchema = z.record(
  z.string(),
  z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'Enter a weight like 4.7')
);

/**
 * Closes a delivered order at the weights actually delivered.
 *
 * `finalTotal` is written on every order that reaches here, including one with
 * nothing to adjust, so the revenue figures stay a plain sum rather than a
 * `finalTotal ?? grandTotal` repeated at every call site.
 *
 * Cash flips to PAID because the driver has the money — nothing else in the
 * codebase moves a COD order out of UNPAID. An online order is already paid and
 * absorbs the difference: §4.6 of the design doc is explicit that partial-refund
 * automation for small discrepancies is not worth building.
 */
export async function settleAndDeliver(
  orderId: string,
  actuals: Record<string, string>
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const entered = actualsSchema.parse(actuals);

    const order = await withDbRetry(() =>
      db.order.findUnique({ where: { id: orderId }, include: { items: true } })
    );
    if (!order) return { ok: false, error: 'Order not found' };
    if (order.status !== OrderStatus.OUT_FOR_DELIVERY) {
      return { ok: false, error: 'Only an order that is out for delivery can be settled' };
    }

    const lines: SettleableLine[] = order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      variantLabel: item.variantLabel,
      unitType: item.unitType,
      unitPrice: item.unitPrice.toFixed(2),
      unitValue: item.unitValue.toFixed(3),
      quantity: item.quantity,
      lineTotal: item.lineTotal.toFixed(2),
    }));

    const settled = settleLines(lines, entered);
    const finalTotal = finalTotalFor(settled.itemsTotal, order.deliveryFee.toFixed(2));

    const delivered = await withDbRetry(() =>
      db.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: orderId, status: OrderStatus.OUT_FOR_DELIVERY },
          data: { status: OrderStatus.DELIVERED },
        });

        if (count === 0) return false;

        for (const line of settled.lines) {
          if (line.adjustedTotal === null) continue;
          await tx.orderItem.update({
            where: { id: line.id },
            data: { actualQuantity: line.actualQuantity, adjustedTotal: line.adjustedTotal },
          });
        }

        await tx.order.update({
          where: { id: orderId },
          data: {
            finalTotal,
            deliveredAt: new Date(),
            ...(order.paymentMethod === PaymentMethod.COD
              ? { paymentStatus: PaymentStatus.PAID }
              : {}),
          },
        });

        await tx.orderEvent.create({
          data: {
            orderId,
            status: OrderStatus.DELIVERED,
            actorId: admin.userId,
            note: `Settled at ${finalTotal}`,
          },
        });
        return true;
      })
    );

    if (!delivered) return { ok: false, error: LOST_RACE };

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'settleAndDeliver');
  }
}
