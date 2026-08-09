import { NextRequest, NextResponse } from 'next/server';
import { cartSchema } from '@/lib/cart';
import { priceCart } from '@/lib/cart-pricing';
import { getShopSettings } from '@/lib/settings';
import { calculateTotals } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

/**
 * Re-prices a basket and quotes what it would cost to order.
 *
 * Called when the cart page loads and again at checkout. The same `priceCart`
 * and `calculateTotals` run inside order creation, so the figure quoted here is
 * the figure charged there.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = cartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid cart' }, { status: 400 });
  }

  const priced = await priceCart(parsed.data.items);
  const settings = await getShopSettings();
  const totals = calculateTotals(priced.itemsTotal, settings);

  // `totals` already carries itemsTotal, normalised to two decimals — it is the
  // authority, so it is not restated above the spread.
  return NextResponse.json({
    items: priced.items,
    issues: priced.issues,
    ...totals,
    shopOpen: settings.shopOpen,
  });
}
