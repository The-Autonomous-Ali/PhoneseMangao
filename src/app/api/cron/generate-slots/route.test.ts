import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cron', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cron')>('@/lib/cron');
  return { ...actual, withAdvisoryLock: vi.fn() };
});

vi.mock('@/lib/settings', () => ({ getShopSettings: vi.fn() }));

import { withAdvisoryLock, CRON_SECRET_HEADER } from '@/lib/cron';
import { resetEnvCache } from '@/lib/env';
import { getShopSettings } from '@/lib/settings';
import { POST as generateSlots } from './route';

/** The route reads only slotCapacity; the rest is here to satisfy the type. */
function settings(slotCapacity: number) {
  return {
    deliveryFee: '30.00',
    minOrderValue: '199.00',
    freeDeliveryAbove: '500.00',
    shopOpen: true,
    paymentsEnabled: false,
    whatsappNumber: '',
    slotCapacity,
    shopLat: null,
    shopLng: null,
    deliveryRadiusKm: 5,
  };
}

const ORIGINAL = { ...process.env };
const SECRET = 'cron-secret-at-least-16';

type CreateManyArgs = { data: { date: Date; slotType: string; cutoffAt: Date }[] };

/** Captures the rows the handler would have written. */
function captureCreateMany() {
  const createMany = vi.fn().mockResolvedValue({ count: 21 });
  vi.mocked(withAdvisoryLock).mockImplementation((async (
    _name: string,
    job: (tx: unknown) => Promise<number>
  ) => ({ skipped: false, result: await job({ deliverySlot: { createMany } }) })) as never);
  return createMany;
}

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cron/generate-slots', { method: 'POST', headers });
}

const authorized = () => buildRequest({ [CRON_SECRET_HEADER]: SECRET });

beforeEach(() => {
  process.env = {
    ...ORIGINAL,
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    CRON_SECRET: SECRET,
  } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.mocked(withAdvisoryLock).mockReset();
  vi.mocked(getShopSettings).mockReset().mockResolvedValue(settings(20));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('POST /api/cron/generate-slots', () => {
  it('rejects a request without the cron secret', async () => {
    const response = await generateSlots(buildRequest());
    expect(response.status).toBe(401);
    expect(withAdvisoryLock).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong cron secret', async () => {
    const response = await generateSlots(buildRequest({ [CRON_SECRET_HEADER]: 'wrong' }));
    expect(response.status).toBe(401);
  });

  it('creates a week of slots across all three slot types', async () => {
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    const { data } = createMany.mock.calls[0][0] as CreateManyArgs;
    expect(data).toHaveLength(21);
    expect(new Set(data.map((row) => row.slotType))).toEqual(
      new Set(['MORNING', 'AFTERNOON', 'EVENING'])
    );
    expect(new Set(data.map((row) => row.date.toISOString())).size).toBe(7);
  });

  it('skips duplicates, so a re-run or a double-fire adds nothing', async () => {
    // The crontab has no memory of whether the last run succeeded, so running
    // twice has to be safe.
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    expect(createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
  });

  it('generates at the configured capacity rather than a hardcoded one', async () => {
    vi.mocked(getShopSettings).mockResolvedValue(settings(35));
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    const { data } = createMany.mock.calls[0][0] as { data: { capacity: number }[] };
    expect(data.every((row) => row.capacity === 35)).toBe(true);
  });

  it('still generates when the capacity is zero, leaving the slots unbookable', async () => {
    // Zero is a real configuration. Skipping generation would leave the week
    // empty and the owner with no row to raise the capacity back on.
    vi.mocked(getShopSettings).mockResolvedValue(settings(0));
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    const { data } = createMany.mock.calls[0][0] as { data: { capacity: number }[] };
    expect(data).toHaveLength(21);
    expect(data.every((row) => row.capacity === 0)).toBe(true);
  });

  it('files each slot against a calendar day, not an instant', async () => {
    // A Postgres `date` column means a day on a calendar. Storing the IST
    // midnight instant — 18:30 UTC the evening before — makes Postgres truncate
    // to the previous day, filing every delivery against the wrong date.
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    const { data } = createMany.mock.calls[0][0] as CreateManyArgs;
    for (const row of data) {
      expect(row.date.getUTCHours()).toBe(0);
      expect(row.date.getUTCMinutes()).toBe(0);
    }
  });

  it('starts from today in India, not from the server’s timezone', async () => {
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    const { data } = createMany.mock.calls[0][0] as CreateManyArgs;
    const istToday = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
    const expected = Date.UTC(
      istToday.getUTCFullYear(),
      istToday.getUTCMonth(),
      istToday.getUTCDate()
    );
    const earliest = Math.min(...data.map((row) => row.date.getTime()));
    expect(earliest).toBe(expected);
  });

  it('closes the morning slot the evening before, since it is packed overnight', async () => {
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    const { data } = createMany.mock.calls[0][0] as CreateManyArgs;
    const morning = data.find((row) => row.slotType === 'MORNING')!;
    expect(morning.cutoffAt.getTime()).toBeLessThan(morning.date.getTime());
  });

  it('closes the afternoon and evening slots on the delivery day itself', async () => {
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    const { data } = createMany.mock.calls[0][0] as CreateManyArgs;
    for (const slotType of ['AFTERNOON', 'EVENING']) {
      const slot = data.find((row) => row.slotType === slotType)!;
      expect(slot.cutoffAt.getTime()).toBeGreaterThan(slot.date.getTime());
    }
  });

  it('reports a skip when another run already holds the lock', async () => {
    vi.mocked(withAdvisoryLock).mockResolvedValue({ skipped: true });

    const response = await generateSlots(authorized());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ skipped: true });
  });
});
