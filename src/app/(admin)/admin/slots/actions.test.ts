import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { deliverySlot: { update: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { db } from '@/lib/db';
import { requireAdmin, NotAdminError } from '@/lib/admin-auth';
import { setSlotCapacity, setSlotOpen, setDateOpen } from './actions';

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ userId: 'admin_1', role: 'ADMIN' });
  vi.mocked(db.deliverySlot.update).mockReset().mockResolvedValue({} as never);
  vi.mocked(db.deliverySlot.updateMany).mockReset().mockResolvedValue({ count: 3 } as never);
});

describe('setSlotCapacity', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    const result = await setSlotCapacity('s_1', '30');

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(db.deliverySlot.update).not.toHaveBeenCalled();
  });

  it('sets the capacity', async () => {
    const result = await setSlotCapacity('s_1', '30');

    expect(result.ok).toBe(true);
    expect(db.deliverySlot.update).toHaveBeenCalledWith({
      where: { id: 's_1' },
      data: { capacity: 30 },
    });
  });

  it('allows a capacity below what is already booked', async () => {
    // bookSlot guards on booked < capacity inside the write, so the orders
    // already taken stand and only new ones are refused. Nothing to do here.
    const result = await setSlotCapacity('s_1', '1');

    expect(result.ok).toBe(true);
    expect(db.deliverySlot.update).toHaveBeenCalledWith({
      where: { id: 's_1' },
      data: { capacity: 1 },
    });
  });

  it.each([['-1'], ['2.5'], ['501'], ['many']])('rejects a capacity of %s', async (value) => {
    const result = await setSlotCapacity('s_1', value);

    expect(result.ok).toBe(false);
    expect(db.deliverySlot.update).not.toHaveBeenCalled();
  });
});

describe('setSlotOpen', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    expect(await setSlotOpen('s_1', false)).toEqual({ ok: false, error: 'Admin access required' });
  });

  it('closes one slot without touching the orders in it', async () => {
    const result = await setSlotOpen('s_1', false);

    expect(result.ok).toBe(true);
    expect(db.deliverySlot.update).toHaveBeenCalledWith({
      where: { id: 's_1' },
      data: { isOpen: false },
    });
  });

  it('reopens a slot', async () => {
    await setSlotOpen('s_1', true);

    expect(db.deliverySlot.update).toHaveBeenCalledWith({
      where: { id: 's_1' },
      data: { isOpen: true },
    });
  });
});

describe('setDateOpen', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    expect(await setDateOpen('2026-08-11', false)).toEqual({
      ok: false,
      error: 'Admin access required',
    });
    expect(db.deliverySlot.updateMany).not.toHaveBeenCalled();
  });

  it('writes every slot on the date in one statement', async () => {
    const result = await setDateOpen('2026-08-11', false);

    expect(result.ok).toBe(true);
    expect(db.deliverySlot.updateMany).toHaveBeenCalledWith({
      where: { date: new Date('2026-08-11T00:00:00.000Z') },
      data: { isOpen: false },
    });
  });

  it('reopens a date as well as blocking one', async () => {
    // A festival gets cancelled, and a date blocked by mistake has to be
    // recoverable without reopening three slots one at a time.
    await setDateOpen('2026-08-11', true);

    expect(db.deliverySlot.updateMany).toHaveBeenCalledWith({
      where: { date: new Date('2026-08-11T00:00:00.000Z') },
      data: { isOpen: true },
    });
  });

  it('rejects a date that is not a calendar date', async () => {
    const result = await setDateOpen('tuesday', false);

    expect(result.ok).toBe(false);
    expect(db.deliverySlot.updateMany).not.toHaveBeenCalled();
  });
});
