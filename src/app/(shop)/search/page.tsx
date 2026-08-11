import Link from 'next/link';
import type { Metadata } from 'next';
import { getStorefrontProducts } from '@/lib/shop-queries';
import { ProductCard } from '@/components/shop/product-card';
import { SHOP_NAME } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Search — ${SHOP_NAME}`,
};

const MAX_RESULTS = 40;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = (await searchParams).q?.trim() ?? '';
  const products = query ? await getStorefrontProducts({ query, take: MAX_RESULTS }) : [];

  return (
    <div className="animate-om-fade space-y-8">
      <header>
        <h1 className="text-3xl">
          {query ? (
            <>
              Results for <span className="text-gold">{query}</span>
            </>
          ) : (
            'Search'
          )}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {query
            ? `${products.length} ${products.length === 1 ? 'item' : 'items'}`
            : 'Type something in the search box above.'}
        </p>
      </header>

      {query && products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-lg">Nothing matched “{query}”.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Try a shorter word — “tomato” rather than “tomatoes 1kg”.
          </p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-full bg-gold px-6 py-3 text-sm font-semibold text-[#132019] transition-colors hover:bg-gold-hover"
          >
            Back to the shop
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
