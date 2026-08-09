import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { cartSchema } from '@/lib/cart';

export const dynamic = 'force-dynamic';

export type CartIssueReason = 'REMOVED' | 'UNAVAILABLE' | 'STOCK';

interface PricedLine {
  variantId: string;
  productSlug: string;
  productName: string;
  variantLabel: string;
  imageUrl: string | null;
  /** Decimal serialised as a string, so no rounding happens in transit. */
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

interface CartIssue {
  variantId: string;
  reason: CartIssueReason;
  message: string;
}

/**
 * Re-prices a cart from the database and reports what changed.
 *
 * The browser stores only variant ids and quantities, so this is where a cart
 * becomes money. Nothing the client sends about price is read, because nothing
 * it sends about price exists — which is the point. It is called when the cart
 * page loads and again at checkout, so a price change or a sell-out between
 * those two moments is caught rather than carried into an order.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = cartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid cart' }, { status: 400 });
  }

  const { items } = parsed.data;
  if (items.length === 0) {
    return NextResponse.json({ items: [], issues: [], itemsTotal: '0.00' });
  }

  const variants = await withDbRetry(() =>
    db.variant.findMany({
      where: { id: { in: items.map((item) => item.variantId) } },
      include: { product: { include: { category: true } } },
    })
  );

  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const lines: PricedLine[] = [];
  const issues: CartIssue[] = [];
  let itemsTotal = new Prisma.Decimal(0);

  for (const item of items) {
    const variant = byId.get(item.variantId);

    if (!variant) {
      issues.push({
        variantId: item.variantId,
        reason: 'REMOVED',
        message: 'This item is no longer sold',
      });
      continue;
    }

    // A switched-off category hides its products without touching their rows,
    // so the category flag has to be checked here too — otherwise a hidden
    // aisle stays buyable through a cart saved before it was hidden.
    const hidden =
      !variant.isAvailable || !variant.product.isActive || !variant.product.category.isActive;

    if (hidden) {
      issues.push({
        variantId: item.variantId,
        reason: 'UNAVAILABLE',
        message: `${variant.product.name} (${variant.label}) is sold out`,
      });
      continue;
    }

    // stockQty is nullable: null means the shop does not track stock for this
    // item, which is the common case for loose produce.
    let quantity = item.quantity;
    if (variant.stockQty !== null && variant.stockQty < quantity) {
      if (variant.stockQty === 0) {
        issues.push({
          variantId: item.variantId,
          reason: 'UNAVAILABLE',
          message: `${variant.product.name} (${variant.label}) is sold out`,
        });
        continue;
      }
      quantity = variant.stockQty;
      issues.push({
        variantId: item.variantId,
        reason: 'STOCK',
        message: `Only ${quantity} left of ${variant.product.name} (${variant.label})`,
      });
    }

    // Decimal arithmetic throughout. Multiplying through JS numbers would round
    // at the third line item and never reconcile against the bank settlement.
    const lineTotal = variant.price.mul(quantity);
    itemsTotal = itemsTotal.add(lineTotal);

    lines.push({
      variantId: variant.id,
      productSlug: variant.product.slug,
      productName: variant.product.name,
      variantLabel: variant.label,
      imageUrl: variant.product.imageUrl,
      unitPrice: variant.price.toFixed(2),
      quantity,
      lineTotal: lineTotal.toFixed(2),
    });
  }

  return NextResponse.json({ items: lines, issues, itemsTotal: itemsTotal.toFixed(2) });
}
