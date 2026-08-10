import { SlotType } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSlotPickingList } from '@/lib/admin/order-queries';
import { PickingSheet } from './picking-sheet';

export const dynamic = 'force-dynamic';

/**
 * Today in India, as a calendar date — the shop's default packing run.
 *
 * The offset is applied explicitly rather than trusting the host clock's zone,
 * for the same reason `generate-slots` does it: the container runs UTC unless
 * told otherwise, and the shop does not.
 */
function todayInIndia(): string {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export default async function PickingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; slot?: string }>;
}) {
  const params = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : todayInIndia();
  const slotType = Object.values(SlotType).includes(params.slot as SlotType)
    ? (params.slot as SlotType)
    : SlotType.MORNING;

  const list = await getSlotPickingList(date, slotType);

  return (
    <div>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <div className="space-y-1">
          <Label htmlFor="picking-date">Date</Label>
          <Input id="picking-date" type="date" name="date" defaultValue={date} className="w-auto" />
        </div>

        <div className="space-y-1">
          <Label htmlFor="picking-slot">Slot</Label>
          <select
            id="picking-slot"
            name="slot"
            defaultValue={slotType}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {Object.values(SlotType).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit">Show</Button>
      </form>

      {list.orderCount === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to pack for this slot.</p>
      ) : (
        <PickingSheet list={list} />
      )}
    </div>
  );
}
