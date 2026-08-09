'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRupees, formatSlotDate, formatSlotType } from '@/lib/format';

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
    <Card className="border-amber-300 bg-amber-50/50">
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
          <p className="mt-2 text-sm text-red-600" role="alert">
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Order {order.orderNumber}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {STATUS_LABELS[order.status] ?? order.status}
          {order.cancelReason && ` — ${order.cancelReason}`}
        </p>
      </div>

      {order.status === 'PENDING_OTP' && <ConfirmPanel orderId={order.id} />}

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
              <span>Pay on delivery</span>
              <span className="tabular-nums">{formatRupees(order.grandTotal)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
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
