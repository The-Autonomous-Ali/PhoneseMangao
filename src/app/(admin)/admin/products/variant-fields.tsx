'use client';

import { UnitType } from '@prisma/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { UNIT_TYPE_LABELS } from './constants';
import { FieldError, type FieldErrors } from './product-fields';

export interface VariantDefaults {
  label?: string;
  unitType?: UnitType;
  unitValue?: string;
  price?: string;
  mrp?: string | null;
  stockQty?: number | null;
  sku?: string | null;
}

/**
 * One pack size: what it is called, how much of it there is, and what it costs.
 *
 * Prices are text inputs rather than `type="number"`, so the value reaches the
 * server as the exact string the owner typed. A number input hands back a
 * float, which is the rounding the Decimal columns exist to avoid.
 */
export function VariantFields({
  defaults,
  errors,
}: {
  defaults?: VariantDefaults;
  errors?: FieldErrors;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="label">Pack label</Label>
        <Input
          id="label"
          name="label"
          placeholder="1 kg"
          defaultValue={defaults?.label}
          required
          maxLength={40}
        />
        <FieldError errors={errors} name="label" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sku">SKU (optional)</Label>
        <Input id="sku" name="sku" defaultValue={defaults?.sku ?? ''} maxLength={40} />
        <FieldError errors={errors} name="sku" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="unitType">Unit</Label>
        <Select
          id="unitType"
          name="unitType"
          defaultValue={defaults?.unitType ?? UnitType.KG}
          required
        >
          {Object.entries(UNIT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <FieldError errors={errors} name="unitType" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="unitValue">Quantity</Label>
        <Input
          id="unitValue"
          name="unitValue"
          inputMode="decimal"
          placeholder="1"
          defaultValue={defaults?.unitValue}
          required
        />
        <FieldError errors={errors} name="unitValue" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="price">Selling price (₹)</Label>
        <Input
          id="price"
          name="price"
          inputMode="decimal"
          placeholder="45"
          defaultValue={defaults?.price}
          required
        />
        <FieldError errors={errors} name="price" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mrp">MRP (optional)</Label>
        <Input
          id="mrp"
          name="mrp"
          inputMode="decimal"
          placeholder="55"
          defaultValue={defaults?.mrp ?? ''}
        />
        <FieldError errors={errors} name="mrp" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="stockQty">Stock count (optional)</Label>
        <Input
          id="stockQty"
          name="stockQty"
          inputMode="numeric"
          defaultValue={defaults?.stockQty ?? ''}
          className="max-w-32"
        />
        <p className="text-xs text-muted-foreground">Leave blank if you do not track stock.</p>
        <FieldError errors={errors} name="stockQty" />
      </div>
    </div>
  );
}
