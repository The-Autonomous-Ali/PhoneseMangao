import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';
import { NewProductForm } from './new-product-form';

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const categories = await withReadRetry(() =>
    db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
  );

  // Every product needs a category, so there is nothing to fill in yet.
  if (categories.length === 0) redirect('/admin/categories');

  return <NewProductForm categories={categories} />;
}
