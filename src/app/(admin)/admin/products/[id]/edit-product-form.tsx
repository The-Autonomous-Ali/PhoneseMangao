'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { updateProduct } from '../actions';
import { ProductFields } from '../product-fields';

const INITIAL = { ok: false as const, error: '' };

interface Props {
  productId: string;
  categories: { id: string; name: string }[];
  defaults: {
    name: string;
    categoryId: string;
    description: string | null;
    sortOrder: number;
    imageUrl: string | null;
  };
}

export function EditProductForm({ productId, categories, defaults }: Props) {
  const [state, formAction, pending] = useActionState(
    updateProduct.bind(null, productId),
    INITIAL
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product details</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <ProductFields
            categories={categories}
            defaults={defaults}
            errors={state.ok ? undefined : state.fieldErrors}
          />

          {!state.ok && state.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}
          {state.ok && <p className="text-sm text-emerald-300">Saved.</p>}

          <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : 'Save changes'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
