import { buttonVariants } from '@/components/ui/button';
import { getSlotWeek } from '@/lib/admin/slot-queries';
import { SlotGrid } from './slot-grid';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today in India. The offset is explicit because the container runs UTC. */
function todayInIndia(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export default async function AdminSlotsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? '') ? params.from! : todayInIndia();

  const week = await getSlotWeek(from);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Delivery slots</h1>
        <div className="flex gap-2">
          <a
            href={`/admin/slots?from=${shiftDays(from, -7)}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            ← Previous week
          </a>
          <a
            href={`/admin/slots?from=${shiftDays(from, 7)}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            Next week →
          </a>
        </div>
      </div>

      <SlotGrid week={week} />
    </div>
  );
}
