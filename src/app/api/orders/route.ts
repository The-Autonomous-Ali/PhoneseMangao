import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';
import { cartItemSchema } from '@/lib/cart';
import { priceCart } from '@/lib/cart-pricing';
import { getShopSettings } from '@/lib/settings';
import { calculateTotals } from '@/lib/pricing';
import { bookSlot, releaseSlot, SlotFullError } from '@/lib/slots';
import { createRazorpayOrder, getPublicKeyId } from '@/lib/razorpay';
import { generateOrderNumber } from '@/lib/order-number';
import { isServiceable } from '@/lib/serviceability';
import {
  generateOtpCode,
  hashOtpCode,
  sendOtp,
  OTP_EXPIRY_MINUTES,
} from '@/lib/otp';

export const dynamic = 'force-dynamic';

const MAX_ORDER_NUMBER_ATTEMPTS = 5;

const createOrderSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(100),
  addressId: z.string().min(1),
  slotId: z.string().min(1),
  paymentMethod: z.enum(PaymentMethod),
  customerNote: z.string().trim().max(500).optional(),
});

function isOrderNumberConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    ((error.meta?.target as string[] | undefined) ?? []).some((t) => t.includes('orderNumber'))
  );
}

/**
 * Places an order.
 *
 * Everything is re-derived here: prices, totals, delivery fee, serviceability.
 * The request says only *what* and *where*, never *how much* — the client is
 * not a party to the arithmetic.
 *
 * Ordering matters. Every rejection that can be decided cheaply happens before
 * the slot is claimed, so a failed checkout never holds a place in the van. The
 * claim itself is inside the same transaction as the order rows, so if writing
 * the order fails the increment rolls back with it.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Please log in to place an order' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid order' }, { status: 400 });
  }
  const input = parsed.data;

  const [user, settings] = await withDbRetry(() =>
    Promise.all([
      db.user.findUnique({ where: { id: session.userId } }),
      getShopSettings(),
    ])
  );

  if (!user) {
    return NextResponse.json({ error: 'Please log in to place an order' }, { status: 401 });
  }

  // A delivery needs a number the driver can call, and it has to be one the
  // customer proved they hold — otherwise a mistyped digit becomes a failed
  // delivery the shop pays for.
  if (!user.phoneVerifiedAt || !user.phone) {
    return NextResponse.json(
      { error: 'Please confirm your phone number first', code: 'PHONE_UNVERIFIED' },
      { status: 403 }
    );
  }

  if (!settings.shopOpen) {
    return NextResponse.json(
      { error: 'The shop is closed right now. Please try again later.', code: 'SHOP_CLOSED' },
      { status: 503 }
    );
  }

  const address = await withDbRetry(() =>
    db.address.findFirst({ where: { id: input.addressId, userId: session.userId } })
  );
  if (!address) {
    return NextResponse.json({ error: 'Delivery address not found' }, { status: 404 });
  }

  // Re-checked at order time, not just when the address was saved: the shop can
  // drop a pincode from its delivery area between those two moments.
  const { serviceable } = await isServiceable({ pincode: address.pincode });
  if (!serviceable) {
    return NextResponse.json(
      { error: `We no longer deliver to ${address.pincode}.`, code: 'NOT_SERVICEABLE' },
      { status: 400 }
    );
  }

  const priced = await priceCart(input.items);

  // Anything that changed since the basket was shown stops the order rather
  // than quietly placing a different one. The client re-renders with these
  // issues and the customer decides.
  if (priced.issues.length > 0) {
    return NextResponse.json(
      { error: 'Your basket changed', code: 'CART_CHANGED', issues: priced.issues },
      { status: 409 }
    );
  }
  if (priced.items.length === 0) {
    return NextResponse.json({ error: 'Your basket is empty' }, { status: 400 });
  }

  const totals = calculateTotals(priced.itemsTotal, settings);
  // Enforced here and not only on the button: the button is trivially bypassed.
  if (!totals.meetsMinimum) {
    return NextResponse.json(
      {
        error: `Minimum order is ₹${settings.minOrderValue}. Add ₹${totals.shortfall} more.`,
        code: 'BELOW_MINIMUM',
      },
      { status: 400 }
    );
  }

  const isOnline = input.paymentMethod === PaymentMethod.ONLINE;

  if (isOnline && !settings.paymentsEnabled) {
    return NextResponse.json(
      { error: 'Online payment is not available right now. Please choose cash on delivery.' },
      { status: 400 }
    );
  }

  // COD is confirmed by a code; an online order is confirmed by the money
  // arriving, so it needs no OTP and opens as PENDING instead.
  const initialStatus = isOnline ? OrderStatus.PENDING : OrderStatus.PENDING_OTP;
  const otpCode = isOnline ? null : generateOtpCode();
  const otpHash = otpCode ? await hashOtpCode(otpCode) : null;

  let order;
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        order = await withDbRetry(() =>
          db.$transaction(async (tx) => {
            // Claims the delivery place. A conditional UPDATE, so two customers
            // taking the last slot at the same moment cannot both succeed.
            await bookSlot(input.slotId, tx);

            const created = await tx.order.create({
              data: {
                orderNumber: generateOrderNumber(),
                userId: session.userId,
                slotId: input.slotId,
                // A snapshot, not a reference. The customer may edit or delete
                // this address later, and the driver still has to find the door.
                deliveryAddress: {
                  label: address.label,
                  line1: address.line1,
                  line2: address.line2,
                  landmark: address.landmark,
                  city: address.city,
                  pincode: address.pincode,
                  phone: user.phone,
                  name: user.name,
                },
                status: initialStatus,
                paymentMethod: input.paymentMethod,
                paymentStatus: PaymentStatus.UNPAID,
                itemsTotal: totals.itemsTotal,
                deliveryFee: totals.deliveryFee,
                grandTotal: totals.grandTotal,
                customerNote: input.customerNote,
                items: {
                  create: priced.items.map((line) => ({
                    variantId: line.variantId,
                    // Denormalised on purpose: an order must still read
                    // correctly after the product is renamed or withdrawn.
                    productName: line.productName,
                    variantLabel: line.variantLabel,
                    unitType: line.unitType,
                    unitPrice: line.unitPrice,
                    unitValue: line.unitValue,
                    quantity: line.quantity,
                    lineTotal: line.lineTotal,
                  })),
                },
                events: { create: { status: initialStatus, note: 'Order placed' } },
              },
            });

            if (otpHash) {
              await tx.otpRequest.create({
                data: {
                  phone: user.phone!,
                  codeHash: otpHash,
                  purpose: 'COD_CONFIRM',
                  expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
                },
              });
            }

            return created;
          })
        );
        break;
      } catch (error) {
        if (!isOrderNumberConflict(error) || attempt >= MAX_ORDER_NUMBER_ATTEMPTS) throw error;
      }
    }
  } catch (error) {
    if (error instanceof SlotFullError) {
      return NextResponse.json(
        { error: 'That delivery slot just filled up. Please pick another.', code: 'SLOT_FULL' },
        { status: 409 }
      );
    }
    console.error('[orders] could not place order', error);
    return NextResponse.json({ error: 'Could not place your order' }, { status: 500 });
  }

  if (isOnline) {
    // Razorpay is called after the order exists, so there is always a row to
    // attach the payment to and to compensate if this fails. Doing it inside
    // the transaction would hold the slot row locked across a network call.
    try {
      const razorpayOrder = await createRazorpayOrder({
        amountRupees: totals.grandTotal,
        receipt: order.orderNumber,
        notes: { orderId: order.id },
      });

      await withDbRetry(() =>
        db.order.update({
          where: { id: order!.id },
          data: { razorpayOrderId: razorpayOrder.id },
        })
      );

      return NextResponse.json(
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          grandTotal: totals.grandTotal,
          razorpayOrderId: razorpayOrder.id,
          razorpayKeyId: getPublicKeyId(),
        },
        { status: 201 }
      );
    } catch (paymentError) {
      // Compensate rather than leave an order that can never be paid for
      // sitting on a delivery place until the sweep notices it.
      console.error('[orders] Razorpay order creation failed', paymentError);

      await withDbRetry(() =>
        db.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order!.id },
            data: {
              status: OrderStatus.FAILED,
              cancelReason: 'Could not start the payment',
            },
          });
          await tx.orderEvent.create({
            data: {
              orderId: order!.id,
              status: OrderStatus.FAILED,
              note: 'Payment could not be started',
            },
          });
          await releaseSlot(order!.slotId, tx);
        })
      ).catch((compensationError) => {
        console.error('[orders] compensation after payment failure failed', compensationError);
      });

      return NextResponse.json(
        { error: 'Could not start the payment. Please try again.', code: 'PAYMENT_START_FAILED' },
        { status: 502 }
      );
    }
  }

  // Sent after the transaction commits. Inside it, a slow WhatsApp call would
  // hold the slot row locked; and an order that exists without its code can be
  // recovered by resending, where a code sent for a rolled-back order cannot.
  try {
    await sendOtp(user.phone, otpCode!);
  } catch (sendError) {
    console.error('[orders] confirmation OTP send failed', sendError);
  }

  return NextResponse.json(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      grandTotal: totals.grandTotal,
    },
    { status: 201 }
  );
}

/** The customer's own order history, newest first. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const orders = await withDbRetry(() =>
    db.order.findMany({
      where: { userId: session.userId },
      orderBy: { placedAt: 'desc' },
      take: 50,
      include: { slot: true, _count: { select: { items: true } } },
    })
  );

  return NextResponse.json({
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      grandTotal: order.grandTotal.toFixed(2),
      itemCount: order._count.items,
      placedAt: order.placedAt.toISOString(),
      slotDate: order.slot.date.toISOString(),
      slotType: order.slot.slotType,
    })),
  });
}
