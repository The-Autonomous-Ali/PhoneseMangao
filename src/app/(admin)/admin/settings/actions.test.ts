import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/settings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/settings')>('@/lib/settings');
  return { ...actual, writeSettings: vi.fn() };
});

vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock('@/lib/env', () => ({ getEnv: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { writeSettings } from '@/lib/settings';
import { requireAdmin, NotAdminError } from '@/lib/admin-auth';
import { getEnv } from '@/lib/env';
import { updateSettings, setShopOpen, setPaymentsEnabled } from './actions';

const WITH_KEYS = { RAZORPAY_KEY_ID: 'rzp_test_abc' } as ReturnType<typeof getEnv>;
const WITHOUT_KEYS = {} as ReturnType<typeof getEnv>;

function settingsForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields = {
    deliveryFee: '30',
    minOrderValue: '199',
    freeDeliveryAbove: '500',
    whatsappNumber: '+919876543210',
    slotCapacity: '20',
    shopLat: '12.9784',
    shopLng: '77.6408',
    deliveryRadiusKm: '5',
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ userId: 'admin_1', role: 'ADMIN' });
  vi.mocked(writeSettings).mockReset().mockResolvedValue(undefined);
  vi.mocked(getEnv).mockReset().mockReturnValue(WITH_KEYS);
});

describe('updateSettings', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    const result = await updateSettings(null, settingsForm());

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(writeSettings).not.toHaveBeenCalled();
  });

  it('writes every field under its settings key', async () => {
    const result = await updateSettings(null, settingsForm());

    expect(result.ok).toBe(true);
    expect(writeSettings).toHaveBeenCalledWith({
      delivery_fee: '30',
      min_order_value: '199',
      free_delivery_above: '500',
      whatsapp_number: '+919876543210',
      slot_capacity: 20,
      shop_lat: '12.9784',
      shop_lng: '77.6408',
      delivery_radius_km: '5',
    });
  });

  it('saves an empty shop location rather than refusing the whole form', async () => {
    // The owner may not know his coordinates yet, and that must not stop him
    // changing the delivery fee.
    const result = await updateSettings(null, settingsForm({ shopLat: '', shopLng: '' }));

    expect(result.ok).toBe(true);
    expect(writeSettings).toHaveBeenCalledWith(
      expect.objectContaining({ shop_lat: '', shop_lng: '' })
    );
  });

  it('rejects a latitude that is not on the earth', async () => {
    const result = await updateSettings(null, settingsForm({ shopLat: '91' }));

    expect(result.ok).toBe(false);
    expect(writeSettings).not.toHaveBeenCalled();
  });

  it('accepts zero amounts', async () => {
    await updateSettings(null, settingsForm({ deliveryFee: '0', freeDeliveryAbove: '0' }));

    expect(writeSettings).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_fee: '0', free_delivery_above: '0' })
    );
  });

  it('rejects a malformed amount without writing anything', async () => {
    const result = await updateSettings(null, settingsForm({ deliveryFee: 'free' }));

    expect(result.ok).toBe(false);
    expect(writeSettings).not.toHaveBeenCalled();
  });
});

describe('setShopOpen', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    expect(await setShopOpen(false)).toEqual({ ok: false, error: 'Admin access required' });
  });

  it('closes the shop', async () => {
    const result = await setShopOpen(false);

    expect(result.ok).toBe(true);
    expect(writeSettings).toHaveBeenCalledWith({ shop_open: false });
  });
});

describe('setPaymentsEnabled', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    expect(await setPaymentsEnabled(true)).toEqual({ ok: false, error: 'Admin access required' });
  });

  it('refuses to switch payments on when Razorpay is not configured', async () => {
    // SETTING_DEFAULTS keeps this off so a shop whose KYC has not cleared does
    // not offer a payment method that fails at the last step of checkout. The
    // settings screen must not be a way back into that.
    vi.mocked(getEnv).mockReturnValue(WITHOUT_KEYS);

    const result = await setPaymentsEnabled(true);

    expect(result.ok).toBe(false);
    expect(writeSettings).not.toHaveBeenCalled();
  });

  it('switches payments on when keys are present', async () => {
    const result = await setPaymentsEnabled(true);

    expect(result.ok).toBe(true);
    expect(writeSettings).toHaveBeenCalledWith({ payments_enabled: true });
  });

  it('always allows switching payments off, configured or not', async () => {
    // Turning something off is never the unsafe direction.
    vi.mocked(getEnv).mockReturnValue(WITHOUT_KEYS);

    const result = await setPaymentsEnabled(false);

    expect(result.ok).toBe(true);
    expect(writeSettings).toHaveBeenCalledWith({ payments_enabled: false });
  });
});
