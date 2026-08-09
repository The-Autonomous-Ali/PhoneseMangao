import { describe, it, expect } from 'vitest';
import { formatRupees } from './format';

describe('formatRupees', () => {
  it('drops the decimals on a whole-rupee price', () => {
    expect(formatRupees('45.00')).toBe('₹45');
  });

  it('keeps paise when they are not zero', () => {
    expect(formatRupees('45.50')).toBe('₹45.50');
  });

  it('does not parse to a number, so long values keep every digit', () => {
    // Going through Number here would be the one place rounding could still
    // creep back in after all the Decimal handling upstream.
    expect(formatRupees('12345678.99')).toBe('₹12345678.99');
  });

  it('handles zero', () => {
    expect(formatRupees('0.00')).toBe('₹0');
  });
});
