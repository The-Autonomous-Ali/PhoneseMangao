import { getDashboard } from '@/lib/admin/dashboard-queries';
import { formatRupees, formatSlotType } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Today in India. The offset is explicit because the container runs UTC. */
function todayInIndia(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default async function AdminDashboardPage() {
  const summary = await getDashboard(todayInIndia());
  const action = summary.needsAction;
  const openTotal = action.pendingOtp + action.pending + action.confirmed + action.packed;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Today</h1>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Collected today"
          value={formatRupees(summary.collected.total)}
          hint={`${summary.collected.orders} delivered · cash ${formatRupees(
            summary.collected.cash
          )} · prepaid ${formatRupees(summary.collected.prepaid)}`}
        />
        <Stat
          label="Still to come"
          value={String(summary.upcoming.reduce((n, slot) => n + slot.orders, 0))}
          hint="orders due today"
        />
        <Stat label="Waiting on you" value={String(openTotal)} hint="across all dates" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Still to come, by slot</h2>
        {summary.upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing left to deliver today.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {summary.upcoming.map((slot) => (
              <li key={slot.slotType} className="flex items-center gap-4 p-3">
                <span className="font-medium">{formatSlotType(slot.slotType)}</span>
                <span className="text-muted-foreground">{slot.orders} orders</span>
                {/* Labelled an estimate: weights are settled at the door, so
                    this is not what will be collected. */}
                <span className="ml-auto">~{formatRupees(slot.estimated)} est.</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Waiting on you</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-4">
          <li className="rounded-lg border p-3">
            Unconfirmed <strong className="block text-lg">{action.pendingOtp}</strong>
          </li>
          <li className="rounded-lg border p-3">
            To confirm <strong className="block text-lg">{action.pending}</strong>
          </li>
          <li className="rounded-lg border p-3">
            To pack <strong className="block text-lg">{action.confirmed}</strong>
          </li>
          <li className="rounded-lg border p-3">
            To send out <strong className="block text-lg">{action.packed}</strong>
          </li>
        </ul>
        <a href="/admin/orders" className="mt-2 inline-block text-sm underline">
          Go to orders
        </a>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Low stock</h2>
        {summary.lowStock.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing running low. Items without a tracked count are not listed here.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {summary.lowStock.map((item) => (
              <li
                key={`${item.productName}-${item.variantLabel}`}
                className="flex items-center gap-4 p-3"
              >
                <span>{item.productName}</span>
                <span className="text-muted-foreground">{item.variantLabel}</span>
                <span className="ml-auto font-medium">{item.stockQty} left</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
