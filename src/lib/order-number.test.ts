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

  it('does not repeat itself in a realistic day of orders', () => {
    const numbers = new Set(Array.from({ length: 500 }, () => generateOrderNumber()));
    expect(numbers.size).toBe(500);
  });
});
