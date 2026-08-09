import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const tx = {
  address: { updateMany: vi.fn() },
  order: { updateMany: vi.fn() },
  user: { delete: vi.fn(), update: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    // Mirrors Prisma's interactive transaction: hand the callback a client and
    // return whatever it resolves to.
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

vi.mock('@/lib/otp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/otp')>('@/lib/otp');
  return { ...actual, consumeOtp: vi.fn() };
});

const cookieStore = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, getSession: vi.fn() };
});

import { db } from '@/lib/db';
import { consumeOtp } from '@/lib/otp';
import { getSession } from '@/lib/auth';
import { POST as verifyPhone } from './route';

const PHONE = '+919876543210';

/** Google-created row: signed in, no phone yet. Created today. */
const GOOGLE_USER = {
  id: 'user_google',
  phone: null,
  email: 'customer@example.com',
  googleId: '108123',
  name: 'A Customer',
  imageUrl: null,
  phoneVerifiedAt: null,
  role: 'CUSTOMER',
  createdAt: new Date('2026-08-09'),
};

/** Legacy phone-only row for the same person, with the order history. */
const PHONE_USER = {
  id: 'user_phone',
  phone: PHONE,
  email: null,
  googleId: null,
  name: null,
  imageUrl: null,
  phoneVerifiedAt: new Date('2026-01-01'),
  role: 'CUSTOMER',
  createdAt: new Date('2026-01-01'),
};

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/phone/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** `current` is the session's row; `existing` is whoever holds the phone. */
function mockLookups(current: unknown, existing: unknown) {
  vi.mocked(db.user.findUnique).mockImplementation((async (args: {
    where: { id?: string; phone?: string };
  }) => (args.where.id !== undefined ? current : existing)) as never);
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long';
  vi.mocked(getSession).mockResolvedValue({ userId: GOOGLE_USER.id, role: 'CUSTOMER' });
  vi.mocked(consumeOtp).mockResolvedValue({ ok: true });
  vi.mocked(db.user.findUnique).mockReset();
  vi.mocked(db.user.update).mockReset();
  vi.mocked(db.$transaction).mockClear();
  tx.address.updateMany.mockReset();
  tx.order.updateMany.mockReset();
  tx.user.delete.mockReset();
  tx.user.update.mockReset();
  cookieStore.set.mockReset();
});

describe('POST /api/auth/phone/verify — guards', () => {
  it('requires a session, because there is no account to attach a number to', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const response = await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));
    expect(response.status).toBe(401);
    expect(consumeOtp).not.toHaveBeenCalled();
  });

  it('rejects a malformed phone number before touching the database', async () => {
    const response = await verifyPhone(buildRequest({ phone: '98765', code: '123456' }));
    expect(response.status).toBe(400);
    expect(consumeOtp).not.toHaveBeenCalled();
  });

  it('scopes the code to the PHONE_VERIFY purpose, so a login code cannot be spent here', async () => {
    mockLookups(GOOGLE_USER, null);
    vi.mocked(db.user.update).mockResolvedValue({ ...GOOGLE_USER, phone: PHONE } as never);

    await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(consumeOtp).toHaveBeenCalledWith(PHONE, '123456', 'PHONE_VERIFY');
  });

  it('rejects an incorrect code', async () => {
    vi.mocked(consumeOtp).mockResolvedValue({ ok: false, reason: 'INCORRECT' });
    const response = await verifyPhone(buildRequest({ phone: PHONE, code: '000000' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Incorrect code' });
  });

  it('rejects an expired code', async () => {
    vi.mocked(consumeOtp).mockResolvedValue({ ok: false, reason: 'NOT_FOUND' });
    const response = await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/expired/) });
  });
});

describe('POST /api/auth/phone/verify — no conflict', () => {
  it('stamps the number and verification time on the signed-in row', async () => {
    mockLookups(GOOGLE_USER, null);
    vi.mocked(db.user.update).mockResolvedValue({ ...GOOGLE_USER, phone: PHONE } as never);

    const response = await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(response.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: GOOGLE_USER.id },
      data: { phone: PHONE, phoneVerifiedAt: expect.any(Date) },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('re-verifying a number already on the same row does not merge', async () => {
    mockLookups(GOOGLE_USER, GOOGLE_USER);
    vi.mocked(db.user.update).mockResolvedValue(GOOGLE_USER as never);

    await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/phone/verify — merging a duplicate account', () => {
  it('moves addresses and orders onto the older row before deleting the newer one', async () => {
    mockLookups(GOOGLE_USER, PHONE_USER);
    tx.user.update.mockResolvedValue({ ...PHONE_USER, email: GOOGLE_USER.email });

    await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(tx.address.updateMany).toHaveBeenCalledWith({
      where: { userId: GOOGLE_USER.id },
      data: { userId: PHONE_USER.id },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { userId: GOOGLE_USER.id },
      data: { userId: PHONE_USER.id },
    });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: GOOGLE_USER.id } });
  });

  it('carries the Google identity onto the surviving row', async () => {
    mockLookups(GOOGLE_USER, PHONE_USER);
    tx.user.update.mockResolvedValue({ ...PHONE_USER, email: GOOGLE_USER.email });

    await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: PHONE_USER.id },
      data: expect.objectContaining({
        email: GOOGLE_USER.email,
        googleId: GOOGLE_USER.googleId,
        name: GOOGLE_USER.name,
        phone: PHONE,
      }),
    });
  });

  it('keeps the older row even when the phone row is the newer of the two', async () => {
    // Same person, opposite order: they used Google first, then had an older
    // account only in the sense of createdAt. The rule is the row with history.
    const olderGoogle = { ...GOOGLE_USER, createdAt: new Date('2025-01-01') };
    mockLookups(olderGoogle, PHONE_USER);
    tx.user.update.mockResolvedValue(olderGoogle);

    await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: PHONE_USER.id } });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: olderGoogle.id } })
    );
  });

  it('preserves ADMIN when the dropped row held it', async () => {
    mockLookups({ ...GOOGLE_USER, role: 'ADMIN' }, PHONE_USER);
    tx.user.update.mockResolvedValue({ ...PHONE_USER, role: 'ADMIN' });

    await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN' }) })
    );
  });

  it('re-issues the session, since the surviving row is a different id', async () => {
    mockLookups(GOOGLE_USER, PHONE_USER);
    tx.user.update.mockResolvedValue(PHONE_USER);

    const response = await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    expect(cookieStore.set.mock.calls[0][0]).toBe('session');
    await expect(response.json()).resolves.toMatchObject({ merged: true });
  });

  it('refuses to merge two accounts that each signed in with Google', async () => {
    // Two real people as far as this app can tell. Folding them would hand one
    // of them the other's order history.
    const otherGoogleAccount = { ...PHONE_USER, googleId: '999', email: 'someone@else.com' };
    mockLookups(GOOGLE_USER, otherGoogleAccount);

    const response = await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(response.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('treats a session pointing at a deleted row as signed out', async () => {
    mockLookups(null, PHONE_USER);

    const response = await verifyPhone(buildRequest({ phone: PHONE, code: '123456' }));

    expect(response.status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
