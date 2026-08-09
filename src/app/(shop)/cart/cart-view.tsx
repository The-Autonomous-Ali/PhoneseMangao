'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useCart } from '@/components/shop/cart-provider';
import { usePincode } from '@/components/shop/pincode-provider';
import { formatRupees } from '@/lib/format';
import { cn } from '@/lib/utils';

interface PricedLine {
  variantId: string;
  productSlug: string;
  productName: string;
  variantLabel: string;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

interface Issue {
  variantId: string;
  reason: string;
  message: string;
}

interface ValidatedCart {
  items: PricedLine[];
  issues: Issue[];
  itemsTotal: string;
  deliveryFee: string;
  grandTotal: string;
  deliveryWaived: boolean;
  meetsMinimum: boolean;
  shortfall: string;
  shopOpen: boolean;
}

export function CartView() {
  const { items, setQuantity, remove, hydrated } = useCart();
  const { pincode } = usePincode();
  const [priced, setPriced] = useState<ValidatedCart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-priced from the server on every change. The browser holds only ids and
  // quantities, so this is the only place the cart has a value at all — and it
  // is where a price change or a sell-out since the item was added surfaces.
  useEffect(() => {
    if (!hydrated) return;

    let cancelled = false;
    setLoading(true);

    fetch('/api/cart/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((data: ValidatedCart) => {
        if (!cancelled) {
          setPriced(data);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not refresh prices. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [items, hydrated]);

  if (!hydrated || (loading && !priced)) {
    return <p className="text-sm text-muted-foreground">Loading your basket...</p>;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">Your basket is empty.</p>
        <Link href="/" className={buttonVariants({ className: 'mt-4' })}>
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {priced && priced.issues.length > 0 && (
        <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {priced.issues.map((issue) => (
            <li key={`${issue.variantId}-${issue.reason}`}>{issue.message}</li>
          ))}
        </ul>
      )}

      <ul className="divide-y rounded-xl border">
        {priced?.items.map((line) => (
          <li key={line.variantId} className="flex items-center gap-3 p-3">
            {line.imageUrl ? (
              <Image
                src={line.imageUrl}
                alt=""
                width={56}
                height={56}
                className="size-14 shrink-0 rounded-md object-cover"
              />
            ) : (
              <div className="size-14 shrink-0 rounded-md bg-muted" />
            )}

            <div className="min-w-0 flex-1">
              <Link href={`/product/${line.productSlug}`} className="font-medium hover:underline">
                {line.productName}
              </Link>
              <div className="text-sm text-muted-foreground">
                {line.variantLabel} · {formatRupees(line.unitPrice)}
              </div>
            </div>

            <div className="flex items-center gap-1 rounded-lg border px-1 py-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove one ${line.productName}`}
                onClick={() => setQuantity(line.variantId, line.quantity - 1)}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Add one more ${line.productName}`}
                onClick={() => setQuantity(line.variantId, line.quantity + 1)}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>

            <div className="w-20 shrink-0 text-right font-medium tabular-nums">
              {formatRupees(line.lineTotal)}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${line.productName} from basket`}
              onClick={() => remove(line.variantId)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>

      <div className="space-y-3 rounded-xl border p-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Items</span>
          <span className="tabular-nums">{formatRupees(priced?.itemsTotal ?? '0.00')}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            Delivery{pincode ? ` to ${pincode}` : ''}
          </span>
          <span className="tabular-nums">
            {priced?.deliveryWaived ? 'Free' : formatRupees(priced?.deliveryFee ?? '0.00')}
          </span>
        </div>
        <div className="flex justify-between border-t pt-3 text-lg font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatRupees(priced?.grandTotal ?? '0.00')}</span>
        </div>

        {priced && !priced.meetsMinimum && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Add {formatRupees(priced.shortfall)} more to reach the minimum order.
          </p>
        )}

        {priced && !priced.shopOpen && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The shop is closed right now.
          </p>
        )}

        {/* Disabled rather than hidden, so the reason is visible. The same two
            rules are enforced again in POST /api/orders — a disabled button is
            not a constraint. */}
        <Link
          href="/checkout"
          aria-disabled={!priced?.meetsMinimum || !priced?.shopOpen}
          className={cn(
            buttonVariants({ size: 'lg', className: 'w-full' }),
            (!priced?.meetsMinimum || !priced?.shopOpen) && 'pointer-events-none opacity-50'
          )}
        >
          Checkout
        </Link>
      </div>
    </div>
  );
}
