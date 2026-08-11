import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';
import { SHOP_NAME } from '@/lib/constants';
import { OrderDetailView, type OrderDetail } from './order-detail';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Your order — ${SHOP_NAME}`,
  robots: { index: false },
};

interface StoredAddress {
  line1?: string;
  landmark?: string | null;
  city?: string;
  pincode?: string;
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!session) redirect(`/login?next=/orders/${id}`);

  // Ownership is part of the query, not a check afterwards.
  const order = await withReadRetry(() =>
    db.order.findFirst({
      where: { id, userId: session.userId },
      include: { items: true, slot: true },
    })
  );

  if (!order) notFound();

  // deliveryAddress is a Json snapshot taken when the order was placed, so it
  // is read defensively rather than trusted to match the current Address shape.
  const address = (order.deliveryAddress ?? {}) as StoredAddress;

  const detail: OrderDetail = {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    itemsTotal: order.itemsTotal.toFixed(2),
    deliveryFee: order.deliveryFee.toFixed(2),
    grandTotal: order.grandTotal.toFixed(2),
    cancelReason: order.cancelReason,
    customerNote: order.customerNote,
    placedAt: order.placedAt.toISOString(),
    slotDate: order.slot.date.toISOString(),
    slotType: order.slot.slotType,
    address: {
      line1: address.line1 ?? '',
      landmark: address.landmark ?? null,
      city: address.city ?? '',
      pincode: address.pincode ?? '',
    },
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      variantLabel: item.variantLabel,
      unitPrice: item.unitPrice.toFixed(2),
      quantity: item.quantity,
      lineTotal: item.lineTotal.toFixed(2),
    })),
  };

  return <OrderDetailView order={detail} />;
}
