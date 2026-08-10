'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import type { ShopSettings } from '@/lib/settings';
import { updateSettings, setShopOpen, setPaymentsEnabled } from './actions';

const INITIAL = { ok: false as const, error: '' };

/** One labelled money or text input. */
function Field({
  name,
  label,
  hint,
  defaultValue,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} className="w-40" />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function SettingsForm({
  settings,
  razorpayConfigured,
}: {
  settings: ShopSettings;
  razorpayConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateSettings, INITIAL);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      <form action={formAction} className="space-y-4">
        <div className="flex flex-wrap gap-6">
          <Field
            name="deliveryFee"
            label="Delivery fee"
            hint="0 means delivery is never charged."
            defaultValue={settings.deliveryFee}
          />
          <Field
            name="minOrderValue"
            label="Minimum order"
            hint="Below this, checkout is blocked."
            defaultValue={settings.minOrderValue}
          />
          <Field
            name="freeDeliveryAbove"
            label="Free delivery above"
            hint="At or above this, the fee is waived."
            defaultValue={settings.freeDeliveryAbove}
          />
          <Field
            name="slotCapacity"
            label="Default slot capacity"
            hint="Applied to newly generated slots."
            defaultValue={String(settings.slotCapacity)}
          />
          <Field
            name="whatsappNumber"
            label="WhatsApp number"
            hint="Shown to customers. May be left empty."
            defaultValue={settings.whatsappNumber}
          />
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="text-sm font-medium">Delivery area</div>
          <p className="text-xs text-muted-foreground">
            Until the shop location is filled in, delivery is decided only by the pincode list.
            Once it is set, any address within the radius is served, and a listed pincode is
            served whatever its distance.
          </p>

          <div className="flex flex-wrap gap-6 pt-2">
            <Field
              name="shopLat"
              label="Shop latitude"
              hint="e.g. 12.9784. Leave empty if unknown."
              defaultValue={settings.shopLat === null ? '' : String(settings.shopLat)}
            />
            <Field
              name="shopLng"
              label="Shop longitude"
              hint="e.g. 77.6408. Leave empty if unknown."
              defaultValue={settings.shopLng === null ? '' : String(settings.shopLng)}
            />
            <Field
              name="deliveryRadiusKm"
              label="Delivery radius (km)"
              hint="How far the shop will drive."
              defaultValue={String(settings.deliveryRadiusKm)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            To find the coordinates: open Google Maps, right-click the shop, and click the pair of
            numbers at the top of the menu to copy them. Latitude is the first.
          </p>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>

        {!state.ok && state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.ok && <p className="text-sm text-muted-foreground">Saved.</p>}
      </form>

      <div className="space-y-4 border-t pt-6">
        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked={settings.shopOpen}
            label="Shop open"
            onToggle={setShopOpen}
            onError={setError}
          />
          <div>
            <div className="text-sm font-medium">Shop open</div>
            <p className="text-xs text-muted-foreground">
              Switching this off stops all new orders immediately. Takes effect on click.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked={settings.paymentsEnabled}
            label="Online payments"
            onToggle={setPaymentsEnabled}
            onError={setError}
          />
          <div>
            <div className="text-sm font-medium">Online payments</div>
            <p className="text-xs text-muted-foreground">
              {razorpayConfigured
                ? 'Cash on delivery is always available regardless.'
                : 'Razorpay keys are not set on this server, so this cannot be switched on yet. Cash on delivery is unaffected.'}
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
