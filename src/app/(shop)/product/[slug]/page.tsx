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

      <div className="grid gap-9 md:grid-cols-2">
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-border">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
              priority
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-muted px-6 text-center font-heading text-2xl text-muted-foreground">
              {product.name}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
            {product.categoryName}
          </div>
          <h1 className="mt-1.5 text-[38px] leading-tight">{product.name}</h1>
          {product.description && (
            <p className="mt-3 text-[15px] leading-relaxed text-[#a9b7ac]">{product.description}</p>
          )}

          {/* Every size gets its own row and its own add control. A dropdown
              would hide the price differences that decide the purchase. */}
          <h2 className="mt-8 mb-3 text-[13px] tracking-[0.1em] text-muted-foreground uppercase">
            Choose a size
          </h2>
          <div className="space-y-2.5">
            {product.variants.map((variant) => (
              <div
                key={variant.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-3.5"
              >
                <div>
                  <div className="font-semibold">{variant.label}</div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-lg font-bold tabular-nums">
                      {formatRupees(variant.price)}
                    </span>
                    {variant.mrp && Number(variant.mrp) > Number(variant.price) && (
                      <span className="text-[13px] text-muted-foreground line-through tabular-nums">
                        {formatRupees(variant.mrp)}
                      </span>
                    )}
                    {!variant.isAvailable && (
                      <span className="text-[13px] text-muted-foreground">· sold out</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <AddToCart
                    variantId={variant.id}
                    disabled={!variant.isAvailable}
                    label={`${product.name} ${variant.label}`}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-5 border-t border-[#294c3b] pt-4 text-[13.5px] text-[#a9b7ac]">
            <span>✓ Same-day slots</span>
            <span>✓ Hand-picked</span>
            <span>✓ Return if not fresh</span>
          </div>
        </div>
      </div>
    </div>
  );
}
