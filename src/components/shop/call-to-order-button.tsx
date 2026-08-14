'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Phone, X } from 'lucide-react';
import { useCart } from '@/components/shop/cart-provider';
import { usePincode } from '@/components/shop/pincode-provider';
import { SHOP_NAME } from '@/lib/constants';
import { whatsappLink, floatingButtonMessage } from '@/lib/whatsapp-order';
import { cn } from '@/lib/utils';

interface PricedLine {
  productName: string;
  variantLabel: string;
  quantity: number;
  lineTotal: string;
}

interface ValidatedCart {
  items: PricedLine[];
  grandTotal: string;
}

/**
 * Floating call/WhatsApp button, present on every storefront page.
 *
 * Hidden entirely when the shop has given no number — same rule
 * `whatsappLink` already follows elsewhere: a dead button reads as the shop
 * ignoring you, which is worse than not offering one.
 */
export function CallToOrderButton({ phoneNumber }: { phoneNumber?: string }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const { items } = useCart();
  const { pincode } = usePincode();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onOutsideClick(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [open]);

  if (!phoneNumber) return null;

  const telLink = `tel:${phoneNumber.replace(/[^\d+]/g, '')}`;

  // Fetched fresh on every tap rather than kept in state: prices and stock
  // can change between page load and the moment someone actually asks, and
  // this is the message the shop will act on.
  async function openWhatsapp() {
    if (items.length === 0) {
      openLink(floatingButtonMessage({ shopName: SHOP_NAME, cart: null }));
      return;
    }

    setSending(true);
    try {
      const response = await fetch('/api/cart/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!response.ok) throw new Error('validate failed');
      const data: ValidatedCart = await response.json();

      openLink(
        floatingButtonMessage({
          shopName: SHOP_NAME,
          cart: { lines: data.items, total: data.grandTotal, pincode },
        })
      );
    } catch {
      // A pricing hiccup must not stop someone from reaching the shop — it
      // just means the message can't list what they picked.
      openLink(floatingButtonMessage({ shopName: SHOP_NAME, cart: null }));
    } finally {
      setSending(false);
    }
  }

  function openLink(message: string) {
    const url = whatsappLink(phoneNumber!, message);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    setOpen(false);
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Contact the shop"
          className="flex w-56 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          <a
            href={telLink}
            role="menuitem"
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <Phone className="size-4 text-muted-foreground" />
            Call Shop
          </a>
          <button
            type="button"
            role="menuitem"
            className="flex items-center gap-3 border-t border-border px-4 py-3 text-left text-sm hover:bg-muted disabled:opacity-50"
            onClick={openWhatsapp}
            disabled={sending}
          >
            <MessageCircle className="size-4 text-muted-foreground" />
            {sending ? 'Opening WhatsApp…' : 'WhatsApp Shop'}
          </button>
        </div>
      )}

      <button
        type="button"
        aria-label={open ? 'Close contact menu' : 'Call or WhatsApp the shop'}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:bg-primary/80 active:scale-95'
        )}
      >
        {open ? <X className="size-5" /> : <Phone className="size-5" />}
      </button>
    </div>
  );
}
