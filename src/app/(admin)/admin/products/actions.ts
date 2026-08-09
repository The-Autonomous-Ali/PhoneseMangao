'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { requireAdmin } from '@/lib/admin-auth';
import { productSchema, variantSchema } from '@/lib/validation/catalog';
import { slugify, slugCandidate } from '@/lib/slug';
import { uploadImage } from '@/lib/services/images';
import { toActionError, formText, type ActionResult } from '@/lib/actions';

const MAX_SLUG_ATTEMPTS = 5;

function isSlugConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    ((error.meta?.target as string[] | undefined) ?? []).some((t) => t.includes('slug'))
  );
}

function imageFrom(formData: FormData): File | null {
  const file = formData.get('image');
  return file instanceof File && file.size > 0 ? file : null;
}

function readProduct(formData: FormData) {
  return productSchema.parse({
    name: formText(formData, 'name'),
    categoryId: formText(formData, 'categoryId'),
    description: formText(formData, 'description'),
    sortOrder: formText(formData, 'sortOrder') || 0,
  });
}

function readVariant(formData: FormData) {
  return variantSchema.parse({
    label: formText(formData, 'label'),
    unitType: formText(formData, 'unitType'),
    unitValue: formText(formData, 'unitValue'),
    price: formText(formData, 'price'),
    mrp: formText(formData, 'mrp'),
    stockQty: formText(formData, 'stockQty'),
    sku: formText(formData, 'sku'),
  });
}

/** Strings, not numbers — Prisma parses them into Decimal without rounding. */
function variantData(input: ReturnType<typeof readVariant>) {
  return {
    label: input.label,
    unitType: input.unitType,
    unitValue: input.unitValue,
    price: input.price,
    mrp: input.mrp ?? null,
    stockQty: input.stockQty ? Number(input.stockQty) : null,
    sku: input.sku ?? null,
  };
}

/**
 * Creates a product together with its first variant.
 *
 * The two are written in one transaction because a product with no variants is
 * unsellable: it would sit in the catalog looking finished, appear on the
 * storefront with no price and no way to add it to a basket, and nothing would
 * flag it. Requiring the first variant here makes that state unrepresentable.
 */
export async function createProduct(
  _prev: unknown,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireAdmin();

    const product = readProduct(formData);
    const variant = readVariant(formData);

    // Deliberately outside the transaction. Holding one open across a network
    // round-trip to Cloudinary keeps a row lock for the duration and risks the
    // transaction timeout. The cost is an orphaned image if the write then
    // fails — a few KB — against the alternative of a product whose image link
    // is broken, which the shop owner actually has to see and fix.
    const image = imageFrom(formData);
    const imageUrl = image ? await uploadImage(image, 'products') : undefined;

    const base = slugify(product.name);

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        const created = await withDbRetry(() =>
          db.$transaction(async (tx) => {
            const row = await tx.product.create({
              data: {
                name: product.name,
                slug: slugCandidate(base, attempt),
                categoryId: product.categoryId,
                description: product.description,
                sortOrder: product.sortOrder,
                imageUrl,
              },
            });
            await tx.variant.create({ data: { ...variantData(variant), productId: row.id } });
            return row;
          })
        );

        revalidatePath('/admin/products');
        return { ok: true, data: { id: created.id } };
      } catch (error) {
        if (!isSlugConflict(error) || attempt === MAX_SLUG_ATTEMPTS) throw error;
      }
    }

    return { ok: false, error: 'Could not find a free URL for that name' };
  } catch (error) {
    return toActionError(error, 'createProduct');
  }
}

export async function updateProduct(
  id: string,
  _prev: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const product = readProduct(formData);
    const image = imageFrom(formData);
    const imageUrl = image ? await uploadImage(image, 'products') : undefined;

    // Slug is not regenerated on rename — it is already in shared links.
    await withDbRetry(() =>
      db.product.update({
        where: { id },
        data: {
          name: product.name,
          categoryId: product.categoryId,
          description: product.description ?? null,
          sortOrder: product.sortOrder,
          ...(imageUrl ? { imageUrl } : {}),
        },
      })
    );

    revalidatePath('/admin/products');
    revalidatePath(`/admin/products/${id}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'updateProduct');
  }
}

/** Stands in for deletion. Nothing is ever destroyed, so a mis-tap costs a click. */
export async function setProductActive(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    await withDbRetry(() => db.product.update({ where: { id }, data: { isActive } }));

    revalidatePath('/admin/products');
    revalidatePath(`/admin/products/${id}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setProductActive');
  }
}

export async function addVariant(
  productId: string,
  _prev: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const variant = readVariant(formData);
    await withDbRetry(() => db.variant.create({ data: { ...variantData(variant), productId } }));

    revalidatePath('/admin/products');
    revalidatePath(`/admin/products/${productId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'addVariant');
  }
}

export async function updateVariant(
  id: string,
  _prev: unknown,
  formData: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const variant = readVariant(formData);
    await withDbRetry(() => db.variant.update({ where: { id }, data: variantData(variant) }));

    revalidatePath('/admin/products');
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'updateVariant');
  }
}

/**
 * The control the shop owner uses most: produce sells out mid-morning and has
 * to come off the storefront in one tap, from the list, without opening a form.
 */
export async function setVariantAvailable(
  id: string,
  isAvailable: boolean
): Promise<ActionResult> {
  try {
    await requireAdmin();

    await withDbRetry(() => db.variant.update({ where: { id }, data: { isAvailable } }));

    revalidatePath('/admin/products');
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setVariantAvailable');
  }
}
