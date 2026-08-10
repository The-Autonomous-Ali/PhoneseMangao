'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AdminOrderRow } from '@/lib/admin/order-queries';
import {
  finalTotalFor,
  isSettleable,
  orderedQuantity,
  settleLines,
  type SettleableLine,
} from '@/lib/admin/settlement';
import { formatRupees } from '@/lib/format';
import { settleAndDeliver } from './actions';

export function SettleForm({ order, onDone }: { order: AdminOrderRow; onDone: () => void }) {
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lines: SettleableLine[] = order.items;

  // The same functions the Server Action calls. Quoting from one code path and
  // charging from another is how a shop ends up honouring a number it never
  // set — and this figure gets read aloud to a customer while the driver waits.
  const preview = useMemo(() => {
    const settled = settleLines(lines, actuals);
    return finalTotalFor(settled.itemsTotal, order.deliveryFee);
  }, [lines, actuals, order.deliveryFee]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await settleAndDeliver(order.id, actuals);
      if (!result.ok) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="rounded-lg border bg-background p-3 md:col-span-2">
      <h3 className="mb-2 text-sm font-medium">Settle and mark delivered</h3>

      <ul className="mb-3 space-y-2 text-sm">
        {lines.map((line) => (
          <li key={line.id} className="flex items-center gap-3">
            <span className="flex-1">
              {line.productName} · {line.variantLabel} × {line.quantity}
            </span>

            {isSettleable(line) ? (
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">delivered</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Weight delivered for ${line.productName} ${line.variantLabel}`}
                  placeholder={orderedQuantity(line)}
                  value={actuals[line.id] ?? ''}
                  onChange={(event) => setActuals({ ...actuals, [line.id]: event.target.value })}
                  className="w-24 text-right"
                />
                <span className="text-muted-foreground">kg</span>
              </span>
            ) : (
              <span className="text-muted-foreground">fixed size</span>
            )}
          </li>
        ))}
      </ul>

      <p className="mb-3 text-xs text-muted-foreground">
        Leave a box empty to bill the quantity ordered. Enter 0 if the item did not go out.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm">
          Collect <strong>{formatRupees(preview)}</strong>
          {order.paymentStatus === 'PAID' && ' — already paid online'}
        </span>
        <Button disabled={pending} onClick={submit}>
          {pending ? 'Saving…' : 'Mark delivered'}
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
