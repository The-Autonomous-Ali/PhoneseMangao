import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';
import { buttonVariants } from '@/components/ui/button';
import { formatRupees, formatSlotDate, formatSlotType } from '@/lib/format';
import { SHOP_NAME } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Your orders — ${SHOP_NAME}`,
  robots: { index: false },
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_OTP: 'Needs confirming',
  PENDING: 'Placed',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/orders');

  const orders = await withReadRetry(() =>
    db.order.findMany({
      where: { userId: session.userId },
      orderBy: { placedAt: 'desc' },
      take: 50,
      include: { slot: true, _count: { select: { items: true } } },
    })
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Your orders</h1>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">You have not ordered anything yet.</p>
          <Link href="/" className={buttonVariants({ className: 'mt-4' })}>
            Start shopping
          </Link>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="flex items-center gap-4 p-4 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{order.orderNumber}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatSlotDate(order.slot.date.toISOString())},{' '}
                    {formatSlotType(order.slot.slotType)} · {order._count.items} item
                    {order._count.items === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium tabular-nums">
                    {formatRupees(order.grandTotal.toFixed(2))}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {STATUS_LABELS[order.status] ?? order.status}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
