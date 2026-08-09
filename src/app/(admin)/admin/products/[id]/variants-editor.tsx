'use client';

import { useActionState, useState } from 'react';
import type { UnitType } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { addVariant, updateVariant, setVariantAvailable } from '../actions';
import { VariantFields } from '../variant-fields';

const INITIAL = { ok: false as const, error: '' };

export interface EditableVariant {
  id: string;
  label: string;
  unitType: UnitType;
  unitValue: string;
  price: string;
  mrp: string | null;
  stockQty: number | null;
  sku: string | null;
  isAvailable: boolean;
}

function VariantRow({ variant, onError }: { variant: EditableVariant; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateVariant.bind(null, variant.id),
    INITIAL
  );

  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 font-medium">{variant.label}</span>
        <span className="w-28 shrink-0 tabular-nums text-sm">₹{variant.price}</span>
        <span className="flex-1 text-sm text-muted-foreground">
          {variant.isAvailable ? 'Available' : 'Sold out'}
        </span>
        <ToggleSwitch
          checked={variant.isAvailable}
          label={`${variant.label} available`}
          onToggle={(next) => setVariantAvailable(variant.id, next)}
          onError={onError}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Edit'}
        </Button>
      </div>

      {open && (
        <form action={formAction} className="mt-4 space-y-4 border-t pt-4">
          <VariantFields defaults={variant} errors={state.ok ? undefined : state.fieldErrors} />
          {!state.ok && state.error && (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          )}
          {state.ok && <p className="text-sm text-green-700">Saved.</p>}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving...' : 'Save pack size'}
          </Button>
        </form>
      )}
    </li>
  );
}

function AddVariantForm({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addVariant.bind(null, productId), INITIAL);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        + Add pack size
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-dashed p-4">
      <VariantFields errors={state.ok ? undefined : state.fieldErrors} />
      {!state.ok && state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding...' : 'Add pack size'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function VariantsEditor({
  productId,
  variants,
}: {
  productId: string;
  variants: EditableVariant[];
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pack sizes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <ul className="space-y-2">
          {variants.map((variant) => (
            <VariantRow key={variant.id} variant={variant} onError={setError} />
          ))}
        </ul>

        {/* Pack sizes are switched off rather than deleted, the same rule that
            applies to products — a sold-out size returns next week, and its
            SKU stays attached to the orders that already used it. */}
        <p className="text-xs text-muted-foreground">
          To stop selling a size, switch it off. Nothing is deleted, so past orders keep their
          details.
        </p>

        <AddVariantForm productId={productId} />
      </CardContent>
    </Card>
  );
}
