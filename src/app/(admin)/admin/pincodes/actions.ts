'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { requireAdmin } from '@/lib/admin-auth';
import { formText, toActionError, type ActionResult } from '@/lib/actions';
import { pincodeSchema } from '@/lib/validation/config';

function refresh() {
  revalidatePath('/admin/pincodes');
}

/** Adds a pincode the shop will deliver to. */
export async function addPincode(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();

    const input = pincodeSchema.parse({
      pincode: formText(formData, 'pincode'),
      area: formText(formData, 'area'),
    });

    await withDbRetry(() =>
      db.servicePincode.create({ data: { pincode: input.pincode, area: input.area } })
    );

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'addPincode');
  }
}

/**
 * Switches a delivery area on or off.
 *
 * Deactivates rather than deletes. `isServiceable` already filters on
 * `isActive`, so the effect is identical for a customer, and the row surviving
 * means a saved address in that pincode is explained by a record rather than by
 * nothing at all. It also matches how categories and products are withdrawn.
 */
export async function setPincodeActive(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    await withDbRetry(() => db.servicePincode.update({ where: { id }, data: { isActive } }));

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setPincodeActive');
  }
}
