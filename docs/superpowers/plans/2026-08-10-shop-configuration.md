# Shop Configuration (Phase 6B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shop owner three screens — slots, pincodes, settings — so the shop can be configured without a database edit or a redeploy.

**Architecture:** One validation module and one read module under `src/lib/`, plus a Server Actions file per screen, following the pattern established by the catalog screens and 6A. `settings.ts` gains a writer alongside its existing tolerant reader. `generate-slots` stops hardcoding capacity and reads it from settings.

**Tech Stack:** Next.js 15.5 (App Router, Server Actions), React 19, Prisma 6.19 + PostgreSQL, Zod 4, Vitest 4, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-10-shop-configuration-design.md`

## Global Constraints

- **Money is a string end to end.** Never `parseFloat` a rupee value.
- **Every admin Server Action opens with `await requireAdmin()`** from `@/lib/admin-auth`, and every action has a test proving it.
- **Every action returns `ActionResult`** from `@/lib/actions`, routing errors through `toActionError(error, '<actionName>')`.
- **All database access goes through `withDbRetry`** from `@/lib/db-retry`.
- **Tests are `.ts` only.** `vitest.config.mts` collects `src/**/*.test.ts`; a `.tsx` test will be written and never run.
- **Environment is read through `getEnv()`**, never `process.env` directly.
- **The UI stays plain** — the frontend design is supplied separately.
- **`0` is a valid amount here.** `src/lib/validation/catalog.ts` defines `rupees` as `> 0`, which is right for a product price and wrong for every field on this screen: a `delivery_fee` of 0 is a shop that never charges for delivery, and a `free_delivery_above` of 0 makes delivery always free. Task 2 defines its own money schema rather than importing that one.
- Run tests with `npm test`. Typecheck with `npx tsc --noEmit`. Lint with `npm run lint`.

---

### Task 1: `slot_capacity` setting and a settings writer

**Files:**
- Modify: `src/lib/settings.ts`
- Test: `src/lib/settings.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SETTING_DEFAULTS.slot_capacity: 20`
  - `ShopSettings.slotCapacity: number`
  - `writeSettings(values: Partial<Record<SettingKey, unknown>>): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/settings.test.ts`. Note the mock at the top of that file currently exposes only `setting.findMany`; extend it to the shape below, keeping `findMany` so the existing tests still run:

```ts
vi.mock('@/lib/db', () => ({
  db: {
    setting: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
  },
}));
```

Then add:

```ts
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
```

Update the import line to `import { getShopSettings, writeSettings } from './settings';`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- settings`
Expected: FAIL — `writeSettings` is not exported and `slotCapacity` is `undefined`.

- [ ] **Step 3: Add the default and the reader**

In `src/lib/settings.ts`, add to `SETTING_DEFAULTS`, below `whatsapp_number`:

```ts
  // What the cron gives each newly generated slot. Editable so a bigger van
  // does not mean re-editing twenty-one rows a week, forever.
  slot_capacity: 20,
```

Add to the `ShopSettings` interface:

```ts
  /** Orders one van can carry in a window. Applied to newly generated slots. */
  slotCapacity: number;
```

Add this reader beside `readMoney`:

```ts
// Same tolerance as money, for the same reason: a nonsense capacity should
// generate slots at the default, not stop the shop having any slots to sell.
const wholeCount = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((v) => Number.isInteger(v) && v >= 0 && v <= 500, 'not a capacity');

function readCount(raw: unknown, fallback: number): number {
  const parsed = wholeCount.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}
```

And in the returned object:

```ts
    slotCapacity: readCount(byKey.get('slot_capacity'), SETTING_DEFAULTS.slot_capacity),
```

- [ ] **Step 4: Add the writer**

Append to `src/lib/settings.ts`:

```ts
/**
 * Saves settings, creating rows that do not exist yet.
 *
 * Upsert rather than update because the table starts empty — every value in
 * `SETTING_DEFAULTS` is a default precisely because its row may never have been
 * written. One transaction, so a form that fails partway cannot leave the shop
 * with a new delivery fee and an old minimum order.
 *
 * Values are written as given. Validation belongs to the caller's schema, and
 * `getShopSettings` treats anything unreadable as absent regardless.
 */
export async function writeSettings(
  values: Partial<Record<SettingKey, unknown>>
): Promise<void> {
  const entries = Object.entries(values) as [SettingKey, unknown][];
  if (entries.length === 0) return;

  await withDbRetry(() =>
    db.$transaction(
      entries.map(([key, value]) =>
        db.setting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue },
          update: { value: value as Prisma.InputJsonValue },
        })
      )
    )
  );
}
```

Add `Prisma` to the imports: `import { Prisma } from '@prisma/client';`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- settings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/settings.ts src/lib/settings.test.ts
git commit -m "feat: make slot capacity a setting and let settings be written

The reader has existed since phase 1 with nothing on the other side of it.
writeSettings upserts because the table starts empty — every value in
SETTING_DEFAULTS is a default precisely because its row may never have been
written — and does it in one transaction so a form that fails partway cannot
leave the shop with a new delivery fee and an old minimum order.

slot_capacity gets the same tolerance as the money keys: a nonsense value
generates slots at twenty rather than leaving the shop with no slots to sell."
```

---

### Task 2: Validation schemas

**Files:**
- Create: `src/lib/validation/config.ts`
- Test: `src/lib/validation/config.test.ts`

**Interfaces:**
- Consumes: `PINCODE_PATTERN` from `@/lib/serviceability`
- Produces:
  - `pincodeSchema` → `{ pincode: string; area?: string }`
  - `slotCapacitySchema` → `number`
  - `shopSettingsSchema` → `{ deliveryFee, minOrderValue, freeDeliveryAbove, whatsappNumber, slotCapacity }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validation/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PINCODE_PATTERN } from '@/lib/serviceability';
import { pincodeSchema, slotCapacitySchema, shopSettingsSchema } from './config';

const VALID_SETTINGS = {
  deliveryFee: '30',
  minOrderValue: '199',
  freeDeliveryAbove: '500',
  whatsappNumber: '+919876543210',
  slotCapacity: '20',
};

describe('pincodeSchema', () => {
  it('accepts a six-digit code with an area name', () => {
    const parsed = pincodeSchema.parse({ pincode: '560001', area: 'Indiranagar' });
    expect(parsed).toEqual({ pincode: '560001', area: 'Indiranagar' });
  });

  it('treats a blank area as no area rather than an empty name', () => {
    expect(pincodeSchema.parse({ pincode: '560001', area: '  ' }).area).toBeUndefined();
  });

  it.each([['56001'], ['5600011'], ['060001'], ['ABC123'], ['']])(
    'rejects %s',
    (value) => {
      expect(() => pincodeSchema.parse({ pincode: value })).toThrow();
    }
  );

  it('applies the same rule the serviceability check uses', () => {
    // Two copies of this rule would drift, and this one decides whether a
    // customer can order at all.
    expect(PINCODE_PATTERN.test('560001')).toBe(true);
    expect(pincodeSchema.parse({ pincode: '560001' }).pincode).toBe('560001');
  });
});

describe('slotCapacitySchema', () => {
  it('accepts a whole number', () => {
    expect(slotCapacitySchema.parse('30')).toBe(30);
  });

  it('accepts zero, which keeps a slot visible but unbookable', () => {
    expect(slotCapacitySchema.parse('0')).toBe(0);
  });

  it.each([['-1'], ['2.5'], ['501'], ['many'], ['']])('rejects %s', (value) => {
    expect(() => slotCapacitySchema.parse(value)).toThrow();
  });
});

describe('shopSettingsSchema', () => {
  it('accepts a filled-in form', () => {
    const parsed = shopSettingsSchema.parse(VALID_SETTINGS);
    expect(parsed.deliveryFee).toBe('30');
    expect(parsed.slotCapacity).toBe(20);
  });

  it('accepts zero for every amount', () => {
    // A delivery fee of 0 is a shop that never charges for delivery, and a
    // free-delivery threshold of 0 makes it always free. Both are real
    // configurations, which is why catalog.ts's `rupees` is not reused here.
    const parsed = shopSettingsSchema.parse({
      ...VALID_SETTINGS,
      deliveryFee: '0',
      minOrderValue: '0',
      freeDeliveryAbove: '0',
    });

    expect(parsed.deliveryFee).toBe('0');
    expect(parsed.minOrderValue).toBe('0');
  });

  it('keeps amounts as strings so nothing rounds on the way to Decimal', () => {
    expect(shopSettingsSchema.parse({ ...VALID_SETTINGS, deliveryFee: '45.50' }).deliveryFee).toBe(
      '45.50'
    );
  });

  it.each([['45.555'], ['-5'], ['abc'], ['']])('rejects a delivery fee of %s', (value) => {
    expect(() => shopSettingsSchema.parse({ ...VALID_SETTINGS, deliveryFee: value })).toThrow();
  });

  it('allows the WhatsApp number to be left empty', () => {
    expect(
      shopSettingsSchema.parse({ ...VALID_SETTINGS, whatsappNumber: '' }).whatsappNumber
    ).toBe('');
  });

  it('rejects a WhatsApp number that is not a phone number', () => {
    expect(() =>
      shopSettingsSchema.parse({ ...VALID_SETTINGS, whatsappNumber: 'call the shop' })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- validation/config`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 3: Write the schemas**

Create `src/lib/validation/config.ts`:

```ts
import { z } from 'zod';
import { PINCODE_PATTERN } from '@/lib/serviceability';

/**
 * Money on the settings screen, where zero is meaningful.
 *
 * Deliberately not `rupees` from `catalog.ts`, which requires a value above
 * zero. That is right for a product price and wrong for every amount here: a
 * delivery fee of 0 is a shop that never charges for delivery, and a
 * free-delivery threshold of 0 makes delivery always free. Both are things an
 * owner may genuinely want, and a schema that rejected them would send him back
 * to the database — which is the situation this screen exists to end.
 */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'must be an amount like 30 or 30.50');

export const pincodeSchema = z.object({
  pincode: z
    .string()
    .trim()
    .regex(PINCODE_PATTERN, 'must be a six-digit PIN code'),
  area: z
    .string()
    .trim()
    .max(60)
    .optional()
    // A blank box means "no area recorded", not an area whose name is empty.
    .transform((v) => (v ? v : undefined)),
});

/** 0 is valid: it keeps a slot on the page while refusing new orders. */
export const slotCapacitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, 'must be a whole number of orders')
  .transform(Number)
  .refine((v) => v <= 500, 'must be 500 or fewer');

export const shopSettingsSchema = z.object({
  deliveryFee: amount,
  minOrderValue: amount,
  freeDeliveryAbove: amount,
  whatsappNumber: z
    .string()
    .trim()
    .max(20)
    .refine(
      (v) => v === '' || /^\+?[0-9]{8,15}$/.test(v),
      'must be a phone number, or left empty'
    ),
  slotCapacity: slotCapacitySchema,
});

export type PincodeInput = z.infer<typeof pincodeSchema>;
export type ShopSettingsInput = z.infer<typeof shopSettingsSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- validation/config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/config.ts src/lib/validation/config.test.ts
git commit -m "feat: validate pincode, capacity and settings input

The money rule here is not the one in catalog.ts, and the difference is
deliberate: that schema requires an amount above zero, which is right for a
product price and wrong for every field on the settings screen. A delivery fee
of zero is a shop that never charges for delivery. Rejecting it would send the
owner back to the database, which is the situation this screen exists to end.

The pincode rule imports PINCODE_PATTERN rather than restating it. Two copies
would drift, and this one decides whether a customer can order at all."
```

---

### Task 3: The cron reads the configured capacity

**Files:**
- Modify: `src/app/api/cron/generate-slots/route.ts:8-10` (drop the constant), and the `rows.push` block
- Test: `src/app/api/cron/generate-slots/route.test.ts`

**Interfaces:**
- Consumes: `getShopSettings` (Task 1)
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

`generate-slots/route.test.ts` does not currently mock `@/lib/settings`, and after this change the route calls it. Add this mock alongside the existing `@/lib/cron` mock at the top of the file:

```ts
vi.mock('@/lib/settings', () => ({ getShopSettings: vi.fn() }));
```

Add to the imports: `import { getShopSettings } from '@/lib/settings';`

Add to `beforeEach`, after `vi.mocked(withAdvisoryLock).mockReset();`:

```ts
  vi.mocked(getShopSettings).mockReset().mockResolvedValue({
    deliveryFee: '30.00',
    minOrderValue: '199.00',
    freeDeliveryAbove: '500.00',
    shopOpen: true,
    paymentsEnabled: false,
    whatsappNumber: '',
    slotCapacity: 20,
  });
```

Then add these tests inside the existing top-level `describe`:

```ts
  it('generates at the configured capacity rather than a hardcoded one', async () => {
    vi.mocked(getShopSettings).mockResolvedValue({
      deliveryFee: '30.00',
      minOrderValue: '199.00',
      freeDeliveryAbove: '500.00',
      shopOpen: true,
      paymentsEnabled: false,
      whatsappNumber: '',
      slotCapacity: 35,
    });
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    const { data } = createMany.mock.calls[0][0] as CreateManyArgs & {
      data: { capacity: number }[];
    };
    expect(data.every((row) => row.capacity === 35)).toBe(true);
  });

  it('still generates when the capacity is zero, leaving the slots unbookable', async () => {
    // Zero is a real configuration. Skipping generation would leave the week
    // empty and the owner unable to raise it back.
    vi.mocked(getShopSettings).mockResolvedValue({
      deliveryFee: '30.00',
      minOrderValue: '199.00',
      freeDeliveryAbove: '500.00',
      shopOpen: true,
      paymentsEnabled: false,
      whatsappNumber: '',
      slotCapacity: 0,
    });
    const createMany = captureCreateMany();

    await generateSlots(authorized());

    const { data } = createMany.mock.calls[0][0] as { data: { capacity: number }[] };
    expect(data).toHaveLength(21);
    expect(data.every((row) => row.capacity === 0)).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- generate-slots`
Expected: FAIL — rows carry `capacity: 20` regardless of the setting.

- [ ] **Step 3: Change the route**

In `src/app/api/cron/generate-slots/route.ts`, delete the `SLOT_CAPACITY` constant and its comment, add the import:

```ts
import { getShopSettings } from '@/lib/settings';
```

Then inside `POST`, before the row loop:

```ts
  // One read before the lock. A missing or nonsense value falls back to the
  // default inside getShopSettings, because a night skipped over a bad settings
  // row would leave the shop with no slots to sell at all.
  const { slotCapacity } = await getShopSettings();
```

And in the `rows.push`:

```ts
        capacity: slotCapacity,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- generate-slots`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/generate-slots/route.ts src/app/api/cron/generate-slots/route.test.ts
git commit -m "feat: generate slots at the configured capacity

Adds one settings read before the advisory lock. A missing or nonsense value
falls back to twenty inside getShopSettings rather than aborting: a night
skipped over one bad settings row would leave the shop with nothing to sell,
which is a worse failure than generating at the default.

Zero generates as normal. It is a real configuration — the slots stay visible
and refuse new orders — and skipping generation would leave the week empty with
no row for the owner to raise back."
```

---

### Task 4: The slot week read layer

**Files:**
- Create: `src/lib/admin/slot-queries.ts`
- Test: `src/lib/admin/slot-queries.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface AdminSlot { id, slotType, capacity, booked, isOpen, cutoffAt }`
  - `interface SlotDay { date: string; slots: AdminSlot[] }`
  - `interface SlotWeek { from: string; days: SlotDay[] }`
  - `getSlotWeek(fromDate: string): Promise<SlotWeek>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin/slot-queries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { deliverySlot: { findMany: vi.fn() } } }));

import { SlotType } from '@prisma/client';
import { db } from '@/lib/db';
import { getSlotWeek } from './slot-queries';

function slotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's_1',
    date: new Date('2026-08-11T00:00:00Z'),
    slotType: SlotType.MORNING,
    capacity: 20,
    booked: 3,
    isOpen: true,
    cutoffAt: new Date('2026-08-10T16:30:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(db.deliverySlot.findMany).mockReset().mockResolvedValue([] as never);
});

describe('getSlotWeek', () => {
  it('always returns seven days, starting from the date given', async () => {
    const week = await getSlotWeek('2026-08-11');

    expect(week.days).toHaveLength(7);
    expect(week.days[0].date).toBe('2026-08-11');
    expect(week.days[6].date).toBe('2026-08-17');
  });

  it('shows a day with no generated slots as empty rather than skipping it', async () => {
    // A short week would read as "that is the week", hiding the fact that the
    // cron has not run.
    const week = await getSlotWeek('2026-08-11');

    expect(week.days.every((day) => day.slots.length === 0)).toBe(true);
  });

  it('files each slot under its own date', async () => {
    vi.mocked(db.deliverySlot.findMany).mockResolvedValue([
      slotRow({ id: 's_1', date: new Date('2026-08-11T00:00:00Z') }),
      slotRow({ id: 's_2', date: new Date('2026-08-13T00:00:00Z') }),
    ] as never);

    const week = await getSlotWeek('2026-08-11');

    expect(week.days[0].slots.map((s) => s.id)).toEqual(['s_1']);
    expect(week.days[2].slots.map((s) => s.id)).toEqual(['s_2']);
  });

  it('carries capacity and booked through, since both drive the screen', async () => {
    vi.mocked(db.deliverySlot.findMany).mockResolvedValue([
      slotRow({ capacity: 5, booked: 3 }),
    ] as never);

    const [slot] = (await getSlotWeek('2026-08-11')).days[0].slots;

    expect(slot.capacity).toBe(5);
    expect(slot.booked).toBe(3);
    expect(slot.isOpen).toBe(true);
    expect(typeof slot.cutoffAt).toBe('string');
  });

  it('queries exactly the seven-day window', async () => {
    await getSlotWeek('2026-08-11');

    const where = vi.mocked(db.deliverySlot.findMany).mock.calls[0][0]!.where as {
      date: { gte: Date; lte: Date };
    };
    expect(where.date.gte).toEqual(new Date('2026-08-11T00:00:00.000Z'));
    expect(where.date.lte).toEqual(new Date('2026-08-17T00:00:00.000Z'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- slot-queries`
Expected: FAIL — cannot resolve `./slot-queries`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/admin/slot-queries.ts`:

```ts
import { SlotType } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';

export interface AdminSlot {
  id: string;
  slotType: SlotType;
  capacity: number;
  booked: number;
  isOpen: boolean;
  /** ISO string; a Date cannot cross into a client component. */
  cutoffAt: string;
}

export interface SlotDay {
  /** 'YYYY-MM-DD' — a calendar day, which is what the column stores. */
  date: string;
  /** Empty when the cron has not generated this day yet. */
  slots: AdminSlot[];
}

export interface SlotWeek {
  from: string;
  days: SlotDay[];
}

const DAYS = 7;

/** A `@db.Date` column means a calendar day, so it is matched at UTC midnight. */
function calendarDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * A week of delivery slots for the admin grid.
 *
 * Days the cron has not reached come back with an empty `slots` array rather
 * than being left out. A short week would read as "that is the week", which is
 * exactly the wrong impression when the real story is that slot generation has
 * stopped running.
 */
export async function getSlotWeek(fromDate: string): Promise<SlotWeek> {
  const from = calendarDay(fromDate);
  const to = new Date(from.getTime() + (DAYS - 1) * 24 * 60 * 60 * 1000);

  const slots = await withDbRetry(() =>
    db.deliverySlot.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }, { slotType: 'asc' }],
    })
  );

  const byDay = new Map<string, AdminSlot[]>();
  for (const slot of slots) {
    const key = isoDay(slot.date);
    const list = byDay.get(key) ?? [];
    list.push({
      id: slot.id,
      slotType: slot.slotType,
      capacity: slot.capacity,
      booked: slot.booked,
      isOpen: slot.isOpen,
      cutoffAt: slot.cutoffAt.toISOString(),
    });
    byDay.set(key, list);
  }

  const days: SlotDay[] = [];
  for (let offset = 0; offset < DAYS; offset++) {
    const date = isoDay(new Date(from.getTime() + offset * 24 * 60 * 60 * 1000));
    days.push({ date, slots: byDay.get(date) ?? [] });
  }

  return { from: fromDate, days };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- slot-queries`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/slot-queries.ts src/lib/admin/slot-queries.test.ts
git commit -m "feat: read a week of delivery slots for the admin grid

Always seven days, and a day the cron has not reached comes back empty rather
than being left out. A short week reads as 'that is the week', which is the
wrong impression to give when the real story is that slot generation has
stopped running."
```

---

### Task 5: Slot actions

**Files:**
- Create: `src/app/(admin)/admin/slots/actions.ts`
- Test: `src/app/(admin)/admin/slots/actions.test.ts`

**Interfaces:**
- Consumes: `slotCapacitySchema` (Task 2); `requireAdmin`, `toActionError`, `ActionResult`
- Produces:
  - `setSlotCapacity(slotId: string, capacity: string): Promise<ActionResult>`
  - `setSlotOpen(slotId: string, isOpen: boolean): Promise<ActionResult>`
  - `setDateOpen(date: string, isOpen: boolean): Promise<ActionResult>`

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/admin/slots/actions.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- "slots/actions"`
Expected: FAIL — cannot resolve `./actions`.

- [ ] **Step 3: Write the implementation**

Create `src/app/(admin)/admin/slots/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { requireAdmin } from '@/lib/admin-auth';
import { toActionError, type ActionResult } from '@/lib/actions';
import { slotCapacitySchema } from '@/lib/validation/config';

/** 'YYYY-MM-DD'. The column is a calendar day, matched at UTC midnight. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date');

function calendarDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function refresh() {
  revalidatePath('/admin/slots');
}

/**
 * Sets how many orders one slot may take.
 *
 * Deliberately permits a capacity below the slot's current `booked` count. That
 * is the shape of the real request — "we have four already, take no more" — and
 * it needs no special handling: `bookSlot` re-evaluates `booked < capacity`
 * inside its conditional UPDATE, so existing orders stand and new ones stop.
 */
export async function setSlotCapacity(slotId: string, capacity: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const value = slotCapacitySchema.parse(capacity);

    await withDbRetry(() =>
      db.deliverySlot.update({ where: { id: slotId }, data: { capacity: value } })
    );

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setSlotCapacity');
  }
}

/**
 * Opens or closes a single slot.
 *
 * Closing stops new orders and nothing else. Orders already booked into it
 * still have customers expecting a delivery, so cancelling them stays a
 * deliberate, per-order act on the orders screen — the count is shown at the
 * confirm step so the decision is made knowingly.
 */
export async function setSlotOpen(slotId: string, isOpen: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    await withDbRetry(() => db.deliverySlot.update({ where: { id: slotId }, data: { isOpen } }));

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setSlotOpen');
  }
}

/**
 * Opens or closes every slot on one date — a holiday, or the end of one.
 *
 * One statement rather than three, so a half-applied block cannot survive a
 * failure partway through. It takes a boolean rather than being a one-way
 * "block", because a festival gets cancelled and a date blocked by mis-click
 * has to be recoverable: reopening three slots individually is exactly the
 * fiddly step that leaves one of them still closed.
 */
export async function setDateOpen(date: string, isOpen: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();
    const day = dateSchema.parse(date);

    await withDbRetry(() =>
      db.deliverySlot.updateMany({ where: { date: calendarDay(day) }, data: { isOpen } })
    );

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setDateOpen');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- "slots/actions"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/slots/actions.ts" "src/app/(admin)/admin/slots/actions.test.ts"
git commit -m "feat: set slot capacity and open or close slots and dates

Lowering a capacity below the orders already booked is allowed, because that is
the shape of the real request — 'we have four already, take no more' — and it
needs no handling: bookSlot re-evaluates booked < capacity inside its
conditional UPDATE, so the four stand and the fifth is refused.

setDateOpen takes a boolean rather than being a one-way block. A festival gets
cancelled, and reopening three slots one at a time is exactly the fiddly step
that leaves one of them still closed."
```

---

### Task 6: Pincode actions

**Files:**
- Create: `src/app/(admin)/admin/pincodes/actions.ts`
- Test: `src/app/(admin)/admin/pincodes/actions.test.ts`

**Interfaces:**
- Consumes: `pincodeSchema` (Task 2); `formText`, `toActionError`, `ActionResult`
- Produces:
  - `addPincode(_prev: unknown, formData: FormData): Promise<ActionResult>`
  - `setPincodeActive(id: string, isActive: boolean): Promise<ActionResult>`

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/admin/pincodes/actions.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- "pincodes/actions"`
Expected: FAIL — cannot resolve `./actions`.

- [ ] **Step 3: Write the implementation**

Create `src/app/(admin)/admin/pincodes/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { requireAdmin } from '@/lib/admin-auth';
import { formText, toActionError, type ActionResult } from '@/lib/actions';
import { pincodeSchema } from '@/lib/validation/config';

function refresh() {
  revalidatePath('/admin/pincodes');
}

/** Adds a pincode the shop will deliver to. */
export async function addPincode(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();

    const input = pincodeSchema.parse({
      pincode: formText(formData, 'pincode'),
      area: formText(formData, 'area'),
    });

    await withDbRetry(() =>
      db.servicePincode.create({ data: { pincode: input.pincode, area: input.area } })
    );

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'addPincode');
  }
}

/**
 * Switches a delivery area on or off.
 *
 * Deactivates rather than deletes. `isServiceable` already filters on
 * `isActive`, so the effect is identical for a customer, and the row surviving
 * means a saved address in that pincode is explained by a record rather than by
 * nothing at all. It also matches how categories and products are withdrawn.
 */
export async function setPincodeActive(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    await withDbRetry(() => db.servicePincode.update({ where: { id }, data: { isActive } }));

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setPincodeActive');
  }
}
```

Note on the duplicate case: `toActionError` maps `P2002` to "That value is already taken" via its fallback branch, since `pincode` is not in its `UNIQUE_FIELD_MESSAGES` map. That message is accurate here, so no change to `actions.ts` is needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- "pincodes/actions"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/pincodes/actions.ts" "src/app/(admin)/admin/pincodes/actions.test.ts"
git commit -m "feat: add and withdraw serviceable pincodes

Withdrawing deactivates rather than deletes. isServiceable already filters on
isActive so a customer sees no difference, and the surviving row means a saved
address in a dropped pincode is explained by a record rather than by nothing.
It is also how categories and products are withdrawn."
```

---

### Task 7: Settings actions, with the payments guard

**Files:**
- Create: `src/app/(admin)/admin/settings/actions.ts`
- Test: `src/app/(admin)/admin/settings/actions.test.ts`

**Interfaces:**
- Consumes: `writeSettings` (Task 1); `shopSettingsSchema` (Task 2); `getEnv` from `@/lib/env`
- Produces:
  - `updateSettings(_prev: unknown, formData: FormData): Promise<ActionResult>`
  - `setShopOpen(isOpen: boolean): Promise<ActionResult>`
  - `setPaymentsEnabled(enabled: boolean): Promise<ActionResult>`

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/admin/settings/actions.test.ts`:

```ts
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
    });
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- "settings/actions"`
Expected: FAIL — cannot resolve `./actions`.

- [ ] **Step 3: Write the implementation**

Create `src/app/(admin)/admin/settings/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { getEnv } from '@/lib/env';
import { writeSettings } from '@/lib/settings';
import { formText, toActionError, type ActionResult } from '@/lib/actions';
import { shopSettingsSchema } from '@/lib/validation/config';

function refresh() {
  revalidatePath('/admin/settings');
  // The storefront reads these on every page: a changed delivery fee or a
  // closed shop has to be visible immediately, not after the next deploy.
  revalidatePath('/', 'layout');
}

/** Saves the money and text settings as one form. */
export async function updateSettings(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();

    const input = shopSettingsSchema.parse({
      deliveryFee: formText(formData, 'deliveryFee'),
      minOrderValue: formText(formData, 'minOrderValue'),
      freeDeliveryAbove: formText(formData, 'freeDeliveryAbove'),
      whatsappNumber: formText(formData, 'whatsappNumber'),
      slotCapacity: formText(formData, 'slotCapacity'),
    });

    await writeSettings({
      delivery_fee: input.deliveryFee,
      min_order_value: input.minOrderValue,
      free_delivery_above: input.freeDeliveryAbove,
      whatsapp_number: input.whatsappNumber,
      slot_capacity: input.slotCapacity,
    });

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'updateSettings');
  }
}

/**
 * The emergency control. Writes immediately rather than behind a Save button —
 * the reason to touch this is that something has gone wrong right now.
 */
export async function setShopOpen(isOpen: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    await writeSettings({ shop_open: isOpen });

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setShopOpen');
  }
}

/**
 * Offers or withdraws online payment.
 *
 * Switching on is refused when Razorpay is not configured. `SETTING_DEFAULTS`
 * keeps this flag off so a shop whose KYC has not cleared does not advertise a
 * payment method that throws at the last step of checkout, and a settings
 * screen that let it be flipped anyway would hand that failure straight back to
 * a customer. The check is here rather than only on the input, because a
 * disabled input is not a control — `admin-auth.ts` sets out the same reasoning
 * for why authorization cannot live in middleware.
 *
 * Switching off is always allowed. Turning something off is never the unsafe
 * direction, and refusing it could strand a shop advertising a broken method.
 */
export async function setPaymentsEnabled(enabled: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();

    if (enabled && !getEnv().RAZORPAY_KEY_ID) {
      return {
        ok: false,
        error:
          'Razorpay keys are not set on this server, so online payment would fail at checkout. ' +
          'Set them, restart, then switch this on.',
      };
    }

    await writeSettings({ payments_enabled: enabled });

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'setPaymentsEnabled');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- "settings/actions"`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add "src/app/(admin)/admin/settings/actions.ts" "src/app/(admin)/admin/settings/actions.test.ts"
git commit -m "feat: save shop settings, with a guard on the payments switch

Switching payments on is refused when RAZORPAY_KEY_ID is absent. The flag
defaults to false so a shop whose KYC has not cleared does not advertise a
payment method that throws at the last step of checkout, and a settings screen
that let it be flipped anyway would hand that failure straight to a customer.
The check is in the action, not on the input: a disabled input is not a
control, for the same reason admin-auth gives about middleware.

Switching off is always allowed. Turning something off is never the unsafe
direction, and refusing it would strand a shop advertising a broken method."
```

---

### Task 8: The slots screen

**Files:**
- Modify: `src/app/(admin)/admin/slots/page.tsx` (replace the 8-line stub)
- Create: `src/app/(admin)/admin/slots/slot-grid.tsx`
- Test: none — `.tsx` is not collected by the runner. The logic is covered by Tasks 4 and 5.

**Interfaces:**
- Consumes: `getSlotWeek`, `SlotWeek`, `AdminSlot` (Task 4); `setSlotCapacity`, `setSlotOpen`, `setDateOpen` (Task 5); `formatSlotType`, `formatSlotDate` from `@/lib/format`
- Produces: the `/admin/slots` route

- [ ] **Step 1: Build the grid**

Create `src/app/(admin)/admin/slots/slot-grid.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import type { SlotDay, SlotWeek } from '@/lib/admin/slot-queries';
import { formatSlotDate, formatSlotType } from '@/lib/format';
import { setSlotCapacity, setSlotOpen, setDateOpen } from './actions';

function DayRow({ day, onError }: { day: SlotDay; onError: (message: string) => void }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const booked = day.slots.reduce((total, slot) => total + slot.booked, 0);
  const allClosed = day.slots.length > 0 && day.slots.every((slot) => !slot.isOpen);

  function toggleDate() {
    const reopening = allClosed;
    if (!reopening && booked > 0) {
      const ok = window.confirm(
        `${booked} order${booked === 1 ? ' is' : 's are'} already booked on this date.\n\n` +
          'Closing stops new orders only — these still need delivering. ' +
          'Cancel them individually from Orders if that is what you mean.'
      );
      if (!ok) return;
    }

    startTransition(async () => {
      const result = await setDateOpen(day.date, reopening);
      if (!result.ok) onError(result.error);
      else router.refresh();
    });
  }

  return (
    <tr className="border-b">
      <td className="py-2 pr-4 align-top">
        <div className="font-medium">{formatSlotDate(`${day.date}T00:00:00.000Z`)}</div>
        <div className="text-xs text-muted-foreground">{day.date}</div>
      </td>

      {day.slots.length === 0 ? (
        <td colSpan={4} className="py-2 text-sm text-muted-foreground">
          No slots generated for this day — the cron may not have run.
        </td>
      ) : (
        <>
          {day.slots.map((slot) => (
            <td key={slot.id} className="py-2 pr-4">
              <div className="text-xs text-muted-foreground">{formatSlotType(slot.slotType)}</div>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Capacity for ${slot.slotType}`}
                  defaultValue={String(slot.capacity)}
                  className="w-16 text-right"
                  onBlur={(event) => {
                    const next = event.target.value;
                    if (next === String(slot.capacity)) return;
                    startTransition(async () => {
                      const result = await setSlotCapacity(slot.id, next);
                      if (!result.ok) onError(result.error);
                      else router.refresh();
                    });
                  }}
                />
                <ToggleSwitch
                  checked={slot.isOpen}
                  label={`${slot.slotType} open`}
                  onToggle={(next) => setSlotOpen(slot.id, next)}
                  onError={onError}
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{slot.booked} booked</div>
            </td>
          ))}

          <td className="py-2 align-top">
            <Button variant="outline" disabled={pending} onClick={toggleDate}>
              {allClosed ? 'Reopen date' : 'Block date'}
            </Button>
          </td>
        </>
      )}
    </tr>
  );
}

export function SlotGrid({ week }: { week: SlotWeek }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <table className="w-full text-sm">
        <tbody>
          {week.days.map((day) => (
            <DayRow key={day.date} day={day} onError={setError} />
          ))}
        </tbody>
      </table>

      <p className="mt-4 text-xs text-muted-foreground">
        Capacity saves when you leave the box. Lowering it below the booked count is allowed — the
        orders already taken stand, and no new ones are accepted.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Replace the page stub**

Replace `src/app/(admin)/admin/slots/page.tsx` entirely:

```tsx
import { buttonVariants } from '@/components/ui/button';
import { getSlotWeek } from '@/lib/admin/slot-queries';
import { SlotGrid } from './slot-grid';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today in India. The offset is explicit because the container runs UTC. */
function todayInIndia(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export default async function AdminSlotsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? '') ? params.from! : todayInIndia();

  const week = await getSlotWeek(from);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Delivery slots</h1>
        <div className="flex gap-2">
          <a
            href={`/admin/slots?from=${shiftDays(from, -7)}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            ← Previous week
          </a>
          <a
            href={`/admin/slots?from=${shiftDays(from, 7)}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            Next week →
          </a>
        </div>
      </div>

      <SlotGrid week={week} />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/slots"
git commit -m "feat: a week view for delivery slots

Capacity saves on blur, the open switch writes immediately, and blocking a
whole date is one action. Closing a date that already has orders asks first and
says what closing does and does not do — it stops new orders, and the orders
already taken still need delivering.

A day with no generated slots says so rather than being omitted, because a
short week hides the fact that the cron has stopped running."
```

---

### Task 9: The pincodes screen

**Files:**
- Modify: `src/app/(admin)/admin/pincodes/page.tsx` (replace the 8-line stub)
- Create: `src/app/(admin)/admin/pincodes/pincode-manager.tsx`
- Test: none — `.tsx`. Logic covered by Task 6.

**Interfaces:**
- Consumes: `addPincode`, `setPincodeActive` (Task 6)
- Produces: the `/admin/pincodes` route; `interface PincodeRow { id, pincode, area, isActive }`

- [ ] **Step 1: Build the manager**

Create `src/app/(admin)/admin/pincodes/pincode-manager.tsx`:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { cn } from '@/lib/utils';
import { addPincode, setPincodeActive } from './actions';

const INITIAL = { ok: false as const, error: '' };

export interface PincodeRow {
  id: string;
  pincode: string;
  area: string | null;
  isActive: boolean;
}

export function PincodeManager({ pincodes }: { pincodes: PincodeRow[] }) {
  const [state, formAction, pending] = useActionState(addPincode, INITIAL);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="pincode">PIN code</Label>
          <Input id="pincode" name="pincode" inputMode="numeric" className="w-32" required />
        </div>

        <div className="space-y-1">
          <Label htmlFor="area">Area (optional)</Label>
          <Input id="area" name="area" className="w-56" />
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add pincode'}
        </Button>
      </form>

      {!state.ok && state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {pincodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No pincodes yet. Until one is added, nobody can check out.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {pincodes.map((row) => (
            <li
              key={row.id}
              className={cn('flex items-center gap-3 p-3', !row.isActive && 'opacity-60')}
            >
              <span className="font-medium">{row.pincode}</span>
              <span className="text-sm text-muted-foreground">{row.area ?? '—'}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {row.isActive ? 'Delivering' : 'Not delivering'}
              </span>
              <ToggleSwitch
                checked={row.isActive}
                label={`Deliver to ${row.pincode}`}
                onToggle={(next) => setPincodeActive(row.id, next)}
                onError={setError}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace the page stub**

Replace `src/app/(admin)/admin/pincodes/page.tsx` entirely:

```tsx
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { PincodeManager } from './pincode-manager';

export const dynamic = 'force-dynamic';

export default async function AdminPincodesPage() {
  const pincodes = await withDbRetry(() =>
    db.servicePincode.findMany({ orderBy: { pincode: 'asc' } })
  );

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Delivery areas</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        A customer can only check out if their PIN code is listed and switched on.
      </p>

      <PincodeManager
        pincodes={pincodes.map((row) => ({
          id: row.id,
          pincode: row.pincode,
          area: row.area,
          isActive: row.isActive,
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/pincodes"
git commit -m "feat: manage serviceable pincodes from admin

Replaces a database edit. The empty state says what the consequence is — until
a pincode is listed, nobody can check out — because an empty list on this
screen is indistinguishable from a broken one otherwise."
```

---

### Task 10: The settings screen

**Files:**
- Modify: `src/app/(admin)/admin/settings/page.tsx` (replace the 8-line stub)
- Create: `src/app/(admin)/admin/settings/settings-form.tsx`
- Test: none — `.tsx`. Logic covered by Tasks 1, 2 and 7.

**Interfaces:**
- Consumes: `getShopSettings`, `ShopSettings` (Task 1); `updateSettings`, `setShopOpen`, `setPaymentsEnabled` (Task 7); `getEnv`
- Produces: the `/admin/settings` route

- [ ] **Step 1: Build the form**

Create `src/app/(admin)/admin/settings/settings-form.tsx`:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import type { ShopSettings } from '@/lib/settings';
import { updateSettings, setShopOpen, setPaymentsEnabled } from './actions';

const INITIAL = { ok: false as const, error: '' };

/** One labelled money or text input. */
function Field({
  name,
  label,
  hint,
  defaultValue,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} className="w-40" />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function SettingsForm({
  settings,
  razorpayConfigured,
}: {
  settings: ShopSettings;
  razorpayConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateSettings, INITIAL);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      <form action={formAction} className="space-y-4">
        <div className="flex flex-wrap gap-6">
          <Field
            name="deliveryFee"
            label="Delivery fee"
            hint="0 means delivery is never charged."
            defaultValue={settings.deliveryFee}
          />
          <Field
            name="minOrderValue"
            label="Minimum order"
            hint="Below this, checkout is blocked."
            defaultValue={settings.minOrderValue}
          />
          <Field
            name="freeDeliveryAbove"
            label="Free delivery above"
            hint="At or above this, the fee is waived."
            defaultValue={settings.freeDeliveryAbove}
          />
          <Field
            name="slotCapacity"
            label="Default slot capacity"
            hint="Applied to newly generated slots."
            defaultValue={String(settings.slotCapacity)}
          />
          <Field
            name="whatsappNumber"
            label="WhatsApp number"
            hint="Shown to customers. May be left empty."
            defaultValue={settings.whatsappNumber}
          />
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>

        {!state.ok && state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.ok && <p className="text-sm text-muted-foreground">Saved.</p>}
      </form>

      <div className="space-y-4 border-t pt-6">
        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked={settings.shopOpen}
            label="Shop open"
            onToggle={setShopOpen}
            onError={setError}
          />
          <div>
            <div className="text-sm font-medium">Shop open</div>
            <p className="text-xs text-muted-foreground">
              Switching this off stops all new orders immediately. Takes effect on click.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked={settings.paymentsEnabled}
            label="Online payments"
            onToggle={setPaymentsEnabled}
            onError={setError}
          />
          <div>
            <div className="text-sm font-medium">Online payments</div>
            <p className="text-xs text-muted-foreground">
              {razorpayConfigured
                ? 'Cash on delivery is always available regardless.'
                : 'Razorpay keys are not set on this server, so this cannot be switched on yet. Cash on delivery is unaffected.'}
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the page stub**

Replace `src/app/(admin)/admin/settings/page.tsx` entirely:

```tsx
import { getEnv } from '@/lib/env';
import { getShopSettings } from '@/lib/settings';
import { SettingsForm } from './settings-form';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const settings = await getShopSettings();

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>
      <SettingsForm settings={settings} razorpayConfigured={Boolean(getEnv().RAZORPAY_KEY_ID)} />
    </div>
  );
}
```

`razorpayConfigured` drives the explanatory text only. The refusal itself is in
`setPaymentsEnabled`, which is what actually stops the write.

- [ ] **Step 3: Verify everything**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`
Expected: clean, and `/admin/slots`, `/admin/pincodes`, `/admin/settings` all listed as dynamic (`ƒ`) in the build output.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```

Sign in as the seeded admin. On `/admin/settings`, confirm the payments switch refuses with an explanation while `RAZORPAY_KEY_ID` is unset. Change the delivery fee and check the cart reflects it. On `/admin/slots`, lower a capacity and block a date. On `/admin/pincodes`, add a code and switch it off, then confirm checkout refuses that pincode.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/settings"
git commit -m "feat: edit shop settings from admin

Money and text save behind a button; the two switches write on click. That
split is deliberate — shop_open is an emergency control, and the reason to
touch it is that something has gone wrong right now, so making the owner find
a Save button afterwards adds a step at the worst moment.

The payments switch explains itself when Razorpay is unconfigured, but the
refusal that matters is in the action."
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §1.1 capacity in two places | 1 (setting), 3 (cron), 5 (per-slot) |
| §1.2 closing stops new orders only | 5, 8 (the confirm text) |
| §1.3 payments guarded in the action | 7 |
| §1.4 pincodes deactivate | 6 |
| §1.5 two save models | 10 |
| §2.1 `validation/config.ts` | 2 |
| §2.2 `settings.ts` extended | 1 |
| §2.3 `slot-queries.ts` | 4 |
| §2.4 three action modules | 5, 6, 7 |
| §3 cron reads the setting | 3 |
| §4 pages | 8, 9, 10 |
| §5 test files | 1–7 |

**Type consistency checked:** `setSlotCapacity(slotId, capacity: string)` takes a string in Task 5 and is called with `event.target.value` in Task 8 — consistent, and `slotCapacitySchema` does the coercion. `ShopSettings.slotCapacity` is a `number` (Task 1), rendered with `String(...)` in Task 10 and parsed back by the schema in Task 7. `writeSettings` is called with settings *keys* (`delivery_fee`), not camelCase field names, in Task 7 — matching `SettingKey` from Task 1. `PincodeRow` is defined in Task 9's client component and constructed in its page.

**One thing to watch:** Task 3 adds `getShopSettings` to the cron, so `generate-slots/route.test.ts` must mock `@/lib/settings` or it will reach the real database module. Step 1 of that task does this explicitly.
