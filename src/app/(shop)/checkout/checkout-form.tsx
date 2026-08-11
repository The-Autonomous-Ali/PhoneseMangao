'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCart } from '@/components/shop/cart-provider';
import { openRazorpayCheckout } from '@/components/shop/razorpay-checkout';
import { formatRupees, formatSlotDate, formatSlotType } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Address {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  pincode: string;
  isDefault: boolean;
}

interface Slot {
  id: string;
  date: string;
  slotType: string;
  remaining: number;
}

interface Quote {
  items: { variantId: string; productName: string; variantLabel: string; quantity: number; lineTotal: string }[];
  issues: { variantId: string; message: string }[];
  itemsTotal: string;
  deliveryFee: string;
  grandTotal: string;
  deliveryWaived: boolean;
  meetsMinimum: boolean;
  shortfall: string;
}

function AddressForm({ onCreated }: { onCreated: (address: Address) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    const data = new FormData(event.currentTarget);
    const response = await fetch('/api/addresses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: data.get('label'),
        line1: data.get('line1'),
        line2: data.get('line2'),
        landmark: data.get('landmark'),
        city: data.get('city'),
        pincode: data.get('pincode'),
        isDefault: true,
      }),
    });
    setSaving(false);

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error ?? 'Could not save that address');
      return;
    }
    onCreated(body.address);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="line1">Flat, building, street</Label>
        <Input id="line1" name="line1" required maxLength={120} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="landmark">Landmark</Label>
        <Input id="landmark" name="landmark" placeholder="Opposite the temple" maxLength={120} />
        <p className="text-xs text-muted-foreground">
          Our driver uses this more than the door number.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" required maxLength={60} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pincode">PIN code</Label>
          <Input id="pincode" name="pincode" inputMode="numeric" maxLength={6} required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="label">Save as</Label>
        <Input id="label" name="label" placeholder="Home" maxLength={30} />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save address'}
      </Button>
    </form>
  );
}

export function CheckoutForm({
  addresses: initialAddresses,
  minOrderValue,
  shopOpen,
  paymentsEnabled,
  customerName,
  customerPhone,
}: {
  addresses: Address[];
  minOrderValue: string;
  shopOpen: boolean;
  paymentsEnabled: boolean;
  customerName: string | null;
  customerPhone: string | null;
}) {
  const router = useRouter();
  const { items, hydrated, clear } = useCart();

  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'ONLINE'>(
    paymentsEnabled ? 'ONLINE' : 'COD'
  );
  const [addresses, setAddresses] = useState(initialAddresses);
  const [addressId, setAddressId] = useState(
    initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? ''
  );
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState('');
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    fetch('/api/slots?days=7')
      .then((r) => r.json())
      .then((data) => setSlots(data.slots ?? []))
      .catch(() => setError('Could not load delivery slots.'));
  }, []);

  // Re-quoted from the server whenever the basket changes, so the number on
  // the button is the number the order route will charge.
  useEffect(() => {
    if (!hydrated) return;
    fetch('/api/cart/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    })
      .then((r) => r.json())
      .then(setQuote)
      .catch(() => setError('Could not price your basket.'));
  }, [items, hydrated]);

  const slotsByDate = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of slots) {
      const list = grouped.get(slot.date) ?? [];
      list.push(slot);
      grouped.set(slot.date, list);
    }
    return [...grouped.entries()];
  }, [slots]);

  async function placeOrder() {
    setError(null);
    setPlacing(true);

    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items,
        addressId,
        slotId,
        paymentMethod,
        customerNote: note || undefined,
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setPlacing(false);
      setError(body.error ?? 'Could not place your order');
      // The basket moved under them; re-quote so the page shows what changed.
      if (body.code === 'CART_CHANGED' || body.code === 'SLOT_FULL') router.refresh();
      return;
    }

    // Cleared only after the order exists. Clearing optimistically would lose
    // the basket if the request had failed.
    clear();

    if (body.razorpayOrderId) {
      try {
        await openRazorpayCheckout({
          razorpayKeyId: body.razorpayKeyId,
          razorpayOrderId: body.razorpayOrderId,
          orderNumber: body.orderNumber,
          amountRupees: body.grandTotal,
          customerName,
          customerPhone,
        });
      } catch (widgetError) {
        // The order exists either way. Sending them to it beats stranding them
        // here — the order page shows what state the payment is in.
        console.error('[checkout] payment widget failed', widgetError);
      }
    }

    setPlacing(false);
    router.push(`/orders/${body.orderId}`);
  }

  if (!hydrated) return <p className="text-sm text-muted-foreground">Loading...</p>;

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">Your basket is empty.</p>
        <Link href="/" className={buttonVariants({ className: 'mt-4' })}>
          Start shopping
        </Link>
      </div>
    );
  }

  const canPlace =
    shopOpen && Boolean(addressId) && Boolean(slotId) && quote?.meetsMinimum && !placing;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Delivery address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {addresses.length === 0 ? (
              <AddressForm
                onCreated={(address) => {
                  setAddresses((current) => [...current, address]);
                  setAddressId(address.id);
                }}
              />
            ) : (
              addresses.map((address) => (
                <label
                  key={address.id}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-lg border p-3',
                    addressId === address.id && 'border-foreground/40 bg-muted/50'
                  )}
                >
                  <input
                    type="radio"
                    name="address"
                    className="mt-1"
                    checked={addressId === address.id}
                    onChange={() => setAddressId(address.id)}
                  />
                  <div className="text-sm">
                    {address.label && <div className="font-medium">{address.label}</div>}
                    <div>{address.line1}</div>
                    {address.landmark && (
                      <div className="text-muted-foreground">{address.landmark}</div>
                    )}
                    <div className="text-muted-foreground">
                      {address.city} {address.pincode}
                    </div>
                  </div>
                </label>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery slot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {slotsByDate.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No slots open right now. Please try again shortly.
              </p>
            )}
            {slotsByDate.map(([date, daySlots]) => (
              <div key={date}>
                <div className="mb-2 text-sm font-medium">{formatSlotDate(date)}</div>
                <div className="flex flex-wrap gap-2">
                  {daySlots.map((slot) => {
                    const full = slot.remaining <= 0;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        disabled={full}
                        onClick={() => setSlotId(slot.id)}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-sm',
                          slotId === slot.id && 'border-foreground/40 bg-muted',
                          full && 'cursor-not-allowed opacity-50'
                        )}
                      >
                        {formatSlotType(slot.slotType)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {full ? 'Full' : `${slot.remaining} left`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Anything else?</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={2}
              maxLength={500}
              placeholder="Ring the bell twice, leave with the watchman..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Order summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {quote?.issues.map((issue) => (
            <p key={issue.variantId} className="text-gold">
              {issue.message}
            </p>
          ))}

          <div className="flex justify-between">
            <span className="text-muted-foreground">Items</span>
            <span className="tabular-nums">{formatRupees(quote?.itemsTotal ?? '0.00')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Delivery</span>
            <span className="tabular-nums">
              {quote?.deliveryWaived ? 'Free' : formatRupees(quote?.deliveryFee ?? '0.00')}
            </span>
          </div>
          <div className="flex justify-between border-t pt-3 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatRupees(quote?.grandTotal ?? '0.00')}</span>
          </div>

          {quote && !quote.meetsMinimum && (
            <p className="rounded-md bg-gold/10 px-3 py-2 text-gold">
              Minimum order is {formatRupees(minOrderValue)}. Add{' '}
              {formatRupees(quote.shortfall)} more to check out.
            </p>
          )}

          {!shopOpen && (
            <p className="rounded-md bg-gold/10 px-3 py-2 text-gold">
              The shop is closed right now.
            </p>
          )}

          <div className="space-y-2 border-t pt-3">
            <div className="font-medium">Payment</div>
            {paymentsEnabled && (
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="payment"
                  className="mt-1"
                  checked={paymentMethod === 'ONLINE'}
                  onChange={() => setPaymentMethod('ONLINE')}
                />
                <span>
                  Pay now
                  <span className="block text-xs text-muted-foreground">
                    UPI, card or netbanking
                  </span>
                </span>
              </label>
            )}
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="payment"
                className="mt-1"
                checked={paymentMethod === 'COD'}
                onChange={() => setPaymentMethod('COD')}
              />
              <span>
                Cash on delivery
                <span className="block text-xs text-muted-foreground">
                  We send a code on WhatsApp to confirm
                </span>
              </span>
            </label>
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button size="lg" className="w-full" disabled={!canPlace} onClick={placeOrder}>
            {placing
              ? 'Placing order...'
              : paymentMethod === 'ONLINE'
                ? `Pay ${formatRupees(quote?.grandTotal ?? '0.00')}`
                : 'Place order'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
