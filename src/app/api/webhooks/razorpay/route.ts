import { NextRequest, NextResponse } from 'next/server';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { notifyOrderConfirmed } from '@/lib/notify-order';
import { takeStock } from '@/lib/stock';

export const dynamic = 'force-dynamic';

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment?: {
      entity?: { id?: string; order_id?: string; error_description?: string };
    };
  };
}

/**
 * The only place an order's paymentStatus ever changes.
 *
 * Deliberately not driven by the browser redirect after checkout. That redirect
 * is a UX signal and nothing more — its parameters are trivially forged, and a
 * customer who closes the tab after paying never sends it at all. The money
 * arriving is what this endpoint hears about, and only from Razorpay.
 *
 * Unauthenticated by necessity: Razorpay has no session. The signature is the
 * authentication, which is why it is checked before anything else happens and
 * why the raw body is read rather than a parsed one.
 */
export async function POST(request: NextRequest) {
  // Raw text, not request.json(). Parsing and re-serialising changes key order
  // and whitespace, and the HMAC is over the exact bytes Razorpay sent — every
  // legitimate call would fail verification.
  const rawBody = await request.text();

  if (!verifyWebhookSignature(rawBody, request.headers.get('x-razorpay-signature'))) {
    // 401 rather than 400: this is a failed authentication, and Razorpay's
    // retry logic treats them differently.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const event = body.event;
  const payment = body.payload?.payment?.entity;
  const razorpayOrderId = payment?.order_id;

  // Razorpay sends events we do not act on. Acknowledging them keeps them out
  // of its retry queue; 4xx would have it redeliver forever.
  if (!razorpayOrderId || (event !== 'payment.captured' && event !== 'payment.failed')) {
    return NextResponse.json({ ok: true, ignored: event ?? 'unknown' });
  }

  const order = await withDbRetry(() => db.order.findUnique({ where: { razorpayOrderId } }));

  // A payment for an order we do not have is not something a retry will fix.
  if (!order) {
    console.error(`[webhook] no order for razorpay order ${razorpayOrderId}`);
    return NextResponse.json({ ok: true, ignored: 'unknown-order' });
  }

  // Idempotency. Razorpay retries on any non-2xx and can deliver the same event
  // more than once regardless, so every path below has to be safe to repeat.
  // Checking paid-ness first is the cheapest way to make the common one so.
  if (order.paymentStatus === PaymentStatus.PAID) {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  if (event === 'payment.captured') {
    await withDbRetry(() =>
      db.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: PaymentStatus.PAID,
            status: OrderStatus.CONFIRMED,
            razorpayPaymentId: payment?.id,
          },
        });

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            status: OrderStatus.CONFIRMED,
            note: 'Payment received',
          },
        });

        // Stock comes down at confirmation, not when the basket is filled — an
        // abandoned checkout must not consume stock. Shared with the cash path,
        // which confirms by OTP rather than by payment but takes stock at the
        // same point in an order's life.
        await takeStock(order.id, tx);
      })
    );

    // Outside the transaction on purpose: inside it, a slow Meta would hold a
    // database transaction open across a call to a third party. It never
    // throws, so it cannot make Razorpay retry a webhook already handled.
    await notifyOrderConfirmed(order.id);

    return NextResponse.json({ ok: true });
  }

  // payment.failed. The slot is deliberately kept: a failed UPI attempt is
  // usually retried within seconds, and taking the delivery place away in
  // between is worse than holding it. The expire-unpaid sweep reclaims it if
  // the customer really has gone.
  await withDbRetry(() =>
    db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: PaymentStatus.FAILED },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          status: order.status,
          note: payment?.error_description
            ? `Payment failed: ${payment.error_description}`
            : 'Payment failed',
        },
      });
    })
  );

  return NextResponse.json({ ok: true });
}
