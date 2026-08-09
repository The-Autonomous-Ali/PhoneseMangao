import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, UnitType } from '@prisma/client';

vi.mock('@/lib/db', () => ({ db: { variant: { findMany: vi.fn() } } }));

import { db } from '@/lib/db';
import { priceCart } from './cart-pricing';

function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v_tomato_1kg',
    label: '1 kg',
    unitType: UnitType.KG,
    price: new Prisma.Decimal('45.00'),
    isAvailable: true,
    stockQty: null,
    product: {
      name: 'Tomatoes',
      slug: 'tomatoes',
      imageUrl: null,
      isActive: true,
      category: { isActive: true },
    },
    ...overrides,
  };
}

const oneTomato = [{ variantId: 'v_tomato_1kg', quantity: 1 }];

beforeEach(() => {
  vi.mocked(db.variant.findMany).mockReset().mockResolvedValue([variant()] as never);
});

describe('priceCart — pricing', () => {
  it('prices a line from the database, ignoring anything the client claims', async () => {
    // The browser stores only ids and quantities, so there is no client price
    // to trust — which is the point of the design.
    const priced = await priceCart([{ variantId: 'v_tomato_1kg', quantity: 3 }]);

    expect(priced.items[0].unitPrice).toBe('45.00');
    expect(priced.items[0].lineTotal).toBe('135.00');
    expect(priced.itemsTotal).toBe('135.00');
  });

  it('sums several lines without floating-point drift', async () => {
    vi.mocked(db.variant.findMany).mockResolvedValue([
      variant({ id: 'a', price: new Prisma.Decimal('0.10') }),
      variant({ id: 'b', price: new Prisma.Decimal('0.20') }),
    ] as never);

    const priced = await priceCart([
      { variantId: 'a', quantity: 1 },
      { variantId: 'b', quantity: 1 },
    ]);

    // 0.1 + 0.2 in binary floating point is 0.30000000000000004.
    expect(priced.itemsTotal).toBe('0.30');
  });

  it('returns an empty result without querying for an empty basket', async () => {
    await expect(priceCart([])).resolves.toEqual({ items: [], issues: [], itemsTotal: '0.00' });
    expect(db.variant.findMany).not.toHaveBeenCalled();
  });

  it('carries the unit type through, which the order line needs', async () => {
    const priced = await priceCart(oneTomato);
    expect(priced.items[0].unitType).toBe(UnitType.KG);
  });
});

describe('priceCart — issues', () => {
  it('drops a variant that no longer exists', async () => {
    vi.mocked(db.variant.findMany).mockResolvedValue([] as never);

    const priced = await priceCart(oneTomato);

    expect(priced.items).toEqual([]);
    expect(priced.issues[0]).toMatchObject({ variantId: 'v_tomato_1kg', reason: 'REMOVED' });
  });

  it('drops a variant the shop marked sold out', async () => {
    vi.mocked(db.variant.findMany).mockResolvedValue([variant({ isAvailable: false })] as never);

    const priced = await priceCart(oneTomato);

    expect(priced.items).toEqual([]);
    expect(priced.issues[0].reason).toBe('UNAVAILABLE');
  });

  it('drops a variant whose product was hidden', async () => {
    vi.mocked(db.variant.findMany).mockResolvedValue([
      variant({ product: { ...variant().product, isActive: false } }),
    ] as never);

    expect((await priceCart(oneTomato)).issues[0].reason).toBe('UNAVAILABLE');
  });

  it('drops a variant whose whole category was switched off', async () => {
    // Hiding a category leaves its product rows untouched, so a basket saved
    // before it was hidden would otherwise stay buyable.
    vi.mocked(db.variant.findMany).mockResolvedValue([
      variant({ product: { ...variant().product, category: { isActive: false } } }),
    ] as never);

    expect((await priceCart(oneTomato)).issues[0].reason).toBe('UNAVAILABLE');
  });

  it('clamps a quantity to the stock left and says so', async () => {
    vi.mocked(db.variant.findMany).mockResolvedValue([variant({ stockQty: 2 })] as never);

    const priced = await priceCart([{ variantId: 'v_tomato_1kg', quantity: 5 }]);

    expect(priced.items[0].quantity).toBe(2);
    expect(priced.items[0].lineTotal).toBe('90.00');
    expect(priced.issues[0]).toMatchObject({ reason: 'STOCK' });
  });

  it('drops rather than clamps when stock has reached zero', async () => {
    vi.mocked(db.variant.findMany).mockResolvedValue([variant({ stockQty: 0 })] as never);

    const priced = await priceCart(oneTomato);

    expect(priced.items).toEqual([]);
    expect(priced.issues[0].reason).toBe('UNAVAILABLE');
  });

  it('ignores stock entirely when the shop does not track it', async () => {
    // null means untracked, which is the normal case for loose produce.
    const priced = await priceCart([{ variantId: 'v_tomato_1kg', quantity: 40 }]);

    expect(priced.items[0].quantity).toBe(40);
    expect(priced.issues).toEqual([]);
  });

  it('keeps the good lines when one line has a problem', async () => {
    vi.mocked(db.variant.findMany).mockResolvedValue([
      variant({ id: 'good' }),
      variant({ id: 'gone', isAvailable: false }),
    ] as never);

    const priced = await priceCart([
      { variantId: 'good', quantity: 1 },
      { variantId: 'gone', quantity: 1 },
    ]);

    expect(priced.items).toHaveLength(1);
    expect(priced.items[0].variantId).toBe('good');
    expect(priced.itemsTotal).toBe('45.00');
  });
});
