import Image from 'next/image';
import Link from 'next/link';
import { AddToCart } from './add-to-cart';
import { formatRupees } from '@/lib/format';
import type { ShopProduct } from '@/lib/shop-queries';

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

export function ProductCard({ product }: { product: ShopProduct }) {
  const variant = headlineVariant(product);
  if (!variant) return null;

  const otherSizes = product.variants.length - 1;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border">
      <Link href={`/product/${product.slug}`} className="block">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            width={300}
            height={200}
            className="aspect-[3/2] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[3/2] w-full items-center justify-center bg-muted text-sm text-muted-foreground">
            {product.name}
          </div>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <Link href={`/product/${product.slug}`} className="font-medium hover:underline">
          {product.name}
        </Link>

        <div className="flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{formatRupees(variant.price)}</span>
          {variant.mrp && Number(variant.mrp) > Number(variant.price) && (
            <span className="text-sm text-muted-foreground line-through tabular-nums">
              {formatRupees(variant.mrp)}
            </span>
          )}
          <span className="text-sm text-muted-foreground">/ {variant.label}</span>
        </div>

        {otherSizes > 0 && (
          <Link
            href={`/product/${product.slug}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            +{otherSizes} more size{otherSizes === 1 ? '' : 's'}
          </Link>
        )}

        <div className="mt-auto pt-1">
          <AddToCart
            variantId={variant.id}
            disabled={!variant.isAvailable}
            label={`${product.name} ${variant.label}`}
          />
        </div>
      </div>
    </div>
  );
}
