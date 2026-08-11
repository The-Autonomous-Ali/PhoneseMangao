'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MAX_IMAGE_BYTES } from './constants';

export interface FieldErrors {
  [field: string]: string;
}

export function FieldError({ errors, name }: { errors?: FieldErrors; name: string }) {
  if (!errors?.[name]) return null;
  return <p className="text-sm text-destructive">{errors[name]}</p>;
}

interface ProductDefaults {
  name?: string;
  categoryId?: string;
  description?: string | null;
  sortOrder?: number;
  imageUrl?: string | null;
}

/** Shared by the create and edit forms so the two cannot drift apart. */
export function ProductFields({
  categories,
  defaults,
  errors,
}: {
  categories: { id: string; name: string }[];
  defaults?: ProductDefaults;
  errors?: FieldErrors;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Product name</Label>
        <Input id="name" name="name" defaultValue={defaults?.name} required maxLength={120} />
        <FieldError errors={errors} name="name" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="categoryId">Category</Label>
        <Select id="categoryId" name="categoryId" defaultValue={defaults?.categoryId} required>
          <option value="">Choose a category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <FieldError errors={errors} name="categoryId" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={defaults?.description ?? ''}
          maxLength={2000}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="image">Photo {defaults?.imageUrl ? '(replaces the current one)' : ''}</Label>
        <Input
          id="image"
          name="image"
          type="file"
          // A convenience for the file picker only — the real check is on the
          // server, since a Server Action can be called without this form.
          accept="image/jpeg,image/png,image/webp"
        />
        <p className="text-xs text-muted-foreground">
          JPEG, PNG or WebP, up to {MAX_IMAGE_BYTES / (1024 * 1024)} MB.
        </p>
        <FieldError errors={errors} name="image" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sortOrder">Sort order</Label>
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={defaults?.sortOrder ?? 0}
          className="max-w-24"
        />
        <p className="text-xs text-muted-foreground">Lower numbers appear first.</p>
      </div>
    </div>
  );
}
