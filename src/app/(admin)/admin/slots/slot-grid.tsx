'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import type { SlotDay, SlotWeek } from '@/lib/admin/slot-queries';
import { formatSlotDate, formatSlotType } from '@/lib/format';
import { setSlotCapacity, setSlotOpen, setDateOpen } from './actions';

function DayRow({ day, onError }: { day: SlotDay; onError: (message: string) => void }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const booked = day.slots.reduce((total, slot) => total + slot.booked, 0);
  const allClosed = day.slots.length > 0 && day.slots.every((slot) => !slot.isOpen);

  function toggleDate() {
    const reopening = allClosed;

    // Closing a date with orders in it is worth a second of friction. The
    // number is the point: it says what is at stake without deciding for him.
    if (!reopening && booked > 0) {
      const ok = window.confirm(
        `${booked} order${booked === 1 ? ' is' : 's are'} already booked on this date.\n\n` +
          'Closing stops new orders only — these still need delivering. ' +
          'Cancel them individually from Orders if that is what you mean.'
      );
      if (!ok) return;
    }

    startTransition(async () => {
      const result = await setDateOpen(day.date, reopening);
      if (!result.ok) onError(result.error);
      else router.refresh();
    });
  }

  return (
    <tr className="border-b align-top">
      <td className="py-3 pr-4">
        <div className="font-medium">{formatSlotDate(`${day.date}T00:00:00.000Z`)}</div>
        <div className="text-xs text-muted-foreground">{day.date}</div>
      </td>

      {day.slots.length === 0 ? (
        <td colSpan={4} className="py-3 text-sm text-muted-foreground">
          No slots generated for this day — the cron may not have run.
        </td>
      ) : (
        <>
          {day.slots.map((slot) => (
            <td key={slot.id} className="py-3 pr-4">
              <div className="text-xs text-muted-foreground">{formatSlotType(slot.slotType)}</div>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Capacity for ${slot.slotType}`}
                  defaultValue={String(slot.capacity)}
                  className="w-16 text-right"
                  onBlur={(event) => {
                    const next = event.target.value;
                    if (next === String(slot.capacity)) return;
                    startTransition(async () => {
                      const result = await setSlotCapacity(slot.id, next);
                      if (!result.ok) onError(result.error);
                      else router.refresh();
                    });
                  }}
                />
                <ToggleSwitch
                  checked={slot.isOpen}
                  label={`${slot.slotType} open`}
                  onToggle={(next) => setSlotOpen(slot.id, next)}
                  onError={onError}
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{slot.booked} booked</div>
            </td>
          ))}

          <td className="py-3">
            <Button variant="outline" disabled={pending} onClick={toggleDate}>
              {allClosed ? 'Reopen date' : 'Block date'}
            </Button>
          </td>
        </>
      )}
    </tr>
  );
}

export function SlotGrid({ week }: { week: SlotWeek }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <table className="w-full text-sm">
        <tbody>
          {week.days.map((day) => (
            <DayRow key={day.date} day={day} onError={setError} />
          ))}
        </tbody>
      </table>

      <p className="mt-4 text-xs text-muted-foreground">
        Capacity saves when you leave the box. Lowering it below the booked count is allowed — the
        orders already taken stand, and no new ones are accepted.
      </p>
    </div>
  );
}
