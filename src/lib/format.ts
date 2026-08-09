/**
 * Formats a Decimal-as-string for display.
 *
 * Takes a string rather than a number because that is how money travels through
 * this app — parsing to a number here would reintroduce, at the very last step,
 * exactly the rounding the Decimal columns exist to prevent.
 *
 * Whole rupees lose the ".00": grocery prices are read at a glance, and "₹45"
 * scans faster than "₹45.00" down a column of twenty items.
 */
export function formatRupees(value: string): string {
  const trimmed = value.endsWith('.00') ? value.slice(0, -3) : value;
  return `₹${trimmed}`;
}

/**
 * The delivery windows behind each slot type.
 *
 * The enum name is a label, not a time — the customer needs to know when to be
 * home, and "MORNING" does not tell them that.
 */
export const SLOT_WINDOWS: Record<string, string> = {
  MORNING: '7am – 10am',
  AFTERNOON: '12pm – 3pm',
  EVENING: '5pm – 8pm',
};

export function formatSlotType(slotType: string): string {
  const label = slotType.charAt(0) + slotType.slice(1).toLowerCase();
  const window = SLOT_WINDOWS[slotType];
  return window ? `${label} (${window})` : label;
}

/**
 * Renders a delivery date as "Today", "Tomorrow", or a weekday.
 *
 * Slots are stored as a date at midnight IST, so both sides are compared on
 * their UTC calendar date — going through the viewer's local timezone would
 * label tomorrow's slot as today for anyone west of India.
 */
export function formatSlotDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const dayKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (dayKey(date) === dayKey(now)) return 'Today';
  if (dayKey(date) === dayKey(tomorrow)) return 'Tomorrow';

  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
