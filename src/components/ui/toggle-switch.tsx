'use client';

import { useOptimistic, useTransition } from 'react';
import { cn } from '@/lib/utils';

interface ToggleSwitchProps {
  checked: boolean;
  onToggle: (next: boolean) => Promise<{ ok: boolean; error?: string }>;
  label: string;
  onError?: (message: string) => void;
}

/**
 * A switch that flips immediately and rolls back if the server disagrees.
 *
 * The shop owner marks produce sold out mid-service, often on a phone on a
 * patchy connection. Waiting for a round-trip before the switch moves reads as
 * a dead control and invites a second tap, so the optimistic state moves first
 * and reverts only on failure.
 */
export function ToggleSwitch({ checked, onToggle, label, onError }: ToggleSwitchProps) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(checked);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      aria-label={label}
      disabled={pending}
      onClick={() => {
        const next = !optimistic;
        startTransition(async () => {
          setOptimistic(next);
          const result = await onToggle(next);
          // No manual revert needed: useOptimistic drops back to the prop once
          // the transition ends, and revalidatePath supplies the true value.
          if (!result.ok && result.error) onError?.(result.error);
        });
      }}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60',
        optimistic ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-white shadow transition-transform',
          optimistic ? 'translate-x-4.5' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}
