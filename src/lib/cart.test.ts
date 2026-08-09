import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  addItem,
  setQuantity,
  removeItem,
  totalQuantity,
  readCart,
  writeCart,
  cartSchema,
  MAX_QUANTITY_PER_ITEM,
} from './cart';
import { CART_STORAGE_KEY } from './constants';

describe('addItem', () => {
  it('appends an item that is not in the cart', () => {
    expect(addItem([], 'v1')).toEqual([{ variantId: 'v1', quantity: 1 }]);
  });

  it('tops up an item already in the cart rather than duplicating it', () => {
    const cart = addItem([{ variantId: 'v1', quantity: 2 }], 'v1', 3);
    expect(cart).toEqual([{ variantId: 'v1', quantity: 5 }]);
  });

  it('caps the topped-up quantity', () => {
    const cart = addItem([{ variantId: 'v1', quantity: MAX_QUANTITY_PER_ITEM }], 'v1');
    expect(cart[0].quantity).toBe(MAX_QUANTITY_PER_ITEM);
  });

  it('leaves other lines untouched', () => {
    const cart = addItem([{ variantId: 'v1', quantity: 1 }], 'v2');
    expect(cart).toHaveLength(2);
    expect(cart[0]).toEqual({ variantId: 'v1', quantity: 1 });
  });
});

describe('setQuantity', () => {
  it('sets an explicit quantity', () => {
    expect(setQuantity([{ variantId: 'v1', quantity: 1 }], 'v1', 4)).toEqual([
      { variantId: 'v1', quantity: 4 },
    ]);
  });

  it('removes the line at zero, which is what a stepper expects', () => {
    expect(setQuantity([{ variantId: 'v1', quantity: 1 }], 'v1', 0)).toEqual([]);
  });

  it('removes the line on a negative value rather than storing one', () => {
    expect(setQuantity([{ variantId: 'v1', quantity: 1 }], 'v1', -3)).toEqual([]);
  });

  it('caps at the per-item maximum', () => {
    const cart = setQuantity([{ variantId: 'v1', quantity: 1 }], 'v1', 5000);
    expect(cart[0].quantity).toBe(MAX_QUANTITY_PER_ITEM);
  });
});

describe('removeItem and totalQuantity', () => {
  it('removes only the named line', () => {
    const cart = removeItem(
      [
        { variantId: 'v1', quantity: 1 },
        { variantId: 'v2', quantity: 2 },
      ],
      'v1'
    );
    expect(cart).toEqual([{ variantId: 'v2', quantity: 2 }]);
  });

  it('counts units, not lines, for the header badge', () => {
    expect(
      totalQuantity([
        { variantId: 'v1', quantity: 2 },
        { variantId: 'v2', quantity: 3 },
      ])
    ).toBe(5);
  });
});

describe('cartSchema', () => {
  it('rejects a quantity of zero', () => {
    expect(cartSchema.safeParse({ items: [{ variantId: 'v1', quantity: 0 }] }).success).toBe(false);
  });

  it('rejects a fractional quantity', () => {
    expect(cartSchema.safeParse({ items: [{ variantId: 'v1', quantity: 1.5 }] }).success).toBe(
      false
    );
  });

  it('rejects a cart with an implausible number of distinct lines', () => {
    // Without a cap, a script could post a hundred thousand ids and make the
    // server do a hundred thousand lookups.
    const items = Array.from({ length: 101 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 }));
    expect(cartSchema.safeParse({ items }).success).toBe(false);
  });

  it('accepts an empty cart', () => {
    expect(cartSchema.safeParse({ items: [] }).success).toBe(true);
  });
});

describe('readCart', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a written cart', () => {
    writeCart([{ variantId: 'v1', quantity: 2 }]);
    expect(readCart()).toEqual([{ variantId: 'v1', quantity: 2 }]);
  });

  it('returns an empty cart when nothing is stored', () => {
    expect(readCart()).toEqual([]);
  });

  it('survives malformed JSON rather than taking the storefront down', () => {
    store[CART_STORAGE_KEY] = '{not json';
    expect(readCart()).toEqual([]);
  });

  it('survives a value that is not an array', () => {
    store[CART_STORAGE_KEY] = '{"items":[]}';
    expect(readCart()).toEqual([]);
  });

  it('drops entries that no longer match the current shape', () => {
    // localStorage outlives deploys, so it will eventually hold a shape from an
    // older version of this code.
    store[CART_STORAGE_KEY] = JSON.stringify([
      { variantId: 'v1', quantity: 2 },
      { variantId: 'v2', qty: 3 },
      { variantId: '', quantity: 1 },
      'nonsense',
    ]);
    expect(readCart()).toEqual([{ variantId: 'v1', quantity: 2 }]);
  });

  it('drops a tampered quantity that exceeds the cap', () => {
    store[CART_STORAGE_KEY] = JSON.stringify([{ variantId: 'v1', quantity: 999999 }]);
    expect(readCart()).toEqual([]);
  });
});
