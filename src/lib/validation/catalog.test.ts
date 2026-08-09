import { describe, it, expect } from 'vitest';
import { categorySchema, productSchema, variantSchema } from './catalog';

const validVariant = {
  label: '1 kg',
  unitType: 'KG',
  unitValue: '1',
  price: '45',
  mrp: '55',
  stockQty: '',
  sku: '',
};

describe('categorySchema', () => {
  it('accepts a name and defaults sortOrder', () => {
    const parsed = categorySchema.parse({ name: 'Vegetables' });
    expect(parsed).toEqual({ name: 'Vegetables', sortOrder: 0 });
  });

  it('trims surrounding whitespace', () => {
    expect(categorySchema.parse({ name: '  Fruits  ' }).name).toBe('Fruits');
  });

  it('rejects an empty name', () => {
    expect(categorySchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('productSchema', () => {
  it('accepts a product with a category', () => {
    const parsed = productSchema.parse({ name: 'Tomatoes', categoryId: 'cat_1' });
    expect(parsed.name).toBe('Tomatoes');
  });

  it('requires a category', () => {
    expect(productSchema.safeParse({ name: 'Tomatoes', categoryId: '' }).success).toBe(false);
  });

  it('treats an untouched description textarea as absent, not as an empty string', () => {
    expect(productSchema.parse({ name: 'X', categoryId: 'c', description: '' }).description).toBe(
      undefined
    );
  });
});

describe('variantSchema', () => {
  it('accepts a well-formed variant', () => {
    expect(variantSchema.safeParse(validVariant).success).toBe(true);
  });

  it('keeps money as a string so it reaches Decimal unrounded', () => {
    // Parsing to a JS number would round through binary floating point, and
    // these values are summed into totals reconciled against bank settlements.
    const parsed = variantSchema.parse({ ...validVariant, price: '1234.55', mrp: '1400' });
    expect(parsed.price).toBe('1234.55');
    expect(typeof parsed.price).toBe('string');
  });

  it.each(['0', '0.00', '-5', 'abc', '45.555', ''])('rejects %s as a price', (price) => {
    expect(variantSchema.safeParse({ ...validVariant, price }).success).toBe(false);
  });

  it('rejects an MRP below the selling price', () => {
    // Would render as a negative discount, and in India the MRP is the printed
    // legal maximum — selling above it is not an accident to allow through.
    const result = variantSchema.safeParse({ ...validVariant, price: '60', mrp: '55' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['mrp']);
  });

  it('accepts an MRP equal to the price', () => {
    expect(variantSchema.safeParse({ ...validVariant, price: '45', mrp: '45' }).success).toBe(true);
  });

  it('accepts a missing MRP', () => {
    expect(variantSchema.parse({ ...validVariant, mrp: '' }).mrp).toBe(undefined);
  });

  it('accepts a fractional unit value for a part-kilo pack', () => {
    expect(variantSchema.parse({ ...validVariant, unitValue: '0.500' }).unitValue).toBe('0.500');
  });

  it('rejects a zero unit value', () => {
    expect(variantSchema.safeParse({ ...validVariant, unitValue: '0' }).success).toBe(false);
  });

  it('rejects an unknown unit type', () => {
    expect(variantSchema.safeParse({ ...validVariant, unitType: 'DOZEN' }).success).toBe(false);
  });

  it('turns a blank SKU into absent, so blanks do not collide on the unique index', () => {
    expect(variantSchema.parse({ ...validVariant, sku: '' }).sku).toBe(undefined);
  });
});
