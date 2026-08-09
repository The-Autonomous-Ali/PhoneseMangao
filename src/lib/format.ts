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
