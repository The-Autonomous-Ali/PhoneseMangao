import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { setting: { findMany: vi.fn() } } }));

import { db } from '@/lib/db';
import { getShopSettings } from './settings';

function rows(values: Record<string, unknown>) {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

beforeEach(() => {
  vi.mocked(db.setting.findMany).mockReset().mockResolvedValue([] as never);
});

describe('getShopSettings', () => {
  it('falls back to defaults when the table is empty', async () => {
    // A checkout that throws because a settings row was deleted is a worse
    // failure than one that charges the default and lets the owner notice.
    const settings = await getShopSettings();

    expect(settings.deliveryFee).toBe('30.00');
    expect(settings.minOrderValue).toBe('199.00');
    expect(settings.freeDeliveryAbove).toBe('500.00');
    expect(settings.shopOpen).toBe(true);
  });

  it('reads configured values', async () => {
    vi.mocked(db.setting.findMany).mockResolvedValue(
      rows({ delivery_fee: '45.00', min_order_value: '299.00' }) as never
    );

    const settings = await getShopSettings();

    expect(settings.deliveryFee).toBe('45.00');
    expect(settings.minOrderValue).toBe('299.00');
  });

  it('accepts a number as well as a string, since the column is JSON', async () => {
    vi.mocked(db.setting.findMany).mockResolvedValue(rows({ delivery_fee: 40 }) as never);
    expect((await getShopSettings()).deliveryFee).toBe('40');
  });

  it.each([['not money'], [null], [{ nested: true }], ['-5']])(
    'falls back when delivery_fee holds %s',
    async (value) => {
      vi.mocked(db.setting.findMany).mockResolvedValue(rows({ delivery_fee: value }) as never);
      expect((await getShopSettings()).deliveryFee).toBe('30.00');
    }
  );

  it('closes the shop only on an explicit false', async () => {
    vi.mocked(db.setting.findMany).mockResolvedValue(rows({ shop_open: false }) as never);
    expect((await getShopSettings()).shopOpen).toBe(false);
  });

  it('leaves the shop open when shop_open holds something odd', async () => {
    // A typo in the settings table should not silently close the business.
    vi.mocked(db.setting.findMany).mockResolvedValue(rows({ shop_open: 'yes' }) as never);
    expect((await getShopSettings()).shopOpen).toBe(true);
  });
});

describe('getShopSettings — payments', () => {
  it('keeps payments off by default', async () => {
    // Defaulting this on would offer a payment method to a shop whose Razorpay
    // KYC has not cleared, failing at the last step of checkout.
    expect((await getShopSettings()).paymentsEnabled).toBe(false);
  });

  it('enables payments only on an explicit true', async () => {
    vi.mocked(db.setting.findMany).mockResolvedValue(rows({ payments_enabled: true }) as never);
    expect((await getShopSettings()).paymentsEnabled).toBe(true);
  });

  it.each([['yes'], [1], ['true'], [null]])(
    'leaves payments off when payments_enabled holds %s',
    async (value) => {
      vi.mocked(db.setting.findMany).mockResolvedValue(rows({ payments_enabled: value }) as never);
      expect((await getShopSettings()).paymentsEnabled).toBe(false);
    }
  );
});
