import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { servicePincode: { create: vi.fn(), update: vi.fn() } },
}));

vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin, NotAdminError } from '@/lib/admin-auth';
import { addPincode, setPincodeActive } from './actions';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ userId: 'admin_1', role: 'ADMIN' });
  vi.mocked(db.servicePincode.create).mockReset().mockResolvedValue({} as never);
  vi.mocked(db.servicePincode.update).mockReset().mockResolvedValue({} as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('addPincode', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    const result = await addPincode(null, form({ pincode: '560001' }));

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(db.servicePincode.create).not.toHaveBeenCalled();
  });

  it('adds a serviceable pincode with its area', async () => {
    const result = await addPincode(null, form({ pincode: '560001', area: 'Indiranagar' }));

    expect(result.ok).toBe(true);
    expect(db.servicePincode.create).toHaveBeenCalledWith({
      data: { pincode: '560001', area: 'Indiranagar' },
    });
  });

  it('accepts a pincode with no area', async () => {
    await addPincode(null, form({ pincode: '560001', area: '' }));

    expect(db.servicePincode.create).toHaveBeenCalledWith({
      data: { pincode: '560001', area: undefined },
    });
  });

  it('rejects a malformed pincode', async () => {
    const result = await addPincode(null, form({ pincode: '56001' }));

    expect(result.ok).toBe(false);
    expect(db.servicePincode.create).not.toHaveBeenCalled();
  });

  it('reports a pincode that is already listed', async () => {
    vi.mocked(db.servicePincode.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['pincode'] },
      })
    );

    const result = await addPincode(null, form({ pincode: '560001' }));

    expect(result.ok).toBe(false);
  });
});

describe('setPincodeActive', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    expect(await setPincodeActive('p_1', false)).toEqual({
      ok: false,
      error: 'Admin access required',
    });
  });

  it('deactivates rather than deleting, so the record survives', async () => {
    // isServiceable already filters on isActive, and a hard delete would strand
    // every saved address in that pincode with nothing explaining when the shop
    // stopped serving it.
    const result = await setPincodeActive('p_1', false);

    expect(result.ok).toBe(true);
    expect(db.servicePincode.update).toHaveBeenCalledWith({
      where: { id: 'p_1' },
      data: { isActive: false },
    });
  });

  it('restores a pincode', async () => {
    await setPincodeActive('p_1', true);

    expect(db.servicePincode.update).toHaveBeenCalledWith({
      where: { id: 'p_1' },
      data: { isActive: true },
    });
  });
});
