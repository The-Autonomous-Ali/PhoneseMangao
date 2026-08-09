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

/**
 * How long a cash-on-delivery order may sit unconfirmed.
 *
 * Shorter than the payment window because nothing external is being waited on —
 * the code is already on the customer's phone. This is the shop's protection
 * against a fake COD order sitting on a delivery place all morning.
 */
const UNCONFIRMED_COD_TIMEOUT_MINUTES = 15;

/**
 * Cancels checkouts that were never completed and returns their delivery
 * places. Runs every 15 minutes.
 *
 * Two separate cases, deliberately not one query:
 *
 * - ONLINE orders still UNPAID after the payment window. Payment status is the
 *   signal, and only the Razorpay webhook ever changes it.
 * - COD orders still PENDING_OTP after the confirmation window. Payment status
 *   says nothing here — a COD order is unpaid until the driver is at the door —
 *   so the signal is that the customer never entered the code.
 *
 * Sweeping COD on payment status instead would cancel every genuine cash order
 * the shop has, which is why the two are kept apart.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const unpaidCutoff = new Date(Date.now() - UNPAID_TIMEOUT_MINUTES * 60 * 1000);
  const unconfirmedCutoff = new Date(Date.now() - UNCONFIRMED_COD_TIMEOUT_MINUTES * 60 * 1000);

  const outcome = await withAdvisoryLock('expire-unpaid', async (tx) => {
    const stale = await tx.order.findMany({
      where: {
        OR: [
          {
            paymentMethod: PaymentMethod.ONLINE,
            paymentStatus: PaymentStatus.UNPAID,
            status: { in: [OrderStatus.PENDING_OTP, OrderStatus.PENDING] },
            placedAt: { lt: unpaidCutoff },
          },
          {
            paymentMethod: PaymentMethod.COD,
            status: OrderStatus.PENDING_OTP,
            placedAt: { lt: unconfirmedCutoff },
          },
        ],
      },
      select: { id: true, slotId: true, paymentMethod: true },
    });

    for (const order of stale) {
      // The customer reads this on their order, so it says what they actually
      // did not do rather than naming the sweep that caught it.
      const reason =
        order.paymentMethod === PaymentMethod.COD
          ? `Not confirmed within ${UNCONFIRMED_COD_TIMEOUT_MINUTES} minutes`
          : `Payment not completed within ${UNPAID_TIMEOUT_MINUTES} minutes`;

      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED, cancelReason: reason },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          status: OrderStatus.CANCELLED,
          note: 'Expired by the incomplete-checkout sweep',
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
