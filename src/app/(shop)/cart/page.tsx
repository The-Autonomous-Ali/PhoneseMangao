import type { Metadata } from 'next';
import { CartView } from './cart-view';
import { SHOP_NAME } from '@/lib/constants';

export const metadata: Metadata = {
  title: `Your basket — ${SHOP_NAME}`,
  // A basket is per-person and has nothing to offer a search result.
  robots: { index: false },
};

export default function CartPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Your cart</h1>
      <CartView />
    </div>
  );
}
