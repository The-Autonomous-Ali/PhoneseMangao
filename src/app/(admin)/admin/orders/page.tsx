import { OrderStatus, SlotType } from '@prisma/client';
import { buttonVariants } from '@/components/ui/button';
import { listAdminOrders } from '@/lib/admin/order-queries';
import { OrderFilters } from './order-filters';
import { OrderRow } from './order-row';

export const dynamic = 'force-dynamic';

/** Reads a query param only if it is a real member of the enum. */
function asEnum<T extends Record<string, string>>(
  values: T,
  raw: string | undefined
): T[keyof T] | undefined {
  return raw && Object.values(values).includes(raw) ? (raw as T[keyof T]) : undefined;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; slot?: string; status?: string }>;
}) {
  const params = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date : undefined;

  const orders = await listAdminOrders({
    date,
    slotType: asEnum(SlotType, params.slot),
    status: asEnum(OrderStatus, params.status),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Orders</h1>
        <a href="/admin/orders/picking" className={buttonVariants({ variant: 'outline' })}>
          Picking list
        </a>
      </div>

      <OrderFilters date={date} slotType={params.slot} status={params.status} />

      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders match these filters.</p>
      ) : (
        <ul>
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </ul>
      )}
    </div>
  );
}
