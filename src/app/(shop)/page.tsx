import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getActiveCategories, getStorefrontProducts } from '@/lib/shop-queries';
import { ProductCard } from '@/components/shop/product-card';
import { SHOP_NAME, SHOP_TAGLINE } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${SHOP_NAME} — fresh groceries delivered`,
  description: SHOP_TAGLINE,
};

const FEATURED_COUNT = 8;

export default async function HomePage() {
  const [categories, products] = await Promise.all([
    getActiveCategories(),
    getStorefrontProducts({ take: FEATURED_COUNT }),
  ]);

  if (categories.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <h1 className="text-xl font-semibold">We are setting up</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The shop is not stocked yet. Please check back shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold">Shop by category</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              className="group overflow-hidden rounded-xl border transition-colors hover:border-foreground/30"
            >
              {category.imageUrl ? (
                <Image
                  src={category.imageUrl}
                  alt={category.name}
                  width={240}
                  height={160}
                  className="aspect-[3/2] w-full object-cover"
                />
              ) : (
                <div className="aspect-[3/2] w-full bg-muted" />
              )}
              <div className="px-3 py-2">
                <div className="font-medium group-hover:underline">{category.name}</div>
                <div className="text-xs text-muted-foreground">
                  {category.productCount} item{category.productCount === 1 ? '' : 's'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {products.length > 0 && (
        <section>
          <h2 className="text-2xl font-semibold">Fresh today</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
