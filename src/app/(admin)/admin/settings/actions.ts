'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { getEnv } from '@/lib/env';
import { writeSettings } from '@/lib/settings';
import { formText, toActionError, type ActionResult } from '@/lib/actions';
import { shopSettingsSchema } from '@/lib/validation/config';

function refresh() {
  revalidatePath('/admin/settings');
  // The storefront reads these on every page: a changed delivery fee or a
  // closed shop has to be visible immediately, not after the next deploy.
  revalidatePath('/', 'layout');
}

/** Saves the money and text settings as one form. */
export async function updateSettings(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();

    const input = shopSettingsSchema.parse({
      deliveryFee: formText(formData, 'deliveryFee'),
      minOrderValue: formText(formData, 'minOrderValue'),
      freeDeliveryAbove: formText(formData, 'freeDeliveryAbove'),
      whatsappNumber: formText(formData, 'whatsappNumber'),
      slotCapacity: formText(formData, 'slotCapacity'),
      shopLat: formText(formData, 'shopLat'),
      shopLng: formText(formData, 'shopLng'),
      deliveryRadiusKm: formText(formData, 'deliveryRadiusKm'),
    });

    await writeSettings({
      delivery_fee: input.deliveryFee,
      min_order_value: input.minOrderValue,
      free_delivery_above: input.freeDeliveryAbove,
      whatsapp_number: input.whatsappNumber,
      slot_capacity: input.slotCapacity,
      shop_lat: input.shopLat,
      shop_lng: input.shopLng,
      delivery_radius_km: input.deliveryRadiusKm,
    });

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'updateSettings');
  }
}

/**
 * The emergency control. Writes immediately rather than behind a Save button —
 * the reason to touch this is that something has gone wrong right now.
 */
export async function setShopOpen(isOpen: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    await writeSettings({ shop_open: isOpen });

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setShopOpen');
  }
}

/**
 * Offers or withdraws online payment.
 *
 * Switching on is refused when Razorpay is not configured. `SETTING_DEFAULTS`
 * keeps this flag off so a shop whose KYC has not cleared does not advertise a
 * payment method that throws at the last step of checkout, and a settings
 * screen that let it be flipped anyway would hand that failure straight back to
 * a customer. The check is here rather than only on the input, because a
 * disabled input is not a control — `admin-auth.ts` sets out the same reasoning
 * for why authorization cannot live in middleware.
 *
 * Switching off is always allowed. Turning something off is never the unsafe
 * direction, and refusing it could strand a shop advertising a broken method.
 */
export async function setPaymentsEnabled(enabled: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    if (enabled && !getEnv().RAZORPAY_KEY_ID) {
      return {
        ok: false,
        error:
          'Razorpay keys are not set on this server, so online payment would fail at checkout. ' +
          'Set them, restart, then switch this on.',
      };
    }

    await writeSettings({ payments_enabled: enabled });

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setPaymentsEnabled');
  }
}
