import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { buttonVariants } from '@/components/ui/button';
import { EditProductForm } from './edit-product-form';
import { VariantsEditor, type EditableVariant } from './variants-editor';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [product, categories] = await withDbRetry(() =>
    Promise.all([
      db.product.findUnique({
        where: { id },
        include: { variants: { orderBy: { unitValue: 'asc' } } },
      }),
      db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ])
  );

  if (!product) notFound();

  // Decimal does not survive the server/client boundary — see page.tsx.
  const variants: EditableVariant[] = product.variants.map((variant) => ({
    id: variant.id,
    label: variant.label,
    unitType: variant.unitType,
    unitValue: variant.unitValue.toString(),
    price: variant.price.toString(),
    mrp: variant.mrp?.toString() ?? null,
    stockQty: variant.stockQty,
    sku: variant.sku,
    isAvailable: variant.isAvailable,
  }));

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {product.imageUrl && (
            <Image
              src={product.imageUrl}
              alt=""
              width={48}
              height={48}
              className="size-12 rounded-md object-cover"
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold">{product.name}</h1>
            <p className="text-sm text-muted-foreground">/{product.slug}</p>
          </div>
        </div>
        <Link href="/admin/products" className={buttonVariants({ variant: 'ghost' })}>
          Back to catalog
        </Link>
      </div>

      <EditProductForm
        productId={product.id}
        categories={categories}
        defaults={{
          name: product.name,
          categoryId: product.categoryId,
          description: product.description,
          sortOrder: product.sortOrder,
          imageUrl: product.imageUrl,
        }}
      />

      <VariantsEditor productId={product.id} variants={variants} />
    </div>
  );
}
