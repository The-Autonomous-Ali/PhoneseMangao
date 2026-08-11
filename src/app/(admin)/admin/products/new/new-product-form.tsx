'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createProduct } from '../actions';
import { ProductFields } from '../product-fields';
import { VariantFields } from '../variant-fields';

const INITIAL = { ok: false as const, error: '' };

export function NewProductForm({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createProduct, INITIAL);

  // Navigating here rather than calling redirect() inside the action: the
  // action wraps its body in try/catch, and redirect() signals by throwing —
  // it would be swallowed and reported as an unexpected failure.
  useEffect(() => {
    if (state.ok && state.data?.id) router.push(`/admin/products/${state.data.id}`);
  }, [state, router]);

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New product</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A product needs at least one pack size to be sellable, so you add the first one here. You
          can add more straight after.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductFields categories={categories} errors={state.ok ? undefined : state.fieldErrors} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>First pack size</CardTitle>
        </CardHeader>
        <CardContent>
          <VariantFields errors={state.ok ? undefined : state.fieldErrors} />
        </CardContent>
      </Card>

      {!state.ok && state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Saving...' : 'Create product'}
        </Button>
        <Link href="/admin/products" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
