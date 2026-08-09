'use client';

import { useActionState, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { cn } from '@/lib/utils';
import { createCategory, updateCategory, setCategoryActive } from './actions';

const INITIAL = { ok: false as const, error: '' };

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

function CategoryItem({ category, onError }: { category: CategoryRow; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateCategory.bind(null, category.id),
    INITIAL
  );

  return (
    <li className={cn('rounded-lg border p-3', !category.isActive && 'bg-muted/40 opacity-60')}>
      <div className="flex items-center gap-3">
        {category.imageUrl ? (
          <Image
            src={category.imageUrl}
            alt=""
            width={40}
            height={40}
            className="size-10 rounded-md object-cover"
          />
        ) : (
          <div className="size-10 rounded-md border border-dashed" />
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{category.name}</div>
          <div className="text-xs text-muted-foreground">
            {category.productCount} product{category.productCount === 1 ? '' : 's'} · /
            {category.slug}
          </div>
        </div>

        <span className="text-xs text-muted-foreground">
          {category.isActive ? 'Shown' : 'Hidden'}
        </span>
        <ToggleSwitch
          checked={category.isActive}
          label={`${category.name} shown`}
          onToggle={(next) => setCategoryActive(category.id, next)}
          onError={onError}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Edit'}
        </Button>
      </div>

      {!category.isActive && category.productCount > 0 && (
        // Worth saying plainly: the products are untouched, so switching the
        // category back on restores the whole section exactly as it was.
        <p className="mt-2 text-xs text-amber-600">
          Its {category.productCount} product{category.productCount === 1 ? ' is' : 's are'} hidden
          from customers too. Switching this back on restores them.
        </p>
      )}

      {open && (
        <form action={formAction} className="mt-4 space-y-3 border-t pt-4">
          <div className="space-y-2">
            <Label htmlFor={`name-${category.id}`}>Name</Label>
            <Input id={`name-${category.id}`} name="name" defaultValue={category.name} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`sort-${category.id}`}>Sort order</Label>
              <Input
                id={`sort-${category.id}`}
                name="sortOrder"
                type="number"
                min={0}
                defaultValue={category.sortOrder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`image-${category.id}`}>Photo</Label>
              <Input
                id={`image-${category.id}`}
                name="image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
              />
            </div>
          </div>
          {!state.ok && state.error && (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          )}
          {state.ok && <p className="text-sm text-green-700">Saved.</p>}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving...' : 'Save'}
          </Button>
        </form>
      )}
    </li>
  );
}

export function CategoriesManager({ categories }: { categories: CategoryRow[] }) {
  const [state, formAction, pending] = useActionState(createCategory, INITIAL);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a category</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="new-category">Name</Label>
              <Input id="new-category" name="name" placeholder="Vegetables" required />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding...' : 'Add'}
            </Button>
          </form>
          {!state.ok && state.error && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {state.error}
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {categories.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No categories yet. Add one above to start building the catalog.
        </p>
      ) : (
        <ul className="space-y-2">
          {categories.map((category) => (
            <CategoryItem key={category.id} category={category} onError={setError} />
          ))}
        </ul>
      )}
    </div>
  );
}
