import { describe, it, expect } from 'vitest';
import { calculateTotals } from './pricing';
import type { ShopSettings } from './settings';

const settings: ShopSettings = {
  deliveryFee: '30.00',
  minOrderValue: '199.00',
  freeDeliveryAbove: '500.00',
  shopOpen: true,
  paymentsEnabled: false,
  whatsappNumber: '',
  slotCapacity: 20,
};

describe('calculateTotals — delivery fee', () => {
  it('charges the fee below the threshold', () => {
    const totals = calculateTotals('250.00', settings);
    expect(totals.deliveryFee).toBe('30.00');
    expect(totals.grandTotal).toBe('280.00');
    expect(totals.deliveryWaived).toBe(false);
  });

  it('waives the fee above the threshold', () => {
    const totals = calculateTotals('600.00', settings);
    expect(totals.deliveryFee).toBe('0.00');
    expect(totals.grandTotal).toBe('600.00');
    expect(totals.deliveryWaived).toBe(true);
  });

  it('waives the fee at exactly the threshold', () => {
    // "Free delivery over ₹500" and then charging someone who spent exactly
    // ₹500 reads as a bug to the customer, and they are right.
    const totals = calculateTotals('500.00', settings);
    expect(totals.deliveryWaived).toBe(true);
    expect(totals.grandTotal).toBe('500.00');
  });

  it('does not waive a paisa below the threshold', () => {
    expect(calculateTotals('499.99', settings).deliveryWaived).toBe(false);
  });

  it('compares in decimal, not floating point', () => {
    // 0.1 + 0.2 style drift is what makes a `>= 500` test fail on a total that
    // is exactly 500 when it has been accumulated through JS numbers.
    const totals = calculateTotals('500.10', settings);
    expect(totals.deliveryWaived).toBe(true);
    expect(totals.grandTotal).toBe('500.10');
  });
});

describe('calculateTotals — minimum order', () => {
  it('is below the minimum with a shortfall', () => {
    const totals = calculateTotals('150.00', settings);
    expect(totals.meetsMinimum).toBe(false);
    expect(totals.shortfall).toBe('49.00');
  });

  it('meets the minimum exactly', () => {
    const totals = calculateTotals('199.00', settings);
    expect(totals.meetsMinimum).toBe(true);
    expect(totals.shortfall).toBe('0.00');
  });

  it('reports no shortfall once the minimum is passed', () => {
    expect(calculateTotals('1000.00', settings).shortfall).toBe('0.00');
  });

  it('treats an empty basket as below the minimum', () => {
    const totals = calculateTotals('0.00', settings);
    expect(totals.meetsMinimum).toBe(false);
    expect(totals.grandTotal).toBe('30.00');
  });
});

describe('calculateTotals — configuration changes', () => {
  it('honours a zero delivery fee', () => {
    const free = { ...settings, deliveryFee: '0.00' };
    expect(calculateTotals('100.00', free).grandTotal).toBe('100.00');
  });

  it('honours a raised minimum', () => {
    const strict = { ...settings, minOrderValue: '999.00' };
    expect(calculateTotals('500.00', strict).meetsMinimum).toBe(false);
  });

  it('keeps paise through the whole calculation', () => {
    const totals = calculateTotals('123.45', settings);
    expect(totals.itemsTotal).toBe('123.45');
    expect(totals.grandTotal).toBe('153.45');
  });
});
