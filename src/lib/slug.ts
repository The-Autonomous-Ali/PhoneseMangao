/** Keeps a URL readable and well under any index or path length limit. */
const MAX_SLUG_LENGTH = 60;

/**
 * Used when a name transliterates to nothing at all.
 *
 * This is not a rare edge case here: a shop in India will have products named
 * in Devanagari or Tamil, and stripping to `[a-z0-9]` leaves an empty string.
 * An empty slug would violate the unique index on the second such product, so
 * they fall back to `item`, `item-2`, … via the caller's collision handling.
 */
const FALLBACK_SLUG = 'item';

/**
 * Turns a product or category name into a URL segment.
 *
 * Deliberately lossy and ASCII-only: slugs end up in URLs that get pasted into
 * WhatsApp, and percent-encoded Devanagari is unreadable and easy to mangle.
 * The name itself is what the customer sees; the slug only has to be stable
 * and unique.
 */
export function slugify(value: string): string {
  const slug = value
    // NFKD splits accented characters into letter + combining mark, so the
    // marks can be dropped and the base letter kept: "Purée" -> "puree".
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    // The slice can leave a trailing hyphen when it lands mid-separator.
    .replace(/-+$/, '');

  return slug || FALLBACK_SLUG;
}

/**
 * The nth candidate for a base slug: `tomatoes`, `tomatoes-2`, `tomatoes-3`.
 *
 * Callers walk this on a unique-constraint violation rather than querying for
 * a free slug first — a check-then-insert is racy, and two products created in
 * the same second would both see the same slug as available.
 */
export function slugCandidate(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}
