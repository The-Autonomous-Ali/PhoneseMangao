import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await context.params;

  // Ownership is part of the query. Order ids are not secrets, and a fetch
  // followed by an `if` is one early return away from exposing somebody's
  // address, phone number and shopping habits.
  const order = await withReadRetry(() =>
    db.order.findFirst({
      where: { id, userId: session.userId },
      include: { items: true, slot: true, events: { orderBy: { createdAt: 'asc' } } },
    })
  );

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  return NextResponse.json({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      itemsTotal: order.itemsTotal.toFixed(2),
      deliveryFee: order.deliveryFee.toFixed(2),
      grandTotal: order.grandTotal.toFixed(2),
      finalTotal: order.finalTotal?.toFixed(2) ?? null,
      deliveryAddress: order.deliveryAddress,
      customerNote: order.customerNote,
      cancelReason: order.cancelReason,
      placedAt: order.placedAt.toISOString(),
      slot: {
        date: order.slot.date.toISOString(),
        slotType: order.slot.slotType,
      },
      items: order.items.map((item) => ({
        id: item.id,
        productName: item.productName,
        variantLabel: item.variantLabel,
        unitPrice: item.unitPrice.toFixed(2),
        quantity: item.quantity,
        lineTotal: item.lineTotal.toFixed(2),
        actualQuantity: item.actualQuantity?.toString() ?? null,
        adjustedTotal: item.adjustedTotal?.toFixed(2) ?? null,
      })),
      events: order.events.map((event) => ({
        status: event.status,
        note: event.note,
        createdAt: event.createdAt.toISOString(),
      })),
    },
  });
}
