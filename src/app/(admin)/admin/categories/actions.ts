'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { requireAdmin } from '@/lib/admin-auth';
import { categorySchema } from '@/lib/validation/catalog';
import { slugify, slugCandidate } from '@/lib/slug';
import { uploadImage } from '@/lib/services/images';
import { toActionError, formText, type ActionResult } from '@/lib/actions';
import { Prisma } from '@prisma/client';

/** Bounded so a genuine repeated failure surfaces instead of looping. */
const MAX_SLUG_ATTEMPTS = 5;

function isSlugConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    ((error.meta?.target as string[] | undefined) ?? []).some((t) => t.includes('slug'))
  );
}

/** Optional image field: an untouched file input posts a zero-byte File. */
function imageFrom(formData: FormData): File | null {
  const file = formData.get('image');
  return file instanceof File && file.size > 0 ? file : null;
}

export async function createCategory(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();

    const input = categorySchema.parse({
      name: formText(formData, 'name'),
      sortOrder: formText(formData, 'sortOrder') || 0,
    });

    const image = imageFrom(formData);
    // Outside any transaction on purpose — see the note in products/actions.ts.
    const imageUrl = image ? await uploadImage(image, 'categories') : undefined;

    const base = slugify(input.name);
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        await withDbRetry(() =>
          db.category.create({
            data: {
              name: input.name,
              slug: slugCandidate(base, attempt),
              sortOrder: input.sortOrder,
              imageUrl,
            },
          })
        );
        revalidatePath('/admin/categories');
        revalidatePath('/admin/products');
        return { ok: true };
      } catch (error) {
        // Retry only a slug collision. Anything else is the caller's problem.
        if (!isSlugConflict(error) || attempt === MAX_SLUG_ATTEMPTS) throw error;
      }
    }

    return { ok: false, error: 'Could not find a free URL for that name' };
  } catch (error) {
    return toActionError(error, 'createCategory');
  }
}

export async function updateCategory(
  id: string,
  _prev: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const input = categorySchema.parse({
      name: formText(formData, 'name'),
      sortOrder: formText(formData, 'sortOrder') || 0,
    });

    const image = imageFrom(formData);
    const imageUrl = image ? await uploadImage(image, 'categories') : undefined;

    // The slug is deliberately not regenerated on rename. It is already in
    // shared links and search results, and renaming "Veg" to "Vegetables"
    // should not break every URL a customer has saved.
    await withDbRetry(() =>
      db.category.update({
        where: { id },
        data: { name: input.name, sortOrder: input.sortOrder, ...(imageUrl ? { imageUrl } : {}) },
      })
    );

    revalidatePath('/admin/categories');
    revalidatePath('/admin/products');
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'updateCategory');
  }
}

/**
 * Hides or restores a whole category.
 *
 * Deactivating leaves every product row untouched — the storefront filters on
 * the category's own flag — so switching it back on restores the section
 * exactly as it was, with no bulk update to get half-done.
 */
export async function setCategoryActive(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    await withDbRetry(() => db.category.update({ where: { id }, data: { isActive } }));

    revalidatePath('/admin/categories');
    revalidatePath('/admin/products');
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setCategoryActive');
  }
}
