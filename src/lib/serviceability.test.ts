import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { servicePincode: { findFirst: vi.fn() } },
}));

vi.mock('@/lib/settings', () => ({ getShopSettings: vi.fn() }));

import { db } from '@/lib/db';
import { getShopSettings } from '@/lib/settings';
import { isServiceable, isValidPincode } from './serviceability';

/** The shop, near Indiranagar. */
const SHOP = { lat: 12.9784, lng: 77.6408 };

/** Roughly 2 km away — comfortably inside a 5 km radius. */
const NEARBY = { lat: 12.9605, lng: 77.6390 };

/** Bengaluru to Mysuru. Nobody is delivering this. */
const FAR = { lat: 12.2958, lng: 76.6394 };

function shopSettings(overrides: Record<string, unknown> = {}) {
  return {
    deliveryFee: '30.00',
    minOrderValue: '199.00',
    freeDeliveryAbove: '500.00',
    shopOpen: true,
    paymentsEnabled: false,
    whatsappNumber: '',
    slotCapacity: 20,
    shopLat: SHOP.lat,
    shopLng: SHOP.lng,
    deliveryRadiusKm: 5,
    ...overrides,
  } as Awaited<ReturnType<typeof getShopSettings>>;
}

beforeEach(() => {
  vi.mocked(db.servicePincode.findFirst).mockReset().mockResolvedValue(null);
  // Default: shop location unset, which is the state every existing
  // installation is in until the owner fills it in.
  vi.mocked(getShopSettings)
    .mockReset()
    .mockResolvedValue(shopSettings({ shopLat: null, shopLng: null }));
});

describe('isValidPincode', () => {
  it.each(['110001', '400072', '682001'])('accepts %s', (pincode) => {
    expect(isValidPincode(pincode)).toBe(true);
  });

  it('rejects a leading zero, which no Indian PIN code has', () => {
    expect(isValidPincode('012345')).toBe(false);
  });

  it.each(['1234', '1234567', 'abcdef', '', '11 001'])('rejects %s', (pincode) => {
    expect(isValidPincode(pincode)).toBe(false);
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(isValidPincode('  110001  ')).toBe(true);
  });
});

describe('isServiceable — the pincode list', () => {
  it('is serviceable when an active pincode row exists', async () => {
    vi.mocked(db.servicePincode.findFirst).mockResolvedValue({ area: 'Andheri East' } as never);

    await expect(isServiceable({ pincode: '400069' })).resolves.toMatchObject({
      serviceable: true,
      area: 'Andheri East',
      reason: 'PINCODE_LISTED',
    });
  });

  it('omits the area when the shop has not recorded one', async () => {
    vi.mocked(db.servicePincode.findFirst).mockResolvedValue({ area: null } as never);

    const result = await isServiceable({ pincode: '400069' });

    expect(result.serviceable).toBe(true);
    expect(result.area).toBeUndefined();
  });

  it('is not serviceable when no row matches and no location is configured', async () => {
    await expect(isServiceable({ pincode: '999999' })).resolves.toMatchObject({
      serviceable: false,
      reason: 'NOT_SERVICEABLE',
    });
  });

  it('only counts pincodes the shop has left switched on', async () => {
    await isServiceable({ pincode: '400069' });

    expect(db.servicePincode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pincode: '400069', isActive: true } })
    );
  });

  it('rejects a malformed pincode without querying', async () => {
    await expect(isServiceable({ pincode: 'abc' })).resolves.toMatchObject({ serviceable: false });
    expect(db.servicePincode.findFirst).not.toHaveBeenCalled();
  });

  it('trims before looking up, so a pasted value still matches', async () => {
    vi.mocked(db.servicePincode.findFirst).mockResolvedValue({ area: null } as never);

    await isServiceable({ pincode: ' 400069 ' });

    expect(db.servicePincode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pincode: '400069', isActive: true } })
    );
  });
});

describe('isServiceable — the delivery radius', () => {
  beforeEach(() => {
    vi.mocked(getShopSettings).mockResolvedValue(shopSettings());
  });

  it('delivers to a pin inside the radius', async () => {
    const result = await isServiceable({ pincode: '560038', ...NEARBY });

    expect(result.serviceable).toBe(true);
    expect(result.reason).toBe('WITHIN_RADIUS');
    expect(result.distanceKm).toBeLessThan(5);
  });

  it('refuses a pin outside the radius', async () => {
    const result = await isServiceable({ pincode: '570001', ...FAR });

    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe('OUTSIDE_RADIUS');
    expect(result.distanceKm).toBeGreaterThan(100);
  });

  it('honours a listed pincode even when the pin is outside the radius', async () => {
    // The escape hatch: the colony at 5.2 km the shop is happy to serve. The
    // owner adds its pincode and the circle stops being the last word.
    vi.mocked(db.servicePincode.findFirst).mockResolvedValue({ area: 'Mysuru' } as never);

    const result = await isServiceable({ pincode: '570001', ...FAR });

    expect(result.serviceable).toBe(true);
    expect(result.reason).toBe('PINCODE_LISTED');
  });

  it('asks for a location rather than refusing when the pin is missing', async () => {
    // An address saved before the map existed. Refusing it outright would read
    // as "we do not deliver to you"; the real answer is "drop a pin".
    const result = await isServiceable({ pincode: '560038' });

    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe('LOCATION_NEEDED');
  });

  it('measures from the shop, so a nearer pin is nearer', async () => {
    const near = await isServiceable({ pincode: '560038', ...NEARBY });
    const far = await isServiceable({ pincode: '570001', ...FAR });

    expect(near.distanceKm!).toBeLessThan(far.distanceKm!);
  });

  it('respects a radius the owner has widened', async () => {
    vi.mocked(getShopSettings).mockResolvedValue(shopSettings({ deliveryRadiusKm: 200 }));

    await expect(isServiceable({ pincode: '570001', ...FAR })).resolves.toMatchObject({
      serviceable: true,
      reason: 'WITHIN_RADIUS',
    });
  });

  it('ignores a coordinate that is not a real one', async () => {
    const result = await isServiceable({ pincode: '560038', lat: 999, lng: 77 });

    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe('LOCATION_NEEDED');
  });
});

describe('isServiceable — before the shop location is set', () => {
  it('falls back to the pincode list rather than refusing the whole town', async () => {
    // Shipping radius delivery must not make every customer unserviceable the
    // moment it deploys. Until the owner sets a location, nothing changes.
    vi.mocked(getShopSettings).mockResolvedValue(shopSettings({ shopLat: null, shopLng: null }));
    vi.mocked(db.servicePincode.findFirst).mockResolvedValue({ area: 'Indiranagar' } as never);

    await expect(isServiceable({ pincode: '560038', ...NEARBY })).resolves.toMatchObject({
      serviceable: true,
      reason: 'PINCODE_LISTED',
    });
  });

  it('does not ask for a location it cannot use', async () => {
    vi.mocked(getShopSettings).mockResolvedValue(shopSettings({ shopLat: null, shopLng: null }));

    await expect(isServiceable({ pincode: '999999' })).resolves.toMatchObject({
      serviceable: false,
      reason: 'NOT_SERVICEABLE',
    });
  });
});
