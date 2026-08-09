import { NextRequest, NextResponse } from 'next/server';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { isAuthorizedCronRequest, withAdvisoryLock } from '@/lib/cron';
import { releaseSlot } from '@/lib/slots';

/**
 * How long an online order may sit unpaid before its slot is given back.
 *
 * Long enough to cover a slow bank page or a customer switching to their UPI
 * app and back; short enough that an abandoned checkout does not hold a place
 * in a 20-order van all day.
 */
const UNPAID_TIMEOUT_MINUTES = 30;

/** Statuses that mean the order never got past checkout. */
const ABANDONED_STATUSES = [OrderStatus.PENDING_OTP, OrderStatus.PENDING];

/**
 * Cancels online orders that were never paid for and returns their delivery
 * places. Runs every 15 minutes.
 *
 * Only ONLINE orders qualify. A COD order is unpaid by definition until the
 * driver is at the door, and sweeping those would cancel the shop's real work.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - UNPAID_TIMEOUT_MINUTES * 60 * 1000);

  const outcome = await withAdvisoryLock('expire-unpaid', async (tx) => {
    const stale = await tx.order.findMany({
      where: {
        paymentMethod: PaymentMethod.ONLINE,
        paymentStatus: PaymentStatus.UNPAID,
        status: { in: ABANDONED_STATUSES },
        placedAt: { lt: cutoff },
      },
      select: { id: true, slotId: true },
    });

    for (const order of stale) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason: `Payment not completed within ${UNPAID_TIMEOUT_MINUTES} minutes`,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          status: OrderStatus.CANCELLED,
          note: 'Expired by the unpaid-order sweep',
        },
      });

      // Same transaction as the cancellation, so a failure part-way cannot
      // leave a cancelled order still holding its place in the van.
      await releaseSlot(order.slotId, tx);
    }

    return stale.length;
  });

  if (outcome.skipped) {
    return NextResponse.json({ skipped: true });
  }

  if (outcome.result > 0) {
    console.log(`[cron] expire-unpaid cancelled ${outcome.result} order(s)`);
  }
  return NextResponse.json({ expired: outcome.result });
}
