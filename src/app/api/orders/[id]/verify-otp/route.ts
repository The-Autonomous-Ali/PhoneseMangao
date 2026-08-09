import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { OrderStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';
import { consumeOtp } from '@/lib/otp';

export const dynamic = 'force-dynamic';

const schema = z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') });

/**
 * Confirms a cash-on-delivery order.
 *
 * COD is the shop's exposure: someone can order forty kilos to an address they
 * have nothing to do with, and the van goes out anyway. Requiring a code sent
 * to the number on the order is what makes a fake order cost the person placing
 * it something. Until this succeeds the order is PENDING_OTP and the cron sweep
 * will eventually cancel it and give the slot back.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Code must be 6 digits' }, { status: 400 });
  }

  const [order, user] = await withDbRetry(() =>
    Promise.all([
      db.order.findFirst({ where: { id, userId: session.userId } }),
      db.user.findUnique({ where: { id: session.userId } }),
    ])
  );

  if (!order || !user?.phone) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // Already confirmed is a success, not an error: a double-submitted form or a
  // retried request should not read as a failure to the customer.
  if (order.status !== OrderStatus.PENDING_OTP) {
    if (order.status === OrderStatus.CANCELLED) {
      return NextResponse.json({ error: 'This order was cancelled' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, status: order.status });
  }

  const result = await withDbRetry(() => consumeOtp(user.phone!, parsed.data.code, 'COD_CONFIRM'));
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.reason === 'NOT_FOUND'
            ? 'Code expired or not found. Please place the order again.'
            : 'Incorrect code',
      },
      { status: 400 }
    );
  }

  const updated = await withDbRetry(() =>
    db.$transaction(async (tx) => {
      const row = await tx.order.update({
        where: { id },
        data: { status: OrderStatus.CONFIRMED },
      });
      await tx.orderEvent.create({
        data: { orderId: id, status: OrderStatus.CONFIRMED, note: 'Confirmed by OTP' },
      });
      return row;
    })
  );

  return NextResponse.json({ ok: true, status: updated.status });
}
