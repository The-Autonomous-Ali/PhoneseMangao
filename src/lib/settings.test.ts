import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    setting: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
  },
}));

import { db } from '@/lib/db';
import { getShopSettings, writeSettings } from './settings';

function rows(values: Record<string, unknown>) {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

beforeEach(() => {
  vi.mocked(db.setting.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(db.setting.upsert).mockReset().mockReturnValue({} as never);
  vi.mocked(db.$transaction).mockClear();
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

describe('getShopSettings — slot capacity', () => {
  it('defaults to twenty, the capacity the cron used to hardcode', async () => {
    expect((await getShopSettings()).slotCapacity).toBe(20);
  });

  it('reads a configured capacity', async () => {
    vi.mocked(db.setting.findMany).mockResolvedValue(rows({ slot_capacity: 30 }) as never);
    expect((await getShopSettings()).slotCapacity).toBe(30);
  });

  it('accepts a string, since the column is JSON', async () => {
    vi.mocked(db.setting.findMany).mockResolvedValue(rows({ slot_capacity: '30' }) as never);
    expect((await getShopSettings()).slotCapacity).toBe(30);
  });

  it('allows zero, which is how a slot stays visible but unbookable', async () => {
    vi.mocked(db.setting.findMany).mockResolvedValue(rows({ slot_capacity: 0 }) as never);
    expect((await getShopSettings()).slotCapacity).toBe(0);
  });

  it.each([['many'], [null], [-5], [2.5], [10000]])(
    'falls back when slot_capacity holds %s',
    async (value) => {
      vi.mocked(db.setting.findMany).mockResolvedValue(rows({ slot_capacity: value }) as never);
      expect((await getShopSettings()).slotCapacity).toBe(20);
    }
  );
});

describe('writeSettings', () => {
  it('upserts each key so a first write and an update take the same path', async () => {
    await writeSettings({ delivery_fee: '45.00', shop_open: false });

    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: 'delivery_fee' },
      create: { key: 'delivery_fee', value: '45.00' },
      update: { value: '45.00' },
    });
    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: 'shop_open' },
      create: { key: 'shop_open', value: false },
      update: { value: false },
    });
  });

  it('writes every key in one transaction, so a half-saved form cannot survive', async () => {
    await writeSettings({ delivery_fee: '45.00', min_order_value: '299.00' });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
  });

  it('does nothing at all when given nothing', async () => {
    await writeSettings({});
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
