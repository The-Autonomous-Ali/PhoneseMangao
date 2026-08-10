'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { cn } from '@/lib/utils';
import { addPincode, setPincodeActive } from './actions';

const INITIAL = { ok: false as const, error: '' };

export interface PincodeRow {
  id: string;
  pincode: string;
  area: string | null;
  isActive: boolean;
}

export function PincodeManager({ pincodes }: { pincodes: PincodeRow[] }) {
  const [state, formAction, pending] = useActionState(addPincode, INITIAL);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="pincode">PIN code</Label>
          <Input id="pincode" name="pincode" inputMode="numeric" className="w-32" required />
        </div>

        <div className="space-y-1">
          <Label htmlFor="area">Area (optional)</Label>
          <Input id="area" name="area" className="w-56" />
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add pincode'}
        </Button>
      </form>

      {!state.ok && state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {pincodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No pincodes yet. Until one is added, nobody can check out.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {pincodes.map((row) => (
            <li
              key={row.id}
              className={cn('flex items-center gap-3 p-3', !row.isActive && 'opacity-60')}
            >
              <span className="font-medium">{row.pincode}</span>
              <span className="text-sm text-muted-foreground">{row.area ?? '—'}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {row.isActive ? 'Delivering' : 'Not delivering'}
              </span>
              <ToggleSwitch
                checked={row.isActive}
                label={`Deliver to ${row.pincode}`}
                onToggle={(next) => setPincodeActive(row.id, next)}
                onError={setError}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
