'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { setProductActive, setVariantAvailable } from './actions';

export interface CatalogVariant {
  id: string;
  label: string;
  /** Decimal serialised as a string — see the note in page.tsx. */
  price: string;
  mrp: string | null;
  isAvailable: boolean;
}

export interface CatalogProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  isActive: boolean;
  categoryId: string;
  categoryName: string;
  categoryIsActive: boolean;
  variants: CatalogVariant[];
}

interface Category {
  id: string;
  name: string;
}

const rupees = (value: string) => `₹${value.replace(/\.00$/, '')}`;

function ProductCard({ product, onError }: { product: CatalogProduct; onError: (m: string) => void }) {
  // A product in a switched-off category is already hidden from customers,
  // whatever its own flag says. Saying so here stops the owner toggling this
  // product on and wondering why nothing changed on the storefront.
  const hiddenByCategory = product.isActive && !product.categoryIsActive;

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-opacity',
        !product.isActive && 'bg-muted/40 opacity-60'
      )}
    >
      <div className="flex items-start gap-4">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt=""
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
            No photo
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{product.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{product.categoryName}</span>
          </div>

          {hiddenByCategory && (
            <p className="mt-0.5 text-xs text-gold">
              Hidden — the {product.categoryName} category is switched off
            </p>
          )}

          <ul className="mt-2 space-y-1">
            {product.variants.map((variant) => (
              <li key={variant.id} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0">{variant.label}</span>
                <span className="w-24 shrink-0 tabular-nums">
                  {rupees(variant.price)}
                  {variant.mrp && (
                    <span className="ml-1 text-xs text-muted-foreground line-through">
                      {rupees(variant.mrp)}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'w-24 shrink-0 text-xs',
                    variant.isAvailable ? 'text-muted-foreground' : 'text-destructive'
                  )}
                >
                  {variant.isAvailable ? 'Available' : 'Sold out'}
                </span>
                <ToggleSwitch
                  checked={variant.isAvailable}
                  label={`${product.name} ${variant.label} available`}
                  onToggle={(next) => setVariantAvailable(variant.id, next)}
                  onError={onError}
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {product.isActive ? 'Active' : 'Hidden'}
            </span>
            <ToggleSwitch
              checked={product.isActive}
              label={`${product.name} active`}
              onToggle={(next) => setProductActive(product.id, next)}
              onError={onError}
            />
          </div>
          <Link
            href={`/admin/products/${product.id}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Edit
          </Link>
        </div>
      </div>
    </div>
  );
}

export function CatalogList({
  products,
  categories,
}: {
  products: CatalogProduct[];
  categories: Category[];
}) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtering client-side is a deliberate fit to the catalog's size: well under
  // a few hundred products, all already loaded. It costs no round-trip, so
  // search is instant as the owner types.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      if (!showInactive && !product.isActive) return false;
      if (categoryId !== 'all' && product.categoryId !== categoryId) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.variants.some((v) => v.label.toLowerCase().includes(needle))
      );
    });
  }, [products, query, categoryId, showInactive]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search products"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="max-w-45"
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show hidden
        </label>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {products.length === 0 ? 'No products yet.' : 'Nothing matches those filters.'}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((product) => (
            <ProductCard key={product.id} product={product} onError={setError} />
          ))}
        </div>
      )}
    </div>
  );
}
