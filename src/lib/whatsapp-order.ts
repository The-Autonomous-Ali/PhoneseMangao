import { formatRupees } from '@/lib/format';

export interface OrderLine {
  productName: string;
  variantLabel: string;
  quantity: number;
  lineTotal: string;
}

/**
 * How many basket lines go into the message.
 *
 * The whole message travels inside a URL, and a long one risks being truncated
 * somewhere between the browser, the operating system and WhatsApp. A truncated
 * order is worse than a summarised one — the shop would pack whatever survived
 * and nobody would know a line was lost. Past this, the rest is counted instead.
 */
const MAX_LISTED_LINES = 20;

/**
 * A wa.me link, or null when the shop has given no number.
 *
 * Null rather than a broken link on purpose: the caller hides the button. A
 * WhatsApp button that opens nothing reads as the shop ignoring you, which is
 * worse than not offering it.
 */
export function whatsappLink(number: string, message?: string): string | null {
  // wa.me rejects a leading '+', and shop owners type numbers with spaces and
  // dashes that no validation has stopped.
  const digits = number.replace(/\D/g, '');
  if (!digits) return null;

  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/**
 * The message a customer sends after filling a basket on the site.
 *
 * The site is the catalogue and this is the handover: everything they picked,
 * already written out, so the shop is not asking "which size?" three times.
 */
export function cartOrderMessage(input: {
  shopName: string;
  lines: OrderLine[];
  total: string;
  pincode?: string | null;
}): string {
  const parts = [`Hi! I'd like to order from ${input.shopName}:`];

  if (input.lines.length > 0) {
    const listed = input.lines.slice(0, MAX_LISTED_LINES);
    const remaining = input.lines.length - listed.length;

    parts.push(
      '',
      ...listed.map(
        (line) =>
          `• ${line.productName} ${line.variantLabel} × ${line.quantity} — ${formatRupees(line.lineTotal)}`
      )
    );

    if (remaining > 0) parts.push(`• …and ${remaining} more items`);

    // The total covers the whole basket even when the list is shortened, so
    // the figure the shop sees is never a partial one.
    parts.push('', `Total: ${formatRupees(input.total)}`);
  }

  if (input.pincode) parts.push(`Deliver to: ${input.pincode}`);

  return parts.join('\n');
}

/**
 * The message for the floating call/WhatsApp button, present on every page.
 *
 * Unlike `cartOrderMessage`, this may run with no basket at all — someone
 * browsing the home page has never added anything. `null` and an empty basket
 * both fall back to a plain greeting rather than "I'd like to order from
 * Shop:" with nothing under it, which would read as a mistake rather than a
 * question.
 */
export function floatingButtonMessage(input: {
  shopName: string;
  cart: { lines: OrderLine[]; total: string; pincode?: string | null } | null;
}): string {
  if (!input.cart || input.cart.lines.length === 0) {
    return `Hi! I have a question about ${input.shopName}.`;
  }
  return cartOrderMessage({ shopName: input.shopName, ...input.cart });
}

/** The message for someone asking about one item from its own page. */
export function productEnquiryMessage(input: {
  shopName: string;
  productName: string;
  variantLabel: string;
  price: string;
}): string {
  return [
    `Hi! I'd like to order from ${input.shopName}:`,
    '',
    `• ${input.productName} ${input.variantLabel} — ${formatRupees(input.price)}`,
  ].join('\n');
}
