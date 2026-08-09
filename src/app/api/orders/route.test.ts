import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const tx = {
  order: { create: vi.fn() },
  otpRequest: { create: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn() },
    address: { findFirst: vi.fn() },
    order: { findMany: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, getSession: vi.fn() };
});

vi.mock('@/lib/cart-pricing', () => ({ priceCart: vi.fn() }));
vi.mock('@/lib/settings', () => ({ getShopSettings: vi.fn() }));
vi.mock('@/lib/slots', async () => {
  const actual = await vi.importActual<typeof import('@/lib/slots')>('@/lib/slots');
  return { ...actual, bookSlot: vi.fn() };
});
vi.mock('@/lib/serviceability', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/serviceability')>('@/lib/serviceability');
  return { ...actual, isServiceable: vi.fn() };
});
vi.mock('@/lib/otp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/otp')>('@/lib/otp');
  return { ...actual, sendOtp: vi.fn(async () => {}) };
});

import { UnitType } from '@prisma/client';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { priceCart } from '@/lib/cart-pricing';
import { getShopSettings } from '@/lib/settings';
import { bookSlot, SlotFullError } from '@/lib/slots';
import { isServiceable } from '@/lib/serviceability';
import { sendOtp } from '@/lib/otp';
import { POST as placeOrder } from './route';

const SETTINGS = {
  deliveryFee: '30.00',
  minOrderValue: '199.00',
  freeDeliveryAbove: '500.00',
  shopOpen: true,
  whatsappNumber: '',
};

const VERIFIED_USER = {
  id: 'user_1',
  phone: '+919876543210',
  name: 'A Customer',
  phoneVerifiedAt: new Date('2026-08-01'),
};

const ADDRESS = {
  id: 'addr_1',
  userId: 'user_1',
  label: 'Home',
  line1: '12 Rose Villa',
  line2: null,
  landmark: 'Opposite the temple',
  city: 'Mumbai',
  pincode: '400069',
};

function pricedCart(itemsTotal = '250.00') {
  return {
    items: [
      {
        variantId: 'v1',
        productSlug: 'tomatoes',
        productName: 'Tomatoes',
        variantLabel: '1 kg',
        unitType: UnitType.KG,
        imageUrl: null,
        unitPrice: '45.00',
        quantity: 2,
        lineTotal: '90.00',
      },
    ],
    issues: [],
    itemsTotal,
  };
}

const VALID_BODY = {
  items: [{ variantId: 'v1', quantity: 2 }],
  addressId: 'addr_1',
  slotId: 'slot_1',
  paymentMethod: 'COD',
};

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ userId: 'user_1', role: 'CUSTOMER' });
  vi.mocked(db.user.findUnique).mockReset().mockResolvedValue(VERIFIED_USER as never);
  vi.mocked(db.address.findFirst).mockReset().mockResolvedValue(ADDRESS as never);
  vi.mocked(getShopSettings).mockReset().mockResolvedValue(SETTINGS);
  vi.mocked(priceCart).mockReset().mockResolvedValue(pricedCart());
  vi.mocked(isServiceable).mockReset().mockResolvedValue({ serviceable: true });
  vi.mocked(bookSlot).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendOtp).mockReset().mockResolvedValue(undefined);
  vi.mocked(db.$transaction).mockClear();
  tx.order.create.mockReset().mockResolvedValue({
    id: 'order_1',
    orderNumber: 'PM260809-ABCD',
    status: 'PENDING_OTP',
  });
  tx.otpRequest.create.mockReset().mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/orders — refusals before any slot is claimed', () => {
  it('requires a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await placeOrder(buildRequest(VALID_BODY))).status).toBe(401);
  });

  it('requires a confirmed phone number', async () => {
    // A delivery needs a number the driver can call, and one the customer
    // proved they hold.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      ...VERIFIED_USER,
      phoneVerifiedAt: null,
    } as never);

    const response = await placeOrder(buildRequest(VALID_BODY));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'PHONE_UNVERIFIED' });
  });

  it('refuses when the shop is closed', async () => {
    vi.mocked(getShopSettings).mockResolvedValue({ ...SETTINGS, shopOpen: false });

    const response = await placeOrder(buildRequest(VALID_BODY));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'SHOP_CLOSED' });
  });

  it('refuses an address belonging to somebody else', async () => {
    vi.mocked(db.address.findFirst).mockResolvedValue(null as never);

    expect((await placeOrder(buildRequest(VALID_BODY))).status).toBe(404);
  });

  it('scopes the address lookup to the caller', async () => {
    await placeOrder(buildRequest(VALID_BODY));

    expect(db.address.findFirst).toHaveBeenCalledWith({
      where: { id: 'addr_1', userId: 'user_1' },
    });
  });

  it('re-checks serviceability at order time, not just when the address was saved', async () => {
    // The shop can drop a pincode from its delivery area in between.
    vi.mocked(isServiceable).mockResolvedValue({ serviceable: false });

    const response = await placeOrder(buildRequest(VALID_BODY));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_SERVICEABLE' });
  });

  it('refuses when the basket changed, rather than placing a different order', async () => {
    vi.mocked(priceCart).mockResolvedValue({
      ...pricedCart(),
      issues: [{ variantId: 'v1', reason: 'UNAVAILABLE' as const, message: 'sold out' }],
    });

    const response = await placeOrder(buildRequest(VALID_BODY));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CART_CHANGED' });
  });

  it('enforces the minimum order on the server, not just on the button', async () => {
    vi.mocked(priceCart).mockResolvedValue(pricedCart('150.00'));

    const response = await placeOrder(buildRequest(VALID_BODY));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'BELOW_MINIMUM' });
  });

  it('rejects an online payment method until Razorpay exists', async () => {
    // Accepting it now would create orders nobody can pay for, which the
    // expire-unpaid sweep would then cancel.
    const response = await placeOrder(
      buildRequest({ ...VALID_BODY, paymentMethod: 'ONLINE' })
    );

    expect(response.status).toBe(400);
  });

  it.each([
    ['no session', () => vi.mocked(getSession).mockResolvedValue(null)],
    ['unverified phone', () =>
      vi.mocked(db.user.findUnique).mockResolvedValue({ ...VERIFIED_USER, phoneVerifiedAt: null } as never)],
    ['below minimum', () => vi.mocked(priceCart).mockResolvedValue(pricedCart('10.00'))],
  ])('claims no delivery slot when rejecting for %s', async (_case, arrange) => {
    // A failed checkout must never hold a place in the van.
    arrange();

    await placeOrder(buildRequest(VALID_BODY));

    expect(bookSlot).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders — placing the order', () => {
  it('creates the order and returns its reference', async () => {
    const response = await placeOrder(buildRequest(VALID_BODY));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      orderId: 'order_1',
      orderNumber: 'PM260809-ABCD',
      grandTotal: '280.00',
    });
  });

  it('claims the slot inside the same transaction as the order', async () => {
    // If writing the order fails, the increment has to roll back with it.
    await placeOrder(buildRequest(VALID_BODY));

    expect(bookSlot).toHaveBeenCalledWith('slot_1', tx);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('reports a slot that filled between rendering and ordering', async () => {
    vi.mocked(bookSlot).mockRejectedValue(new SlotFullError('slot_1'));

    const response = await placeOrder(buildRequest(VALID_BODY));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'SLOT_FULL' });
  });

  it('computes totals from the database, ignoring anything the client sends', async () => {
    await placeOrder(
      buildRequest({ ...VALID_BODY, grandTotal: '1.00', deliveryFee: '0.00' })
    );

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          itemsTotal: '250.00',
          deliveryFee: '30.00',
          grandTotal: '280.00',
        }),
      })
    );
  });

  it('waives delivery on a basket over the threshold', async () => {
    vi.mocked(priceCart).mockResolvedValue(pricedCart('600.00'));

    await placeOrder(buildRequest(VALID_BODY));

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryFee: '0.00', grandTotal: '600.00' }),
      })
    );
  });

  it('snapshots the address rather than referencing it', async () => {
    // The customer may edit or delete the address later; the driver still has
    // to find the door.
    await placeOrder(buildRequest(VALID_BODY));

    const { data } = tx.order.create.mock.calls[0][0];
    expect(data.deliveryAddress).toMatchObject({
      line1: '12 Rose Villa',
      landmark: 'Opposite the temple',
      pincode: '400069',
      phone: '+919876543210',
    });
  });

  it('denormalises product names onto the order lines', async () => {
    await placeOrder(buildRequest(VALID_BODY));

    const { data } = tx.order.create.mock.calls[0][0];
    expect(data.items.create[0]).toMatchObject({
      productName: 'Tomatoes',
      variantLabel: '1 kg',
      unitPrice: '45.00',
      quantity: 2,
    });
  });

  it('opens a COD order awaiting confirmation and records an event', async () => {
    await placeOrder(buildRequest(VALID_BODY));

    const { data } = tx.order.create.mock.calls[0][0];
    expect(data.status).toBe('PENDING_OTP');
    expect(data.paymentStatus).toBe('UNPAID');
    expect(data.events.create).toMatchObject({ status: 'PENDING_OTP' });
  });

  it('stores the confirmation code hashed, scoped to COD_CONFIRM', async () => {
    await placeOrder(buildRequest(VALID_BODY));

    const { data } = tx.otpRequest.create.mock.calls[0][0];
    expect(data.purpose).toBe('COD_CONFIRM');
    expect(data.codeHash).not.toMatch(/^\d{6}$/);
  });

  it('sends the code after the transaction commits', async () => {
    await placeOrder(buildRequest(VALID_BODY));
    expect(sendOtp).toHaveBeenCalledWith('+919876543210', expect.stringMatching(/^\d{6}$/));
  });

  it('still returns the order when the code could not be sent', async () => {
    // The order exists and the code is stored; resending is recoverable, and
    // failing here would strand a placed order behind an error page.
    vi.mocked(sendOtp).mockRejectedValue(new Error('WhatsApp down'));

    const response = await placeOrder(buildRequest(VALID_BODY));

    expect(response.status).toBe(201);
  });
});
