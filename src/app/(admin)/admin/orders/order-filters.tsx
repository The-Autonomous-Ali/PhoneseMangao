import { OrderStatus, SlotType } from '@prisma/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Native selects, because a plain GET form has to submit them without JavaScript. */
const SELECT_CLASS =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * Filter state lives in the URL, not in component state.
 *
 * A plain GET form means a filtered view survives a reload, can be bookmarked,
 * and can be sent to someone as a link — which matters when the answer to
 * "which orders are you looking at?" has to travel over a phone call.
 */
export function OrderFilters({
  date,
  slotType,
  status,
}: {
  date?: string;
  slotType?: string;
  status?: string;
}) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="filter-date">Date</Label>
        <Input id="filter-date" type="date" name="date" defaultValue={date} className="w-auto" />
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-slot">Slot</Label>
        <select id="filter-slot" name="slot" defaultValue={slotType ?? ''} className={SELECT_CLASS}>
          <option value="">All slots</option>
          {Object.values(SlotType).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-status">Status</Label>
        <select
          id="filter-status"
          name="status"
          defaultValue={status ?? ''}
          className={SELECT_CLASS}
        >
          <option value="">All statuses</option>
          {Object.values(OrderStatus).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit">Apply</Button>
      <a href="/admin/orders" className={buttonVariants({ variant: 'outline' })}>
        Clear
      </a>
    </form>
  );
}
