import { describe, it, expect } from 'vitest';
import { PINCODE_PATTERN } from '@/lib/serviceability';
import { pincodeSchema, slotCapacitySchema, shopSettingsSchema } from './config';

const VALID_SETTINGS = {
  deliveryFee: '30',
  minOrderValue: '199',
  freeDeliveryAbove: '500',
  whatsappNumber: '+919876543210',
  slotCapacity: '20',
};

describe('pincodeSchema', () => {
  it('accepts a six-digit code with an area name', () => {
    const parsed = pincodeSchema.parse({ pincode: '560001', area: 'Indiranagar' });
    expect(parsed).toEqual({ pincode: '560001', area: 'Indiranagar' });
  });

  it('treats a blank area as no area rather than an empty name', () => {
    expect(pincodeSchema.parse({ pincode: '560001', area: '  ' }).area).toBeUndefined();
  });

  it.each([['56001'], ['5600011'], ['060001'], ['ABC123'], ['']])('rejects %s', (value) => {
    expect(() => pincodeSchema.parse({ pincode: value })).toThrow();
  });

  it('applies the same rule the serviceability check uses', () => {
    // Two copies of this rule would drift, and this one decides whether a
    // customer can order at all.
    expect(PINCODE_PATTERN.test('560001')).toBe(true);
    expect(pincodeSchema.parse({ pincode: '560001' }).pincode).toBe('560001');
  });
});

describe('slotCapacitySchema', () => {
  it('accepts a whole number', () => {
    expect(slotCapacitySchema.parse('30')).toBe(30);
  });

  it('accepts zero, which keeps a slot visible but unbookable', () => {
    expect(slotCapacitySchema.parse('0')).toBe(0);
  });

  it.each([['-1'], ['2.5'], ['501'], ['many'], ['']])('rejects %s', (value) => {
    expect(() => slotCapacitySchema.parse(value)).toThrow();
  });
});

describe('shopSettingsSchema', () => {
  it('accepts a filled-in form', () => {
    const parsed = shopSettingsSchema.parse(VALID_SETTINGS);
    expect(parsed.deliveryFee).toBe('30');
    expect(parsed.slotCapacity).toBe(20);
  });

  it('accepts zero for every amount', () => {
    // A delivery fee of 0 is a shop that never charges for delivery, and a
    // free-delivery threshold of 0 makes it always free. Both are real
    // configurations, which is why catalog.ts's `rupees` is not reused here.
    const parsed = shopSettingsSchema.parse({
      ...VALID_SETTINGS,
      deliveryFee: '0',
      minOrderValue: '0',
      freeDeliveryAbove: '0',
    });

    expect(parsed.deliveryFee).toBe('0');
    expect(parsed.minOrderValue).toBe('0');
  });

  it('keeps amounts as strings so nothing rounds on the way to Decimal', () => {
    expect(shopSettingsSchema.parse({ ...VALID_SETTINGS, deliveryFee: '45.50' }).deliveryFee).toBe(
      '45.50'
    );
  });

  it.each([['45.555'], ['-5'], ['abc'], ['']])('rejects a delivery fee of %s', (value) => {
    expect(() => shopSettingsSchema.parse({ ...VALID_SETTINGS, deliveryFee: value })).toThrow();
  });

  it('allows the WhatsApp number to be left empty', () => {
    expect(shopSettingsSchema.parse({ ...VALID_SETTINGS, whatsappNumber: '' }).whatsappNumber).toBe(
      ''
    );
  });

  it('rejects a WhatsApp number that is not a phone number', () => {
    expect(() =>
      shopSettingsSchema.parse({ ...VALID_SETTINGS, whatsappNumber: 'call the shop' })
    ).toThrow();
  });
});
