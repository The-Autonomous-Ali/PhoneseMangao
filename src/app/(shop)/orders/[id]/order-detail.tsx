'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRupees, formatSlotDate, formatSlotType } from '@/lib/format';
import { OrderTimeline } from '@/components/shop/order-timeline';

interface OrderItem {
  id: string;
  productName: string;
  variantLabel: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  itemsTotal: string;
  deliveryFee: string;
  grandTotal: string;
  cancelReason: string | null;
  customerNote: string | null;
  placedAt: string;
  slotDate: string;
  slotType: string;
  address: { line1: string; landmark: string | null; city: string; pincode: string };
  items: OrderItem[];
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_OTP: 'Waiting for your confirmation',
  PENDING: 'Placed',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

const CANCELLABLE = new Set(['PENDING_OTP', 'PENDING', 'CONFIRMED']);

function ConfirmPanel({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const response = await fetch(`/api/orders/${orderId}/verify-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? 'Could not confirm the order');
      return;
    }
    router.refresh();
  }

  return (
    <Card className="border-gold/40 bg-gold/5">
      <CardHeader>
        <CardTitle>Confirm your order</CardTitle>
      </CardHeader>
      <CardContent>
        {/* COD is the shop's exposure — the van goes out either way. The code
            proves the number on the order belongs to whoever placed it. */}
        <p className="mb-3 text-sm text-muted-foreground">
          We sent a 6-digit code on WhatsApp. Enter it to confirm. Unconfirmed orders are
          cancelled after 15 minutes and the slot is released.
        </p>
        <form onSubmit={submit} className="flex items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              className="w-32"
            />
          </div>
          <Button type="submit" disabled={busy || code.length < 6}>
            {busy ? 'Confirming...' : 'Confirm'}
          </Button>
        </form>
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function OrderDetailView({ order }: { order: OrderDetail }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setError(null);
    setCancelling(true);

    const response = await fetch(`/api/orders/${order.id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await response.json().catch(() => ({}));
    setCancelling(false);

    if (!response.ok) {
      setError(body.error ?? 'Could not cancel the order');
      return;
    }
    router.refresh();
  }

  return (
    <div className="animate-om-fade space-y-6">
      <div className="text-center">
        <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-[#20392d] text-[32px] text-gold">
          {order.status === 'CANCELLED' || order.status === 'FAILED' ? '×' : '✓'}
        </div>
        <h1 className="text-[34px]">{STATUS_LABELS[order.status] ?? order.status}</h1>
        {order.cancelReason && (
          <p className="mt-2 text-base text-[#a9b7ac]">{order.cancelReason}</p>
        )}
        <div className="mt-3.5 inline-block rounded-full border border-[#294c3b] bg-[#182e24] px-4.5 py-2 text-sm font-semibold tracking-[0.04em]">
          {order.orderNumber}
        </div>
      </div>

      {order.status === 'PENDING_OTP' && <ConfirmPanel orderId={order.id} />}

      <OrderTimeline status={order.status} />

      {order.paymentMethod === 'ONLINE' && order.paymentStatus === 'UNPAID' && (
        <Card className="border-gold/40 bg-gold/5">
          <CardHeader>
            <CardTitle>Waiting for payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {/* Deliberately not confirmed from the browser redirect: that
                signal is forgeable, and a customer who closes the tab after
                paying never sends it. The bank's confirmation is what counts. */}
            <p>
              If you completed the payment, this updates within a minute or two once the bank
              confirms it. Refresh to check.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
              Refresh
            </Button>
          </CardContent>
        </Card>
      )}

      {order.paymentMethod === 'ONLINE' && order.paymentStatus === 'FAILED' && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle>Payment did not go through</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Your delivery slot is held for a short while. Place the order again to retry, or
            cancel below.
          </CardContent>
        </Card>
      )}

      {order.paymentStatus === 'PAID' && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">Paid in full.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Delivery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="font-medium">
            {formatSlotDate(order.slotDate)}, {formatSlotType(order.slotType)}
          </div>
          <div>{order.address.line1}</div>
          {order.address.landmark && (
            <div className="text-muted-foreground">{order.address.landmark}</div>
          )}
          <div className="text-muted-foreground">
            {order.address.city} {order.address.pincode}
          </div>
          {order.customerNote && (
            <div className="pt-2 text-muted-foreground">Note: {order.customerNote}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <span>
                  {item.productName}{' '}
                  <span className="text-muted-foreground">
                    {item.variantLabel} × {item.quantity}
                  </span>
                </span>
                <span className="tabular-nums">{formatRupees(item.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items</span>
              <span className="tabular-nums">{formatRupees(order.itemsTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery</span>
              <span className="tabular-nums">
                {order.deliveryFee === '0.00' ? 'Free' : formatRupees(order.deliveryFee)}
              </span>
            </div>
            <div className="flex justify-between pt-1 text-base font-semibold">
              <span>
                {order.paymentStatus === 'PAID'
                  ? 'Paid'
                  : order.paymentMethod === 'COD'
                    ? 'Pay on delivery'
                    : 'To pay'}
              </span>
              <span className="tabular-nums">{formatRupees(order.grandTotal)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {CANCELLABLE.has(order.status) && (
        <Button variant="destructive" onClick={cancel} disabled={cancelling}>
          {cancelling ? 'Cancelling...' : 'Cancel this order'}
        </Button>
      )}
    </div>
  );
}
