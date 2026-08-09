'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  readCart,
  writeCart,
  addItem,
  setQuantity as setQuantityIn,
  removeItem as removeItemFrom,
  totalQuantity,
  type CartItem,
} from '@/lib/cart';

interface CartContextValue {
  items: CartItem[];
  count: number;
  /**
   * False until localStorage has been read. Anything that renders a cart-
   * dependent number must wait for this: the server has no localStorage, so
   * rendering a count of 0 and then 3 is a hydration mismatch React will
   * complain about and, worse, a visible flicker on every page load.
   */
  hydrated: boolean;
  add: (variantId: string, quantity?: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(readCart());
    setHydrated(true);
  }, []);

  // Guarded on `hydrated` so the initial empty state is never written over a
  // real cart before it has been read back.
  useEffect(() => {
    if (hydrated) writeCart(items);
  }, [items, hydrated]);

  const add = useCallback((variantId: string, quantity = 1) => {
    setItems((current) => addItem(current, variantId, quantity));
  }, []);

  const setQuantity = useCallback((variantId: string, quantity: number) => {
    setItems((current) => setQuantityIn(current, variantId, quantity));
  }, []);

  const remove = useCallback((variantId: string) => {
    setItems((current) => removeItemFrom(current, variantId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return (
    <CartContext.Provider
      value={{ items, count: totalQuantity(items), hydrated, add, setQuantity, remove, clear }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside a CartProvider');
  return context;
}
