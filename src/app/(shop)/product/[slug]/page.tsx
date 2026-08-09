import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductBySlug } from '@/lib/shop-queries';
import { AddToCart } from '@/components/shop/add-to-cart';
import { formatRupees } from '@/lib/format';
import { SHOP_NAME } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: `Not found — ${SHOP_NAME}` };

  const cheapest = product.variants[0];

  return {
    title: `${product.name} — ${SHOP_NAME}`,
    description:
      product.description ??
      `Buy ${product.name} online${cheapest ? ` from ${formatRupees(cheapest.price)}` : ''}. Delivered fresh by ${SHOP_NAME}.`,
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/category/${product.categorySlug}`} className="hover:underline">
          {product.categoryName}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-6 md:grid-cols-2">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            width={600}
            height={400}
            className="aspect-[3/2] w-full rounded-xl object-cover"
            priority
          />
        ) : (
          <div className="flex aspect-[3/2] w-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
            No photo
          </div>
        )}

        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold">{product.name}</h1>
            {product.description && (
              <p className="mt-2 text-sm text-muted-foreground">{product.description}</p>
            )}
          </div>

          {/* Every size gets its own row and its own add control. A dropdown
              would hide the price differences that decide the purchase. */}
          <div className="space-y-2">
            <h2 className="text-sm font-medium">Choose a size</h2>
            {product.variants.map((variant) => (
              <div
                key={variant.id}
                className="flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <div>
                  <div className="font-medium">{variant.label}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="tabular-nums">{formatRupees(variant.price)}</span>
                    {variant.mrp && Number(variant.mrp) > Number(variant.price) && (
                      <span className="text-sm text-muted-foreground line-through tabular-nums">
                        {formatRupees(variant.mrp)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-32 shrink-0">
                  <AddToCart
                    variantId={variant.id}
                    disabled={!variant.isAvailable}
                    label={`${product.name} ${variant.label}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
