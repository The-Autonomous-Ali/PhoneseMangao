import { randomInt } from 'node:crypto';

/** No I, O, 0 or 1 — these get read aloud over the phone and copied by hand. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A short order reference the customer and the shop can say to each other.
 *
 * Not the row id: a cuid is 25 characters of noise, and every "which order?"
 * conversation happens over a phone call. The date prefix makes a stack of
 * these sortable by eye, and the random tail avoids a shared counter — a
 * sequential number would need a lock on every order to stay unique, and would
 * also tell a competitor exactly how many orders the shop takes in a day.
 */
export function generateOrderNumber(now = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');

  let tail = '';
  for (let i = 0; i < 4; i++) tail += ALPHABET[randomInt(ALPHABET.length)];

  return `PM${yy}${mm}${dd}-${tail}`;
}
