import { Prisma, type UnitType } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import type { CartItem } from '@/lib/cart';

export type CartIssueReason = 'REMOVED' | 'UNAVAILABLE' | 'STOCK';

export interface PricedLine {
  variantId: string;
  productSlug: string;
  productName: string;
  variantLabel: string;
  unitType: UnitType;
  imageUrl: string | null;
  /** Decimal serialised as a string, so nothing rounds in transit. */
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface CartIssue {
  variantId: string;
  reason: CartIssueReason;
  message: string;
}

export interface PricedCart {
  items: PricedLine[];
  issues: CartIssue[];
  itemsTotal: string;
}

/**
 * Turns variant ids and quantities into money, reading every price from the
 * database.
 *
 * Shared by the cart page and by order creation on purpose: quoting a total
 * from one code path and charging from another is how a shop ends up honouring
 * a price it never set. The browser stores no prices, so there is nothing here
 * to trust or ignore — the numbers only exist once this function has run.
 */
export async function priceCart(items: CartItem[]): Promise<PricedCart> {
  if (items.length === 0) return { items: [], issues: [], itemsTotal: '0.00' };

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
    // so the category flag is checked here too — otherwise a hidden aisle stays
    // buyable through a basket saved before it was hidden.
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
    // item, which is the normal case for loose produce.
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

    const lineTotal = variant.price.mul(quantity);
    itemsTotal = itemsTotal.add(lineTotal);

    lines.push({
      variantId: variant.id,
      productSlug: variant.product.slug,
      productName: variant.product.name,
      variantLabel: variant.label,
      unitType: variant.unitType,
      imageUrl: variant.product.imageUrl,
      unitPrice: variant.price.toFixed(2),
      quantity,
      lineTotal: lineTotal.toFixed(2),
    });
  }

  return { items: lines, issues, itemsTotal: itemsTotal.toFixed(2) };
}
