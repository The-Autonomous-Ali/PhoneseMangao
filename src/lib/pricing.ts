import { Prisma } from '@prisma/client';
import type { ShopSettings } from '@/lib/settings';

export interface OrderTotals {
  itemsTotal: string;
  deliveryFee: string;
  grandTotal: string;
  /** True when the basket earned free delivery, so the UI can say why. */
  deliveryWaived: boolean;
  meetsMinimum: boolean;
  /** How much more is needed to check out. '0.00' once the minimum is met. */
  shortfall: string;
}

/**
 * Turns a basket subtotal into what the customer owes.
 *
 * Kept out of both the cart page and the order route so the number quoted and
 * the number charged cannot drift: the same function produces both. All
 * arithmetic is Decimal — the fee threshold is an equality comparison against a
 * customer's money, and binary floating point makes ₹500.00 fail a `>= 500`
 * test often enough to generate complaints.
 */
export function calculateTotals(itemsTotal: string, settings: ShopSettings): OrderTotals {
  const items = new Prisma.Decimal(itemsTotal);
  const minimum = new Prisma.Decimal(settings.minOrderValue);
  const threshold = new Prisma.Decimal(settings.freeDeliveryAbove);

  // "at or above", not "above": a customer who hits the advertised figure
  // exactly has met it, and being charged anyway reads as a bug.
  const deliveryWaived = items.greaterThanOrEqualTo(threshold);
  const deliveryFee = deliveryWaived ? new Prisma.Decimal(0) : new Prisma.Decimal(settings.deliveryFee);

  const meetsMinimum = items.greaterThanOrEqualTo(minimum);
  const shortfall = meetsMinimum ? new Prisma.Decimal(0) : minimum.sub(items);

  // An empty basket is not "below the minimum", it is nothing to order. Callers
  // check for zero lines separately; this keeps the message sensible either way.
  return {
    itemsTotal: items.toFixed(2),
    deliveryFee: deliveryFee.toFixed(2),
    grandTotal: items.add(deliveryFee).toFixed(2),
    deliveryWaived,
    meetsMinimum,
    shortfall: shortfall.toFixed(2),
  };
}
