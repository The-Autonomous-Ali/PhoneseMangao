'use client';

import Link from 'next/link';
import { ShoppingCart, MapPin } from 'lucide-react';
import { SHOP_NAME } from '@/lib/constants';
import { useCart } from './cart-provider';
import { usePincode } from './pincode-provider';

export function SiteHeader() {
  const { count, hydrated: cartHydrated } = useCart();
  const { pincode, hydrated: pincodeHydrated, change } = usePincode();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          {SHOP_NAME}
        </Link>

        <div className="flex-1" />

        {/* Both of these read localStorage, so both wait for hydration. The
            reserved width keeps the header from jumping when they appear. */}
        {pincodeHydrated && pincode && (
          <button
            type="button"
            onClick={change}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MapPin className="size-4" />
            {pincode}
          </button>
        )}

        <Link
          href="/cart"
          className="relative flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted"
          aria-label={cartHydrated ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart'}
        >
          <ShoppingCart className="size-5" />
          {cartHydrated && count > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground tabular-nums">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
