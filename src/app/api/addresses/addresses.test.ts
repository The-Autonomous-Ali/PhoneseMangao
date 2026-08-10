import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const tx = {
  address: { count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  db: {
    address: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, getSession: vi.fn() };
});

vi.mock('@/lib/serviceability', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/serviceability')>('@/lib/serviceability');
  return { ...actual, isServiceable: vi.fn() };
});

import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isServiceable } from '@/lib/serviceability';
import { GET as listAddresses, POST as createAddress } from './route';
import { PUT as updateAddress, DELETE as deleteAddress } from './[id]/route';

const VALID = {
  line1: '12 Rose Villa, MG Road',
  city: 'Mumbai',
  pincode: '400069',
  landmark: 'Opposite the temple',
};

function buildRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/addresses', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ userId: 'user_1', role: 'CUSTOMER' });
  vi.mocked(isServiceable).mockResolvedValue({ serviceable: true, reason: 'PINCODE_LISTED' });
  vi.mocked(db.address.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(db.address.findFirst).mockReset().mockResolvedValue(null as never);
  vi.mocked(db.$transaction).mockClear();
  tx.address.count.mockReset().mockResolvedValue(1);
  tx.address.create.mockReset().mockResolvedValue({ id: 'addr_1' });
  tx.address.update.mockReset().mockResolvedValue({ id: 'addr_1' });
  tx.address.updateMany.mockReset().mockResolvedValue({ count: 0 });
  tx.address.delete.mockReset().mockResolvedValue({});
  tx.address.findFirst.mockReset().mockResolvedValue(null);
});

describe('addresses — authentication', () => {
  it.each([
    ['GET', () => listAddresses()],
    ['POST', () => createAddress(buildRequest(VALID))],
    ['PUT', () => updateAddress(buildRequest(VALID), params('addr_1'))],
    ['DELETE', () => deleteAddress(buildRequest(), params('addr_1'))],
  ])('%s requires a session', async (_method, run) => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await run()).status).toBe(401);
  });

  it('lists only the caller’s own addresses', async () => {
    await listAddresses();

    expect(db.address.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_1' } })
    );
  });
});

describe('addresses — ownership', () => {
  it('scopes the lookup by user rather than checking after the fetch', async () => {
    // A findUnique followed by an `if` is one early return away from leaking
    // somebody's home address, so ownership is part of the query.
    await updateAddress(buildRequest(VALID), params('addr_other'));

    expect(db.address.findFirst).toHaveBeenCalledWith({
      where: { id: 'addr_other', userId: 'user_1' },
    });
  });

  it('returns 404, not 403, for an address belonging to somebody else', async () => {
    // Confirming that an id exists but is not yours is itself information.
    const response = await updateAddress(buildRequest(VALID), params('addr_other'));
    expect(response.status).toBe(404);
  });

  it('refuses to delete an address the caller does not own', async () => {
    const response = await deleteAddress(buildRequest(), params('addr_other'));

    expect(response.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('addresses — creation', () => {
  it('creates a valid address', async () => {
    const response = await createAddress(buildRequest(VALID));

    expect(response.status).toBe(201);
    expect(tx.address.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user_1', pincode: '400069' }),
    });
  });

  it('rejects an address outside the delivery area', async () => {
    // Caught at save time as well as at checkout, so nobody types an address
    // that is only rejected at the last step.
    vi.mocked(isServiceable).mockResolvedValue({ serviceable: false, reason: 'NOT_SERVICEABLE' });

    const response = await createAddress(buildRequest({ ...VALID, pincode: '999999' }));

    expect(response.status).toBe(400);
    expect(tx.address.create).not.toHaveBeenCalled();
  });

  it('rejects a missing street line with a field error', async () => {
    const response = await createAddress(buildRequest({ ...VALID, line1: '' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      fieldErrors: { line1: expect.any(Array) },
    });
  });

  it('makes the first address default even when the box is unticked', async () => {
    // Otherwise checkout has nothing preselected and every order begins with
    // an unnecessary choice.
    tx.address.count.mockResolvedValue(0);

    await createAddress(buildRequest({ ...VALID, isDefault: false }));

    expect(tx.address.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isDefault: true }),
    });
  });

  it('clears the previous default when a new one is chosen', async () => {
    await createAddress(buildRequest({ ...VALID, isDefault: true }));

    expect(tx.address.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: { isDefault: false },
    });
  });

  it('keeps the landmark, which is what the driver actually navigates by', async () => {
    await createAddress(buildRequest(VALID));

    expect(tx.address.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ landmark: 'Opposite the temple' }),
    });
  });
});

describe('addresses — deletion', () => {
  it('promotes another address when the default is deleted', async () => {
    vi.mocked(db.address.findFirst).mockResolvedValue({ id: 'addr_1', isDefault: true } as never);
    tx.address.findFirst.mockResolvedValue({ id: 'addr_2' });

    await deleteAddress(buildRequest(), params('addr_1'));

    expect(tx.address.delete).toHaveBeenCalledWith({ where: { id: 'addr_1' } });
    expect(tx.address.update).toHaveBeenCalledWith({
      where: { id: 'addr_2' },
      data: { isDefault: true },
    });
  });

  it('does not promote anything when a non-default is deleted', async () => {
    vi.mocked(db.address.findFirst).mockResolvedValue({ id: 'addr_2', isDefault: false } as never);

    await deleteAddress(buildRequest(), params('addr_2'));

    expect(tx.address.update).not.toHaveBeenCalled();
  });
});
