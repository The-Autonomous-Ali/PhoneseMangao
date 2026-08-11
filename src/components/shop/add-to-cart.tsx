'use client';

import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';
import { useCart } from './cart-provider';

/**
 * An Add button that becomes a quantity stepper once the item is in the cart.
 *
 * One control rather than two, because the second tap on a grocery site is
 * almost always "one more of the same" — making that a second click on the
 * same spot is the difference between adding six onions and giving up.
 */
export function AddToCart({
  variantId,
  disabled,
  label,
  size = 'default',
  compact = false,
}: {
  variantId: string;
  disabled?: boolean;
  label: string;
  size?: 'default' | 'lg';
  /**
   * The square "+" the design puts on a product card, rather than a full-width
   * button. On a card the button shares its row with the price, so a `w-full`
   * control resolves to the whole row and overflows the card into its
   * neighbour.
   */
  compact?: boolean;
}) {
  const { items, add, setQuantity, hydrated } = useCart();
  const quantity = items.find((item) => item.variantId === variantId)?.quantity ?? 0;

  if (disabled) {
    return compact ? (
      <span className="shrink-0 rounded-[9px] border border-border px-2.5 py-1.5 text-xs text-muted-foreground">
        Sold out
      </span>
    ) : (
      <Button size={size} variant="outline" disabled className="w-full">
        Sold out
      </Button>
    );
  }

  // Until localStorage has been read the true quantity is unknown, so the
  // button renders in its resting state to avoid a hydration mismatch.
  if (!hydrated || quantity === 0) {
    return compact ? (
      <button
        type="button"
        aria-label={`Add ${label}`}
        onClick={() => add(variantId)}
        className="size-8.5 shrink-0 rounded-[9px] border border-border bg-[#20392d] text-xl leading-none font-semibold text-gold transition-colors hover:bg-gold hover:text-[#132019]"
      >
        +
      </button>
    ) : (
      <Button size={size} className="w-full" onClick={() => add(variantId)}>
        Add
      </Button>
    );
  }

  if (compact) {
    return (
      <div className="flex shrink-0 items-center rounded-full border border-border">
        <button
          type="button"
          aria-label={`Remove one ${label}`}
          onClick={() => setQuantity(variantId, quantity - 1)}
          className="size-8 text-lg leading-none text-gold"
        >
          −
        </button>
        <span className="w-5 text-center text-sm font-semibold tabular-nums" aria-live="polite">
          {quantity}
        </span>
        <button
          type="button"
          aria-label={`Add one more ${label}`}
          onClick={() => setQuantity(variantId, quantity + 1)}
          className="size-8 text-lg leading-none text-gold"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center justify-between gap-2 rounded-lg border px-1 py-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove one ${label}`}
        onClick={() => setQuantity(variantId, quantity - 1)}
      >
        <Minus className="size-3.5" />
      </Button>
      <span className="text-sm font-medium tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Add one more ${label}`}
        onClick={() => setQuantity(variantId, quantity + 1)}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}
