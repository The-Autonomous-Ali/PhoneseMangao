import type { Metadata } from 'next';
import { CartView } from './cart-view';
import { getShopSettings } from '@/lib/settings';
import { SHOP_NAME } from '@/lib/constants';

// The cart reads settings for the WhatsApp number, so it can no longer be
// prerendered at build time.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Your basket — ${SHOP_NAME}`,
  // A basket is per-person and has nothing to offer a search result.
  robots: { index: false },
};

export default async function CartPage() {
  const settings = await getShopSettings();

  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Your cart</h1>
      <CartView whatsappNumber={settings.whatsappNumber} />
    </div>
  );
}
