import Image from 'next/image';
import Link from 'next/link';
import { AddToCart } from './add-to-cart';
import { formatRupees } from '@/lib/format';
import type { ShopProduct, ShopVariant } from '@/lib/shop-queries';

/**
 * Shows the cheapest size that is actually buyable.
 *
 * Leading with a sold-out size would advertise a price nobody can pay, and
 * leading with the most expensive one makes the shop look dear next to a
 * competitor listing the small pack.
 */
function headlineVariant(product: ShopProduct) {
  return product.variants.find((variant) => variant.isAvailable) ?? product.variants[0];
}

/**
 * Whole percent off, or null when there is nothing to boast about.
 *
 * Computed from the two figures already on the variant rather than stored:
 * a discount that can disagree with the prices either side of it is worse than
 * no discount at all. Rounded down, so the badge never overstates the saving.
 */
function discountPercent(variant: ShopVariant): number | null {
  if (!variant.mrp) return null;
  const mrp = Number(variant.mrp);
  const price = Number(variant.price);
  if (!(mrp > price) || mrp <= 0) return null;
  const percent = Math.floor(((mrp - price) / mrp) * 100);
  return percent >= 1 ? percent : null;
}

export function ProductCard({ product }: { product: ShopProduct }) {
  const variant = headlineVariant(product);
  if (!variant) return null;

  const otherSizes = product.variants.length - 1;
  const discount = discountPercent(variant);
  const soldOut = !variant.isAvailable;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-gold/60">
      <Link href={`/product/${product.slug}`} className="relative block aspect-square">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className="object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted px-3 text-center font-heading text-lg text-muted-foreground">
            {product.name}
          </div>
        )}

        {discount !== null && (
          <span className="absolute top-2.5 left-2.5 rounded-md bg-[#20392d] px-2.5 py-1 text-[11.5px] font-bold text-[#d4b15e]">
            {discount}% off
          </span>
        )}

        <span className="absolute bottom-2.5 left-2.5 rounded-md bg-[rgba(12,24,18,0.72)] px-2 py-0.5 font-mono text-[10.5px] text-[#cbd6cd]">
          {variant.label}
        </span>
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <div className="text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
          {product.categoryName}
        </div>

        <Link
          href={`/product/${product.slug}`}
          className="mt-1 text-base leading-tight font-semibold hover:text-gold"
        >
          {product.name}
        </Link>

        <div className="mt-0.5 text-[13px] text-muted-foreground">
          {soldOut ? 'Sold out' : `per ${variant.label}`}
          {otherSizes > 0 && ` · +${otherSizes} more size${otherSizes === 1 ? '' : 's'}`}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-3.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-foreground tabular-nums">
              {formatRupees(variant.price)}
            </span>
            {discount !== null && variant.mrp && (
              <span className="text-[13px] text-muted-foreground line-through tabular-nums">
                {formatRupees(variant.mrp)}
              </span>
            )}
          </div>

          <AddToCart
            variantId={variant.id}
            disabled={soldOut}
            label={`${product.name} ${variant.label}`}
          />
        </div>
      </div>
    </div>
  );
}
