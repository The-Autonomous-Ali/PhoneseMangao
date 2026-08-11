import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';
import { CategoriesManager, type CategoryRow } from './categories-manager';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const categories = await withReadRetry(() =>
    db.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
  );

  const rows: CategoryRow[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    imageUrl: category.imageUrl,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    productCount: category._count.products,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Categories</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every product belongs to one. Switching a category off hides its products from customers
          without changing them.
        </p>
      </div>
      <CategoriesManager categories={rows} />
    </div>
  );
}
