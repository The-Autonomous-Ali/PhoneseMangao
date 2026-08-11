import Link from 'next/link';
import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';
import { buttonVariants } from '@/components/ui/button';
import { CatalogList, type CatalogProduct } from './catalog-list';

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const [products, categories] = await withReadRetry(() =>
    Promise.all([
      db.product.findMany({
        include: { variants: { orderBy: { unitValue: 'asc' } }, category: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ])
  );

  // Prisma returns Decimal objects, which React cannot serialise across the
  // server/client boundary. Converting to string here also keeps the exact
  // value — going via Number would reintroduce the rounding the Decimal
  // column exists to avoid.
  const serialisable: CatalogProduct[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    imageUrl: product.imageUrl,
    isActive: product.isActive,
    categoryId: product.categoryId,
    categoryName: product.category.name,
    categoryIsActive: product.category.isActive,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      price: variant.price.toString(),
      mrp: variant.mrp?.toString() ?? null,
      isAvailable: variant.isAvailable,
    })),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Catalog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {products.length} product{products.length === 1 ? '' : 's'} in {categories.length}{' '}
            categor{categories.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
        <Link href="/admin/products/new" className={buttonVariants({ size: 'lg' })}>
          + New product
        </Link>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Add a category first — every product needs one.
          </p>
          <Link
            href="/admin/categories"
            className={buttonVariants({ variant: 'outline', className: 'mt-3' })}
          >
            Go to categories
          </Link>
        </div>
      ) : (
        <CatalogList products={serialisable} categories={categories} />
      )}
    </div>
  );
}
