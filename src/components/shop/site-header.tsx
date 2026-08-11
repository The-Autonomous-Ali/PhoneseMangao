'use client';

import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { SHOP_NAME } from '@/lib/constants';
import { useCart } from './cart-provider';
import { usePincode } from './pincode-provider';

/**
 * The design's header: a wordmark, a cream search pill, and a gold cart pill.
 *
 * The search field is a plain GET form: no state, no router push, no
 * `useSearchParams`. That last one matters more than it looks. This header is
 * on every page, and reading the query string here would drag every one of
 * them — the cart included — out of static rendering and into a Suspense
 * boundary, all to pre-fill a box. The search page shows the query in its own
 * heading instead.
 *
 * A plain form also submits before React has hydrated, which is worth having on
 * the connections this shop's customers are actually on.
 */
export function SiteHeader() {
  const { count, hydrated: cartHydrated } = useCart();
  const { pincode, hydrated: pincodeHydrated, change } = usePincode();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-3 px-5 py-3">
        <Link href="/" className="font-heading text-xl tracking-wide whitespace-nowrap">
          {SHOP_NAME}
        </Link>

        <form
          action="/search"
          method="get"
          className="order-3 flex h-11 w-full min-w-[220px] flex-1 items-center gap-3 rounded-full border border-gold bg-[#f3eee2] py-2.5 pr-2 pl-5 shadow-[0_2px_14px_rgba(0,0,0,0.25)] sm:order-none sm:w-auto"
        >
          <span aria-hidden className="text-[#0f2118]">
            ⌕
          </span>
          <input
            name="q"
            placeholder="Search mangoes, tomatoes, atta…"
            aria-label="Search the shop"
            className="min-w-0 flex-1 border-none bg-transparent text-[15px] text-[#132019] outline-none placeholder:text-[#6b7d70]"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-[#132a20] px-4.5 py-2 text-[13.5px] font-semibold tracking-wide text-[#d4b15e] transition-colors hover:bg-[#0c1712]"
          >
            Search
          </button>
        </form>

        {/* Reads localStorage, so it waits for hydration rather than flashing a
            wrong value on first paint. Shown either way now: with a PIN code it
            reports where we are delivering, without one it is the only thing
            offering to check — the panel no longer opens by itself. */}
        {pincodeHydrated && (
          <button
            type="button"
            onClick={change}
            className="flex items-center gap-1 rounded-full px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-gold"
          >
            <MapPin className="size-4" />
            {pincode ?? 'Check delivery'}
          </button>
        )}

        <Link
          href="/orders"
          className="rounded-full px-3 py-2 text-sm text-foreground/80 transition-colors hover:text-gold"
        >
          Orders
        </Link>

        <Link
          href="/cart"
          aria-label={cartHydrated ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart'}
          className="flex items-center gap-2.5 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-[#132019] transition-colors hover:bg-gold-hover"
        >
          <span>Cart</span>
          <span className="inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-[#d4b15e] px-1.5 text-xs text-[#2a1608] tabular-nums">
            {cartHydrated ? (count > 99 ? '99+' : count) : 0}
          </span>
        </Link>
      </div>
    </header>
  );
}
