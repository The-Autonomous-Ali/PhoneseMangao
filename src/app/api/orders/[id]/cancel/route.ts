import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { OrderStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';
import { releaseSlot } from '@/lib/slots';
import { returnStock, hasTakenStock } from '@/lib/stock';

export const dynamic = 'force-dynamic';

const schema = z.object({ reason: z.string().trim().max(200).optional() });

/**
 * Statuses a customer may still cancel from.
 *
 * The line is drawn at PACKED: once the shop has weighed and bagged loose
 * produce it cannot be put back, so cancelling then is a conversation with the
 * shop rather than a button.
 */
const CANCELLABLE = new Set<OrderStatus>([
  OrderStatus.PENDING_OTP,
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await context.params;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  const reason = parsed.success ? parsed.data.reason : undefined;

  const order = await withDbRetry(() =>
    db.order.findFirst({ where: { id, userId: session.userId } })
  );
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  // Cancelling twice is a success. A double-tap or a retried request must not
  // release the slot a second time.
  if (order.status === OrderStatus.CANCELLED) {
    return NextResponse.json({ ok: true, status: order.status });
  }

  if (!CANCELLABLE.has(order.status)) {
    return NextResponse.json(
      {
        error: 'This order is already being prepared. Please call the shop to cancel.',
        code: 'TOO_LATE',
      },
      { status: 409 }
    );
  }

  await withDbRetry(() =>
    db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason: reason ?? 'Cancelled by customer',
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: id,
          status: OrderStatus.CANCELLED,
          note: reason ?? 'Cancelled by customer',
          actorId: session.userId,
        },
      });

      // Same transaction as the cancellation, so the van can never keep a place
      // reserved for an order that no longer exists.
      await releaseSlot(order.slotId, tx);

      // A customer may cancel from CONFIRMED, by which point the stock has come
      // down. The two earlier statuses never took any, and giving stock back
      // for those would invent inventory out of nothing.
      if (hasTakenStock(order.status)) await returnStock(id, tx);
    })
  );

  return NextResponse.json({ ok: true, status: OrderStatus.CANCELLED });
}
