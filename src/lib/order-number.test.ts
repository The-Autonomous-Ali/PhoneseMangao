import { describe, it, expect } from 'vitest';
import { generateOrderNumber } from './order-number';

describe('generateOrderNumber', () => {
  it('starts with the date so a stack sorts by eye', () => {
    expect(generateOrderNumber(new Date('2026-08-09T12:00:00Z'))).toMatch(/^PM260809-/);
  });

  it('pads single-digit months and days', () => {
    expect(generateOrderNumber(new Date('2026-01-05T12:00:00Z'))).toMatch(/^PM260105-/);
  });

  it('has a four-character tail', () => {
    expect(generateOrderNumber()).toMatch(/^PM\d{6}-[A-Z2-9]{4}$/);
  });

  it('omits characters that are misread aloud or by hand', () => {
    // These numbers get read down a phone line and copied onto a packing slip.
    const tails = Array.from({ length: 400 }, () => generateOrderNumber().split('-')[1]).join('');
    expect(tails).not.toMatch(/[IO01]/);
  });

  it('draws its tail from enough keyspace that repeats stay rare', () => {
    const numbers = new Set(Array.from({ length: 500 }, () => generateOrderNumber()));

    // Four characters from a 32-symbol alphabet is a keyspace of 1,048,576, so
    // by the birthday bound roughly 11% of 500-draw samples contain one
    // collision. Asserting a clean sweep here made this test fail about one run
    // in nine — a real property of the generator read as a bug.
    //
    // The guarantee that actually matters is not that these never repeat, but
    // that a repeat costs nothing: order creation catches the unique violation
    // on orderNumber and retries with a fresh one. That is the behaviour worth
    // trusting, and it lives in src/app/api/orders/route.ts.
    expect(numbers.size).toBeGreaterThanOrEqual(498);
  });
});
