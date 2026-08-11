'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { OrderStatus } from '@prisma/client';
import { Button } from '@/components/ui/button';
import type { AdminOrderRow } from '@/lib/admin/order-queries';
import { advanceLabel, canCancel, nextStatus } from '@/lib/admin/order-status';
import { formatRupees, formatSlotDate, formatSlotType, recipientName } from '@/lib/format';
import { advanceOrderStatus, cancelOrder } from './actions';
import { SettleForm } from './settle-form';

export function OrderRow({ order }: { order: AdminOrderRow }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const label = advanceLabel(order.status);
  // The last step is a settlement, not a status change: it goes through the
  // form, which is what decides the figure the driver collects.
  const settling = nextStatus(order.status) === OrderStatus.DELIVERED;

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <li className="border-b py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setOpen(!open)} className="font-medium underline">
          {order.orderNumber}
        </button>
        <span className="rounded bg-muted px-2 py-0.5 text-xs">{order.status}</span>
        <span className="text-sm text-muted-foreground">
          {formatSlotDate(order.slot.date)} · {formatSlotType(order.slot.slotType)}
        </span>
        <span className="text-sm">{formatRupees(order.finalTotal ?? order.grandTotal)}</span>
        <span className="text-sm text-muted-foreground">
          {order.paymentMethod} · {order.paymentStatus}
        </span>

        <span className="ml-auto flex gap-2">
          {label && !settling && (
            <Button
              disabled={pending}
              onClick={() => run(() => advanceOrderStatus(order.id, order.status))}
            >
              {label}
            </Button>
          )}
          {canCancel(order.status) && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                const reason = window.prompt('Why is this order being cancelled?');
                if (reason) run(() => cancelOrder(order.id, reason));
              }}
            >
              Cancel
            </Button>
          )}
        </span>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {open && (
        <div className="mt-3 grid gap-4 rounded-lg bg-muted/40 p-3 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-medium">Items</h3>
            <ul className="text-sm">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-4">
                  <span>
                    {item.productName} · {item.variantLabel} × {item.quantity}
                    {item.actualQuantity && (
                      <em className="ml-1 text-muted-foreground">
                        (delivered {item.actualQuantity})
                      </em>
                    )}
                  </span>
                  <span>{formatRupees(item.adjustedTotal ?? item.lineTotal)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="text-sm">
            <h3 className="mb-1 font-medium">Deliver to</h3>
            <p>{recipientName(order.address.name)}</p>
            <p>{order.address.phone}</p>
            <p>
              {order.address.line1}
              {order.address.line2 ? `, ${order.address.line2}` : ''}
            </p>
            {order.address.landmark && <p>near {order.address.landmark}</p>}
            <p>
              {order.address.city} {order.address.pincode}
            </p>
            {order.customerNote && <p className="mt-2 italic">“{order.customerNote}”</p>}
          </div>

          {settling && <SettleForm order={order} onDone={() => router.refresh()} />}
        </div>
      )}
    </li>
  );
}
