import { cn } from '@/lib/utils';

/** The journey a customer is shown, in order. */
const STEPS = [
  { status: 'PENDING_OTP', title: 'Order placed', sub: 'Waiting for your confirmation code' },
  { status: 'CONFIRMED', title: 'Confirmed', sub: 'The shop has your order' },
  { status: 'PACKED', title: 'Packed', sub: 'Weighed and bagged' },
  { status: 'OUT_FOR_DELIVERY', title: 'Out for delivery', sub: 'On its way to you' },
  { status: 'DELIVERED', title: 'Delivered', sub: 'Enjoy!' },
] as const;

/**
 * Where each status sits on that journey.
 *
 * PENDING and PENDING_OTP share a rung: one is a card order awaiting payment
 * and the other a cash order awaiting a code, but to the person who placed it
 * they are the same thing — placed, not yet confirmed.
 */
const REACHED: Record<string, number> = {
  PENDING_OTP: 0,
  PENDING: 0,
  CONFIRMED: 1,
  PACKED: 2,
  OUT_FOR_DELIVERY: 3,
  DELIVERED: 4,
};

/**
 * The order's progress, as a vertical timeline.
 *
 * Steps not yet reached are shown rather than hidden. A customer wondering
 * where their vegetables are is asking "what happens next", and a list that
 * stops at the current step answers only "what has happened" — which is the
 * half they can already see.
 *
 * Cancelled and failed orders get no timeline at all: there is no journey left
 * to show, and drawing four grey steps under "Cancelled" reads as a promise.
 */
export function OrderTimeline({ status }: { status: string }) {
  const reached = REACHED[status];
  if (reached === undefined) return null;

  return (
    <ol className="rounded-2xl border border-border bg-card p-6">
      {STEPS.map((step, index) => {
        const done = index <= reached;
        const current = index === reached;
        const last = index === STEPS.length - 1;

        return (
          <li key={step.status} className="flex items-start gap-4">
            <div className="flex shrink-0 flex-col items-center">
              <span
                className={cn(
                  'inline-flex size-6.5 items-center justify-center rounded-full text-[13px] font-bold',
                  done ? 'bg-gold text-[#132019]' : 'bg-muted text-muted-foreground'
                )}
              >
                {done && !current ? '✓' : index + 1}
              </span>
              {!last && (
                <span className={cn('h-11 w-0.5', index < reached ? 'bg-gold' : 'bg-border')} />
              )}
            </div>

            <div className={cn('pb-5', last && 'pb-0')}>
              <div
                className={cn(
                  'text-[15.5px] font-semibold',
                  current ? 'text-gold' : done ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.title}
              </div>
              <div className="mt-0.5 text-[13px] text-[#94a69a]">{step.sub}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
