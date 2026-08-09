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
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{category.name}</span>
      </nav>

      <h1 className="text-2xl font-semibold">{category.name}</h1>

      {products.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing in this section today.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
