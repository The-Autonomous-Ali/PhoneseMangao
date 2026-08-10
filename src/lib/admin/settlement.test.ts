import { describe, it, expect } from 'vitest';
import { UnitType } from '@prisma/client';
import {
  isSettleable,
  orderedQuantity,
  settleLines,
  finalTotalFor,
  type SettleableLine,
} from './settlement';

function line(overrides: Partial<SettleableLine> = {}): SettleableLine {
  return {
    id: 'oi_1',
    productName: 'Potato',
    variantLabel: '5 kg',
    unitType: UnitType.KG,
    unitPrice: '160.00',
    unitValue: '5.000',
    quantity: 1,
    lineTotal: '160.00',
    ...overrides,
  };
}

describe('isSettleable', () => {
  it('accepts loose produce sold by weight', () => {
    expect(isSettleable(line())).toBe(true);
  });

  it('rejects everything else, because a pre-packed size is what it says', () => {
    expect(isSettleable(line({ unitType: UnitType.GRAM }))).toBe(false);
    expect(isSettleable(line({ unitType: UnitType.PIECE }))).toBe(false);
    expect(isSettleable(line({ unitType: UnitType.LITRE }))).toBe(false);
  });

  it('rejects a zero pack size rather than dividing by it', () => {
    expect(isSettleable(line({ unitValue: '0.000' }))).toBe(false);
  });
});

describe('orderedQuantity', () => {
  it('multiplies pack size by pack count', () => {
    expect(orderedQuantity(line({ unitValue: '5.000', quantity: 2 }))).toBe('10.000');
    expect(orderedQuantity(line({ unitValue: '1.000', quantity: 3 }))).toBe('3.000');
  });
});

describe('settleLines', () => {
  it('prices a short delivery off the per-kilo rate, not the pack price', () => {
    // Rs 160 for 5 kg is Rs 32/kg, so 4.7 kg is Rs 150.40. Reading the pack
    // price as a per-kilo price would charge Rs 752.
    const result = settleLines([line()], { oi_1: '4.700' });

    expect(result.lines[0].adjustedTotal).toBe('150.40');
    expect(result.lines[0].actualQuantity).toBe('4.700');
    expect(result.lines[0].effectiveTotal).toBe('150.40');
    expect(result.itemsTotal).toBe('150.40');
  });

  it('handles a multi-pack line', () => {
    // 2 x 1 kg at Rs 45 = Rs 45/kg; 1.8 kg delivered is Rs 81.
    const result = settleLines(
      [line({ unitPrice: '45.00', unitValue: '1.000', quantity: 2, lineTotal: '90.00' })],
      { oi_1: '1.800' }
    );

    expect(result.lines[0].adjustedTotal).toBe('81.00');
  });

  it('leaves a line alone when no actual weight was entered', () => {
    // A blank box means "as ordered", not "zero delivered".
    const result = settleLines([line()], {});

    expect(result.lines[0].adjustedTotal).toBeNull();
    expect(result.lines[0].actualQuantity).toBeNull();
    expect(result.lines[0].effectiveTotal).toBe('160.00');
    expect(result.itemsTotal).toBe('160.00');
  });

  it('accepts a genuine zero when the item was out of stock at loading', () => {
    const result = settleLines([line()], { oi_1: '0' });

    expect(result.lines[0].adjustedTotal).toBe('0.00');
    expect(result.lines[0].effectiveTotal).toBe('0.00');
  });

  it('never adjusts a non-KG line, even if a value is posted for it', () => {
    const packed = line({
      id: 'oi_2',
      unitType: UnitType.GRAM,
      unitValue: '500.000',
      lineTotal: '25.00',
    });
    const result = settleLines([packed], { oi_2: '0.400' });

    expect(result.lines[0].adjustedTotal).toBeNull();
    expect(result.lines[0].effectiveTotal).toBe('25.00');
  });

  it('sums a mixed basket', () => {
    const result = settleLines(
      [
        line({ id: 'oi_1', unitPrice: '45.00', unitValue: '1.000', quantity: 2, lineTotal: '90.00' }),
        line({
          id: 'oi_2',
          unitType: UnitType.PIECE,
          unitValue: '12.000',
          unitPrice: '60.00',
          quantity: 1,
          lineTotal: '60.00',
        }),
      ],
      { oi_1: '1.800' }
    );

    expect(result.itemsTotal).toBe('141.00');
  });
});

describe('finalTotalFor', () => {
  it('adds the fee that was quoted, not one recomputed from the new total', () => {
    // Ordered Rs 520 so delivery was waived; actual weights come to Rs 480.
    // Re-running the threshold would charge Rs 30 the customer was told they
    // had avoided, because the shop's scale read light.
    expect(finalTotalFor('480.00', '0.00')).toBe('480.00');
  });

  it('keeps a fee that was charged', () => {
    expect(finalTotalFor('210.50', '30.00')).toBe('240.50');
  });
});
