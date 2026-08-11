import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCategoryBySlug, getStorefrontProducts } from '@/lib/shop-queries';
import { ProductCard } from '@/components/shop/product-card';
import { SHOP_NAME } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: `Not found — ${SHOP_NAME}` };

  return {
    title: `${category.name} — ${SHOP_NAME}`,
    description: `Fresh ${category.name.toLowerCase()} delivered to your door from ${SHOP_NAME}.`,
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [category, products] = await Promise.all([
    getCategoryBySlug(slug),
    getStorefrontProducts({ categorySlug: slug }),
  ]);

  // A switched-off category is a 404 rather than an empty page: it is not
  // somewhere the customer should be, and a soft-empty page invites a reload.
  if (!category) notFound();

  return (
    <div className="animate-om-fade">
      <nav className="mb-2 text-[13px] text-muted-foreground">
        <Link href="/" className="hover:text-gold">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <span>{category.name}</span>
      </nav>

      <h1 className="text-4xl">{category.name}</h1>
      <div className="mt-1 text-sm text-[#a9b7ac]">
        {products.length} {products.length === 1 ? 'item' : 'items'} in this aisle
      </div>
      <div className="mt-3 mb-8 h-px w-14 bg-gold" />

      {products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="font-heading text-xl">Nothing in this section today.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Stock changes every morning — worth looking again tomorrow.
          </p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-full bg-gold px-6 py-3 text-sm font-semibold text-[#132019] transition-colors hover:bg-gold-hover"
          >
            Back to the shop
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
