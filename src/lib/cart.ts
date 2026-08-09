import { z } from 'zod';
import { CART_STORAGE_KEY } from '@/lib/constants';

/**
 * Everything the browser is allowed to remember about the cart.
 *
 * No price, no name, no image. Prices are re-read from the database at every
 * checkpoint, so a tampered localStorage can change what someone is buying but
 * never what they pay. It also means a cart survives a price change without
 * going stale, and a guest can fill one before signing in.
 */
export interface CartItem {
  variantId: string;
  quantity: number;
}

/** Guards against a stock-count typo turning into a 900-kilo onion order. */
export const MAX_QUANTITY_PER_ITEM = 99;

export const cartItemSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_ITEM),
});

export const cartSchema = z.object({
  // A cap on distinct lines, not on value. Without one, a script could post a
  // hundred thousand ids and make the server do a hundred thousand lookups.
  items: z.array(cartItemSchema).max(100),
});

/**
 * Reads the cart, discarding anything that no longer parses.
 *
 * localStorage is user-writable and survives deploys, so it will eventually
 * hold a shape from an older version of this code. Dropping bad entries keeps
 * a corrupt value from breaking the whole storefront on load.
 */
export function readCart(): CartItem[] {
  if (typeof window === 'undefined') return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const result = cartItemSchema.safeParse(entry);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Private browsing and a full quota both throw here. Losing the cart is
    // bad; taking the page down with it is worse.
  }
}

/** Adding something already in the cart tops it up rather than duplicating it. */
export function addItem(items: CartItem[], variantId: string, quantity = 1): CartItem[] {
  const existing = items.find((item) => item.variantId === variantId);
  if (!existing) return [...items, { variantId, quantity }];

  return items.map((item) =>
    item.variantId === variantId
      ? { ...item, quantity: Math.min(item.quantity + quantity, MAX_QUANTITY_PER_ITEM) }
      : item
  );
}

/** Setting a quantity of zero removes the line, which is what a stepper expects. */
export function setQuantity(items: CartItem[], variantId: string, quantity: number): CartItem[] {
  if (quantity <= 0) return items.filter((item) => item.variantId !== variantId);

  return items.map((item) =>
    item.variantId === variantId
      ? { ...item, quantity: Math.min(quantity, MAX_QUANTITY_PER_ITEM) }
      : item
  );
}

export function removeItem(items: CartItem[], variantId: string): CartItem[] {
  return items.filter((item) => item.variantId !== variantId);
}

export function totalQuantity(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
