# Admin Order Operations (Phase 6A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shop owner an admin screen that moves an order from CONFIRMED to a customer's door — filterable list, one-action status transitions, a printable picking list, and weight settlement at delivery.

**Architecture:** Three DB-free or DB-thin modules under `src/lib/admin/` (transition table, settlement arithmetic, read layer) with Server Actions in `src/app/(admin)/admin/orders/actions.ts` as thin wrappers over them. Every status write is a conditional `updateMany` guarded on the current status, following the concurrency pattern already established in `src/lib/slots.ts`. Pages are server components; only the expandable list and the settlement form are client components.

**Tech Stack:** Next.js 15.5 (App Router, Server Actions), React 19, Prisma 6.19 + PostgreSQL, Zod 4, Vitest 4, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-10-admin-order-operations-design.md`

## Global Constraints

- **Money is a `Prisma.Decimal` in arithmetic and a string everywhere else.** Never `parseFloat` a rupee value. Query layers return strings via `.toFixed(2)`; settlement uses `Prisma.Decimal` internally.
- **Weights use 3 decimal places** (`@db.Decimal(10, 3)`), money uses 2 (`@db.Decimal(10, 2)`).
- **Every admin Server Action opens with `await requireAdmin()`** from `@/lib/admin-auth`, and every action has a test proving it. Server Actions are not covered by middleware — see the comment in `src/lib/admin-auth.ts`.
- **Every action returns `ActionResult`** from `@/lib/actions` and routes its errors through `toActionError(error, '<actionName>')`.
- **All DB reads and writes go through `withDbRetry`** from `@/lib/db-retry`.
- **Status change and its `OrderEvent` are always in one `db.$transaction`.** So is cancel with its `releaseSlot`.
- **Tests are `.ts` only.** `vitest.config.mts` has `include: ['src/**/*.test.ts']` — a `.tsx` test will not run.
- **The UI stays plain.** The frontend design is supplied separately once the backend is done; do not polish styling beyond what Tailwind classes the existing admin screens already use.
- Run tests with `npm test`. Typecheck with `npx tsc --noEmit`.

---

### Task 1: Denormalise `unitValue` onto `OrderItem`

Settlement cannot price a delivery without knowing the pack size. A seeded potato variant is `label: '5 kg', unitValue: '5', price: '160'`, stored on the order as `unitPrice: 160.00, quantity: 1` — from which ₹32/kg is unrecoverable. `OrderItem.variantId` has no relation (deliberately, so a withdrawn variant cannot break history), so joining back is not available.

**Files:**
- Modify: `prisma/schema.prisma` (the `OrderItem` model)
- Create: `prisma/migrations/<timestamp>_order_item_unit_value/migration.sql` (generated)
- Modify: `src/lib/cart-pricing.ts:8-19` (the `PricedLine` interface), `src/lib/cart-pricing.ts:107-117` (the push)
- Modify: `src/app/api/orders/route.ts:188-199` (the `items.create` map)
- Test: `src/lib/cart-pricing.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `PricedLine.unitValue: string`; `OrderItem.unitValue` column readable as `Prisma.Decimal`

- [ ] **Step 1: Clear the dev test orders**

The column is required with no default, so the migration fails against existing rows. Backfilling `1` is not an option — it would settle that 5 kg line at one fifth of the correct price, and a wrong number that looks plausible is worse than a missing row. `docs/remaining-work-plan.md` already records these test orders as needing to go before any demo.

```bash
npx prisma db execute --stdin <<'SQL'
DELETE FROM "OrderEvent";
DELETE FROM "OrderItem";
DELETE FROM "Order";
UPDATE "DeliverySlot" SET booked = 0;
SQL
```

`booked` is reset because deleting orders directly leaves the slot counters holding places for orders that no longer exist.

- [ ] **Step 2: Add the column to the schema**

In `prisma/schema.prisma`, inside `model OrderItem`, add `unitValue` directly below `unitPrice`:

```prisma
  unitPrice      Decimal  @db.Decimal(10, 2)
  unitValue      Decimal  @db.Decimal(10, 3)
  quantity       Int
```

- [ ] **Step 3: Generate and apply the migration**

```bash
npx prisma migrate dev --name order_item_unit_value
```

Expected: migration created and applied, Prisma Client regenerated.

- [ ] **Step 4: Write the failing test**

Add to `src/lib/cart-pricing.test.ts`, inside the existing top-level `describe`:

```ts
it('carries the variant unit value through to the priced line', async () => {
  vi.mocked(db.variant.findMany).mockResolvedValue([
    variantRow({ id: 'v_potato_5kg', unitValue: new Prisma.Decimal('5'), price: new Prisma.Decimal('160') }),
  ] as never);

  const priced = await priceCart([{ variantId: 'v_potato_5kg', quantity: 1 }]);

  // Without this the order stores 160.00 x 1 and settlement cannot recover
  // the Rs 32/kg needed to price a 4.7 kg delivery.
  expect(priced.items[0].unitValue).toBe('5.000');
});
```

Read the existing test file first and reuse its variant-row helper and mocking style rather than inventing a second one. If the file has no such helper, build the row inline in the same shape the other tests use.

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- cart-pricing`
Expected: FAIL — `unitValue` is `undefined`.

- [ ] **Step 6: Add `unitValue` to `PricedLine` and populate it**

In `src/lib/cart-pricing.ts`, add to the `PricedLine` interface below `unitPrice`:

```ts
  /** Pack size, e.g. '5.000' for a 5 kg bag. Settlement divides by this. */
  unitValue: string;
```

And in the `lines.push({...})` call, below `unitPrice`:

```ts
      unitValue: variant.unitValue.toFixed(3),
```

- [ ] **Step 7: Write it through on order creation**

In `src/app/api/orders/route.ts`, in the `items.create` map, add below `unitPrice`:

```ts
                    unitPrice: line.unitPrice,
                    unitValue: line.unitValue,
                    quantity: line.quantity,
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/cart-pricing.ts src/lib/cart-pricing.test.ts src/app/api/orders/route.ts
git commit -m "feat: denormalise variant unit value onto order items

Settlement prices a delivery by the kilo, and the stored line could not
express one. A 5 kg bag at Rs 160 is saved as unitPrice 160.00 against
quantity 1, and Rs 32/kg is not recoverable from that pair. Joining back to
Variant is not available: variantId carries no relation on purpose, so that
withdrawing a product cannot break an old order, and the price may have moved
since in any case.

The dev test orders are deleted rather than backfilled. A default unitValue of
1 would settle that same bag at a fifth of its price, and a wrong number that
looks right is worse than an absent one."
```

---

### Task 2: The transition table

**Files:**
- Create: `src/lib/admin/order-status.ts`
- Test: `src/lib/admin/order-status.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `nextStatus(current: OrderStatus): OrderStatus | null`
  - `canCancel(current: OrderStatus): boolean`
  - `advanceLabel(current: OrderStatus): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin/order-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OrderStatus } from '@prisma/client';
import { nextStatus, canCancel, advanceLabel } from './order-status';

describe('nextStatus', () => {
  it('walks the delivery pipeline one step at a time', () => {
    expect(nextStatus(OrderStatus.PENDING)).toBe(OrderStatus.CONFIRMED);
    expect(nextStatus(OrderStatus.CONFIRMED)).toBe(OrderStatus.PACKED);
    expect(nextStatus(OrderStatus.PACKED)).toBe(OrderStatus.OUT_FOR_DELIVERY);
    expect(nextStatus(OrderStatus.OUT_FOR_DELIVERY)).toBe(OrderStatus.DELIVERED);
  });

  it('refuses to advance an order still awaiting its OTP', () => {
    // PENDING_OTP is the anti-fraud gate for cash orders. Letting admin skip it
    // would mean a van going out on an order nobody confirmed by phone.
    expect(nextStatus(OrderStatus.PENDING_OTP)).toBeNull();
  });

  it('has no step after a terminal status', () => {
    expect(nextStatus(OrderStatus.DELIVERED)).toBeNull();
    expect(nextStatus(OrderStatus.CANCELLED)).toBeNull();
    expect(nextStatus(OrderStatus.FAILED)).toBeNull();
  });
});

describe('canCancel', () => {
  it('allows cancellation from every non-terminal status', () => {
    expect(canCancel(OrderStatus.PENDING_OTP)).toBe(true);
    expect(canCancel(OrderStatus.PENDING)).toBe(true);
    expect(canCancel(OrderStatus.CONFIRMED)).toBe(true);
    expect(canCancel(OrderStatus.PACKED)).toBe(true);
    expect(canCancel(OrderStatus.OUT_FOR_DELIVERY)).toBe(true);
  });

  it('refuses to cancel a finished order', () => {
    expect(canCancel(OrderStatus.DELIVERED)).toBe(false);
    expect(canCancel(OrderStatus.CANCELLED)).toBe(false);
    expect(canCancel(OrderStatus.FAILED)).toBe(false);
  });
});

describe('advanceLabel', () => {
  it('names the action rather than the destination state', () => {
    expect(advanceLabel(OrderStatus.CONFIRMED)).toBe('Mark packed');
    expect(advanceLabel(OrderStatus.OUT_FOR_DELIVERY)).toBe('Mark delivered');
  });

  it('is null where there is nothing to advance to', () => {
    expect(advanceLabel(OrderStatus.DELIVERED)).toBeNull();
    expect(advanceLabel(OrderStatus.PENDING_OTP)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- order-status`
Expected: FAIL — cannot resolve `./order-status`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/admin/order-status.ts`:

```ts
import { OrderStatus } from '@prisma/client';

/**
 * The one path an order takes through the shop.
 *
 * Forward, one step, no undo. The owner corrects a mis-click by phone, which is
 * rare, and in exchange the OrderEvent trail stays a record of what happened
 * rather than of what was clicked. A dropdown offering any status would let an
 * order jump from PENDING to DELIVERED, skipping the settlement step that
 * decides what the driver collects.
 *
 * PENDING_OTP is deliberately absent. It is the anti-fraud gate for cash
 * orders — a stranger ordering forty kilos to someone else's address has to
 * hold the phone the code was sent to. An admin advance out of it would make
 * that gate optional, which is the same as not having it.
 */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  [OrderStatus.PENDING]: OrderStatus.CONFIRMED,
  [OrderStatus.CONFIRMED]: OrderStatus.PACKED,
  [OrderStatus.PACKED]: OrderStatus.OUT_FOR_DELIVERY,
  [OrderStatus.OUT_FOR_DELIVERY]: OrderStatus.DELIVERED,
};

/** Nothing moves out of these, in either direction. */
const TERMINAL = new Set<OrderStatus>([
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
]);

/** Buttons are named for the act, not the destination: "Mark packed", not "PACKED". */
const ADVANCE_LABELS: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING]: 'Confirm order',
  [OrderStatus.CONFIRMED]: 'Mark packed',
  [OrderStatus.PACKED]: 'Mark out for delivery',
  [OrderStatus.OUT_FOR_DELIVERY]: 'Mark delivered',
};

export function nextStatus(current: OrderStatus): OrderStatus | null {
  return NEXT_STATUS[current] ?? null;
}

export function canCancel(current: OrderStatus): boolean {
  return !TERMINAL.has(current);
}

export function advanceLabel(current: OrderStatus): string | null {
  return ADVANCE_LABELS[current] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- order-status`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/order-status.ts src/lib/admin/order-status.test.ts
git commit -m "feat: define the admin order transition table

One step forward, no undo, and no advance out of PENDING_OTP. That last rule
is the point: PENDING_OTP is what makes a fake cash order cost the person
placing it a code sent to the number on the order, and an admin button past it
would make the gate optional."
```

---

### Task 3: Settlement arithmetic

The module that decides what a customer is charged. Pure, DB-free, and tested hardest.

**Files:**
- Create: `src/lib/admin/settlement.ts`
- Test: `src/lib/admin/settlement.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface SettleableLine { id, productName, variantLabel, unitType, unitPrice, unitValue, quantity, lineTotal }` (all money/weight fields `string`)
  - `interface SettledLine { id, actualQuantity: string | null, adjustedTotal: string | null, effectiveTotal: string }`
  - `isSettleable(line: SettleableLine): boolean`
  - `orderedQuantity(line: SettleableLine): string`
  - `settleLines(lines: SettleableLine[], actualByLineId: Record<string, string>): { lines: SettledLine[]; itemsTotal: string }`
  - `finalTotalFor(adjustedItemsTotal: string, storedDeliveryFee: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin/settlement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { UnitType } from '@prisma/client';
import {
  isSettleable,
  orderedQuantity,
  settleLines,
  finalTotalFor,
  type SettleableLine,
} from './settlement';

function line(overrides: Partial<SettleableLine> = {}): SettleableLine {
  return {
    id: 'oi_1',
    productName: 'Potato',
    variantLabel: '5 kg',
    unitType: UnitType.KG,
    unitPrice: '160.00',
    unitValue: '5.000',
    quantity: 1,
    lineTotal: '160.00',
    ...overrides,
  };
}

describe('isSettleable', () => {
  it('accepts loose produce sold by weight', () => {
    expect(isSettleable(line())).toBe(true);
  });

  it('rejects everything else, because a pre-packed size is what it says', () => {
    expect(isSettleable(line({ unitType: UnitType.GRAM }))).toBe(false);
    expect(isSettleable(line({ unitType: UnitType.PIECE }))).toBe(false);
    expect(isSettleable(line({ unitType: UnitType.LITRE }))).toBe(false);
  });

  it('rejects a zero pack size rather than dividing by it', () => {
    expect(isSettleable(line({ unitValue: '0.000' }))).toBe(false);
  });
});

describe('orderedQuantity', () => {
  it('multiplies pack size by pack count', () => {
    expect(orderedQuantity(line({ unitValue: '5.000', quantity: 2 }))).toBe('10.000');
    expect(orderedQuantity(line({ unitValue: '1.000', quantity: 3 }))).toBe('3.000');
  });
});

describe('settleLines', () => {
  it('prices a short delivery off the per-kilo rate, not the pack price', () => {
    // Rs 160 for 5 kg is Rs 32/kg, so 4.7 kg is Rs 150.40. Reading the pack
    // price as a per-kilo price would charge Rs 752.
    const result = settleLines([line()], { oi_1: '4.700' });

    expect(result.lines[0].adjustedTotal).toBe('150.40');
    expect(result.lines[0].actualQuantity).toBe('4.700');
    expect(result.lines[0].effectiveTotal).toBe('150.40');
    expect(result.itemsTotal).toBe('150.40');
  });

  it('handles a multi-pack line', () => {
    // 2 x 1 kg at Rs 45 = Rs 45/kg; 1.8 kg delivered is Rs 81.
    const result = settleLines(
      [line({ unitPrice: '45.00', unitValue: '1.000', quantity: 2, lineTotal: '90.00' })],
      { oi_1: '1.800' }
    );

    expect(result.lines[0].adjustedTotal).toBe('81.00');
  });

  it('leaves a line alone when no actual weight was entered', () => {
    // A blank box means "as ordered", not "zero delivered".
    const result = settleLines([line()], {});

    expect(result.lines[0].adjustedTotal).toBeNull();
    expect(result.lines[0].actualQuantity).toBeNull();
    expect(result.lines[0].effectiveTotal).toBe('160.00');
    expect(result.itemsTotal).toBe('160.00');
  });

  it('accepts a genuine zero when the item was out of stock at loading', () => {
    const result = settleLines([line()], { oi_1: '0' });

    expect(result.lines[0].adjustedTotal).toBe('0.00');
    expect(result.lines[0].effectiveTotal).toBe('0.00');
  });

  it('never adjusts a non-KG line, even if a value is posted for it', () => {
    const packed = line({ id: 'oi_2', unitType: UnitType.GRAM, unitValue: '500.000', lineTotal: '25.00' });
    const result = settleLines([packed], { oi_2: '0.400' });

    expect(result.lines[0].adjustedTotal).toBeNull();
    expect(result.lines[0].effectiveTotal).toBe('25.00');
  });

  it('sums a mixed basket', () => {
    const result = settleLines(
      [
        line({ id: 'oi_1', unitPrice: '45.00', unitValue: '1.000', quantity: 2, lineTotal: '90.00' }),
        line({ id: 'oi_2', unitType: UnitType.PIECE, unitValue: '12.000', unitPrice: '60.00', quantity: 1, lineTotal: '60.00' }),
      ],
      { oi_1: '1.800' }
    );

    expect(result.itemsTotal).toBe('141.00');
  });
});

describe('finalTotalFor', () => {
  it('adds the fee that was quoted, not one recomputed from the new total', () => {
    // Ordered Rs 520 so delivery was waived; actual weights come to Rs 480.
    // Re-running the threshold would charge Rs 30 the customer was told they
    // had avoided, because the shop's scale read light.
    expect(finalTotalFor('480.00', '0.00')).toBe('480.00');
  });

  it('keeps a fee that was charged', () => {
    expect(finalTotalFor('210.50', '30.00')).toBe('240.50');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- settlement`
Expected: FAIL — cannot resolve `./settlement`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/admin/settlement.ts`:

```ts
import { Prisma, UnitType } from '@prisma/client';

/** One order line, as the settlement form receives it. All money is a string. */
export interface SettleableLine {
  id: string;
  productName: string;
  variantLabel: string;
  unitType: UnitType;
  /** Price of one pack, e.g. '160.00' for a 5 kg bag. */
  unitPrice: string;
  /** Pack size in the line's unit, e.g. '5.000'. */
  unitValue: string;
  /** Number of packs ordered. */
  quantity: number;
  lineTotal: string;
}

export interface SettledLine {
  id: string;
  /** Null where nothing was entered, or where the line is not settleable. */
  actualQuantity: string | null;
  adjustedTotal: string | null;
  /** What this line contributes to the final bill: the adjustment, or the original. */
  effectiveTotal: string;
}

/**
 * Only loose produce settles.
 *
 * A "500 g" pack is 500 g because that is what is printed on it; re-weighing it
 * at the door would be re-negotiating a fixed price. A zero pack size is
 * excluded because the per-unit rate divides by it — a bad row should drop out
 * of settlement, not take the delivery down with it.
 */
export function isSettleable(line: SettleableLine): boolean {
  return line.unitType === UnitType.KG && !new Prisma.Decimal(line.unitValue).isZero();
}

/** What the customer ordered, in the line's unit — the input's starting value. */
export function orderedQuantity(line: SettleableLine): string {
  return new Prisma.Decimal(line.unitValue).mul(line.quantity).toFixed(3);
}

/**
 * The rate the adjustment is priced at.
 *
 * The stored price is per pack, so a 5 kg bag at Rs 160 has to become Rs 32/kg
 * before a 4.7 kg delivery can be priced. Treating the pack price as a per-kilo
 * price would bill Rs 752 for that bag.
 */
function pricePerUnit(line: SettleableLine): Prisma.Decimal {
  return new Prisma.Decimal(line.unitPrice).div(line.unitValue);
}

/**
 * Applies the weights the owner entered at the door.
 *
 * A missing entry means "as ordered" and leaves the line untouched — the owner
 * only types into the boxes that changed, and reading a blank box as zero would
 * quietly zero out every line he skipped. An explicit '0' is different, and is
 * honoured: it is how an item that never made it onto the van gets recorded.
 */
export function settleLines(
  lines: SettleableLine[],
  actualByLineId: Record<string, string>
): { lines: SettledLine[]; itemsTotal: string } {
  let itemsTotal = new Prisma.Decimal(0);

  const settled = lines.map((line): SettledLine => {
    const raw = actualByLineId[line.id];
    const entered = raw !== undefined && raw !== '';

    if (!isSettleable(line) || !entered) {
      itemsTotal = itemsTotal.add(line.lineTotal);
      return { id: line.id, actualQuantity: null, adjustedTotal: null, effectiveTotal: line.lineTotal };
    }

    const actual = new Prisma.Decimal(raw);
    const adjustedTotal = actual.mul(pricePerUnit(line)).toFixed(2);
    itemsTotal = itemsTotal.add(adjustedTotal);

    return {
      id: line.id,
      actualQuantity: actual.toFixed(3),
      adjustedTotal,
      effectiveTotal: adjustedTotal,
    };
  });

  return { lines: settled, itemsTotal: itemsTotal.toFixed(2) };
}

/**
 * What the driver collects.
 *
 * The delivery fee is the one stored on the order, never a fresh
 * `calculateTotals()` against the adjusted items total. A basket that earned
 * free delivery at Rs 520 keeps it even when the scales bring it to Rs 480:
 * charging for delivery after the fact, because the shop's weighing went the
 * shop's way, is not a bill anyone can defend at a doorstep.
 */
export function finalTotalFor(adjustedItemsTotal: string, storedDeliveryFee: string): string {
  return new Prisma.Decimal(adjustedItemsTotal).add(storedDeliveryFee).toFixed(2);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- settlement`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/settlement.ts src/lib/admin/settlement.test.ts
git commit -m "feat: price a delivered order against the weights actually delivered

Kept free of the database so the arithmetic that decides what a customer pays
can be tested exhaustively without one.

Two rules are worth stating outright. The rate comes from unitPrice/unitValue,
so a 5 kg bag at Rs 160 settles at Rs 32/kg and a 4.7 kg delivery bills Rs
150.40 rather than Rs 752. And the delivery fee is the one already stored on
the order: a basket that earned free delivery at Rs 520 keeps it when the
scales bring it to Rs 480, because charging for delivery afterwards, on the
strength of the shop's own weighing, is indefensible at a doorstep.

A blank input means 'as ordered'; an explicit zero means the item never made it
onto the van. Collapsing those two would silently zero every line the owner
skipped."
```

---

### Task 4: The read layer

**Files:**
- Create: `src/lib/admin/order-queries.ts`
- Test: `src/lib/admin/order-queries.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface DeliveryAddressSnapshot { label, line1, line2, landmark, city, pincode, phone, name }` — all `string | null` except `line1`, `city`, `pincode`
  - `interface AdminOrderItemRow` — the `SettleableLine` fields plus `actualQuantity: string | null`, `adjustedTotal: string | null`
  - `interface AdminOrderRow { id, orderNumber, status, paymentMethod, paymentStatus, placedAt, itemsTotal, deliveryFee, grandTotal, finalTotal, customerNote, adminNote, address, slot: { id, date, slotType }, items }`
  - `interface SlotPickingList { date, slotType, orderCount, aggregate: PickLine[], orders: PackSlip[] }`
  - `listAdminOrders(filters: { date?: string; slotType?: SlotType; status?: OrderStatus }): Promise<AdminOrderRow[]>`
  - `getSlotPickingList(date: string, slotType: SlotType): Promise<SlotPickingList>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin/order-queries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { order: { findMany: vi.fn() } },
}));

import { Prisma, OrderStatus, PaymentMethod, PaymentStatus, SlotType, UnitType } from '@prisma/client';
import { db } from '@/lib/db';
import { listAdminOrders, getSlotPickingList } from './order-queries';

const ADDRESS = {
  label: 'Home',
  line1: '12 MG Road',
  line2: null,
  landmark: 'near temple',
  city: 'Bengaluru',
  pincode: '560001',
  phone: '+919876543210',
  name: 'Ramesh',
};

function itemRow(overrides = {}) {
  return {
    id: 'oi_1',
    productName: 'Onion',
    variantLabel: '1 kg',
    unitType: UnitType.KG,
    unitPrice: new Prisma.Decimal('45'),
    unitValue: new Prisma.Decimal('1'),
    quantity: 2,
    lineTotal: new Prisma.Decimal('90'),
    actualQuantity: null,
    adjustedTotal: null,
    ...overrides,
  };
}

function orderRow(overrides = {}) {
  return {
    id: 'o_1',
    orderNumber: 'KD-1042',
    status: OrderStatus.CONFIRMED,
    paymentMethod: PaymentMethod.COD,
    paymentStatus: PaymentStatus.UNPAID,
    placedAt: new Date('2026-08-10T08:47:00Z'),
    itemsTotal: new Prisma.Decimal('90'),
    deliveryFee: new Prisma.Decimal('30'),
    grandTotal: new Prisma.Decimal('120'),
    finalTotal: null,
    customerNote: null,
    adminNote: null,
    deliveryAddress: ADDRESS,
    slot: { id: 's_1', date: new Date('2026-08-11T00:00:00Z'), slotType: SlotType.MORNING },
    items: [itemRow()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(db.order.findMany).mockReset();
});

describe('listAdminOrders', () => {
  it('serialises every Decimal to a string, because a client component cannot receive one', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([orderRow()] as never);

    const [row] = await listAdminOrders({});

    expect(row.grandTotal).toBe('120.00');
    expect(row.items[0].unitPrice).toBe('45.00');
    expect(row.items[0].unitValue).toBe('1.000');
    expect(row.finalTotal).toBeNull();
    expect(typeof row.placedAt).toBe('string');
  });

  it('reads the customer from the address snapshot taken at checkout', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([orderRow()] as never);

    const [row] = await listAdminOrders({});

    // The snapshot is what the driver has to work with. The customer may have
    // edited or deleted the saved address since.
    expect(row.address.name).toBe('Ramesh');
    expect(row.address.phone).toBe('+919876543210');
  });

  it('filters by date, slot and status together', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([] as never);

    await listAdminOrders({
      date: '2026-08-11',
      slotType: SlotType.MORNING,
      status: OrderStatus.CONFIRMED,
    });

    const where = vi.mocked(db.order.findMany).mock.calls[0][0].where;
    expect(where.status).toBe(OrderStatus.CONFIRMED);
    expect(where.slot).toEqual({
      date: new Date('2026-08-11T00:00:00.000Z'),
      slotType: SlotType.MORNING,
    });
  });

  it('applies no filters when none are given', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([] as never);

    await listAdminOrders({});

    expect(vi.mocked(db.order.findMany).mock.calls[0][0].where).toEqual({});
  });
});

describe('getSlotPickingList', () => {
  it('totals the same product across orders for the stock-pull sheet', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([
      orderRow({ id: 'o_1', orderNumber: 'KD-1042', items: [itemRow({ id: 'oi_1', quantity: 2 })] }),
      orderRow({ id: 'o_2', orderNumber: 'KD-1043', items: [itemRow({ id: 'oi_2', quantity: 3 })] }),
    ] as never);

    const list = await getSlotPickingList('2026-08-11', SlotType.MORNING);

    expect(list.aggregate).toEqual([
      { productName: 'Onion', variantLabel: '1 kg', quantity: 5 },
    ]);
    expect(list.orderCount).toBe(2);
  });

  it('keeps different sizes of one product apart', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([
      orderRow({
        items: [
          itemRow({ id: 'oi_1', variantLabel: '1 kg', quantity: 2 }),
          itemRow({ id: 'oi_2', variantLabel: '5 kg', quantity: 1 }),
        ],
      }),
    ] as never);

    const list = await getSlotPickingList('2026-08-11', SlotType.MORNING);

    expect(list.aggregate).toHaveLength(2);
  });

  it('tells the driver what to collect on a cash order and nothing on a paid one', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([
      orderRow({ id: 'o_1', paymentMethod: PaymentMethod.COD }),
      orderRow({
        id: 'o_2',
        paymentMethod: PaymentMethod.ONLINE,
        paymentStatus: PaymentStatus.PAID,
      }),
    ] as never);

    const list = await getSlotPickingList('2026-08-11', SlotType.MORNING);

    expect(list.orders[0].amountToCollect).toBe('120.00');
    expect(list.orders[1].amountToCollect).toBeNull();
  });

  it('only lists orders that are actually due to be packed', async () => {
    vi.mocked(db.order.findMany).mockResolvedValue([] as never);

    await getSlotPickingList('2026-08-11', SlotType.MORNING);

    const where = vi.mocked(db.order.findMany).mock.calls[0][0].where;
    // An unconfirmed or cancelled order must never reach the packing bench.
    expect(where.status).toEqual({ in: [OrderStatus.CONFIRMED, OrderStatus.PACKED] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- order-queries`
Expected: FAIL — cannot resolve `./order-queries`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/admin/order-queries.ts`:

```ts
import { OrderStatus, PaymentMethod, PaymentStatus, SlotType, UnitType } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';

/**
 * The address as it was at checkout.
 *
 * Stored as JSON on the order rather than a reference, because the customer may
 * edit or delete the saved address afterwards and the driver still has to find
 * the door. Name and phone ride along for the same reason.
 */
export interface DeliveryAddressSnapshot {
  label: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  pincode: string;
  phone: string | null;
  name: string | null;
}

export interface AdminOrderItemRow {
  id: string;
  productName: string;
  variantLabel: string;
  unitType: UnitType;
  unitPrice: string;
  unitValue: string;
  quantity: number;
  lineTotal: string;
  actualQuantity: string | null;
  adjustedTotal: string | null;
}

export interface AdminOrderRow {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** ISO string; a Date cannot cross into a client component. */
  placedAt: string;
  itemsTotal: string;
  deliveryFee: string;
  grandTotal: string;
  finalTotal: string | null;
  customerNote: string | null;
  adminNote: string | null;
  address: DeliveryAddressSnapshot;
  slot: { id: string; date: string; slotType: SlotType };
  items: AdminOrderItemRow[];
}

export interface PickLine {
  productName: string;
  variantLabel: string;
  quantity: number;
}

export interface PackSlip {
  orderNumber: string;
  address: DeliveryAddressSnapshot;
  paymentMethod: PaymentMethod;
  /** What the driver collects, or null when it is already paid for. */
  amountToCollect: string | null;
  customerNote: string | null;
  items: PickLine[];
}

export interface SlotPickingList {
  date: string;
  slotType: SlotType;
  orderCount: number;
  aggregate: PickLine[];
  orders: PackSlip[];
}

const ORDER_INCLUDE = {
  items: true,
  slot: { select: { id: true, date: true, slotType: true } },
} as const;

/** A `@db.Date` column means a calendar day, so it is matched at UTC midnight. */
function calendarDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toAddress(raw: unknown): DeliveryAddressSnapshot {
  const value = (raw ?? {}) as Record<string, unknown>;
  const text = (key: string): string | null =>
    typeof value[key] === 'string' && value[key] !== '' ? (value[key] as string) : null;

  return {
    label: text('label'),
    line1: text('line1') ?? '',
    line2: text('line2'),
    landmark: text('landmark'),
    city: text('city') ?? '',
    pincode: text('pincode') ?? '',
    phone: text('phone'),
    name: text('name'),
  };
}

type ItemRecord = {
  id: string;
  productName: string;
  variantLabel: string;
  unitType: UnitType;
  unitPrice: { toFixed(dp: number): string };
  unitValue: { toFixed(dp: number): string };
  quantity: number;
  lineTotal: { toFixed(dp: number): string };
  actualQuantity: { toFixed(dp: number): string } | null;
  adjustedTotal: { toFixed(dp: number): string } | null;
};

function toItemRow(item: ItemRecord): AdminOrderItemRow {
  return {
    id: item.id,
    productName: item.productName,
    variantLabel: item.variantLabel,
    unitType: item.unitType,
    unitPrice: item.unitPrice.toFixed(2),
    unitValue: item.unitValue.toFixed(3),
    quantity: item.quantity,
    lineTotal: item.lineTotal.toFixed(2),
    actualQuantity: item.actualQuantity?.toFixed(3) ?? null,
    adjustedTotal: item.adjustedTotal?.toFixed(2) ?? null,
  };
}

/**
 * Orders for the admin list, newest first.
 *
 * Returns plain serialisable shapes with every Decimal already a string, the
 * same contract as `shop-queries.ts` — React cannot pass a Decimal or a Date
 * into a client component, and converting at the page would put that knowledge
 * in every caller.
 */
export async function listAdminOrders(filters: {
  date?: string;
  slotType?: SlotType;
  status?: OrderStatus;
}): Promise<AdminOrderRow[]> {
  const slot = {
    ...(filters.date ? { date: calendarDay(filters.date) } : {}),
    ...(filters.slotType ? { slotType: filters.slotType } : {}),
  };

  const orders = await withDbRetry(() =>
    db.order.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(Object.keys(slot).length > 0 ? { slot } : {}),
      },
      include: ORDER_INCLUDE,
      orderBy: { placedAt: 'desc' },
    })
  );

  return orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    placedAt: order.placedAt.toISOString(),
    itemsTotal: order.itemsTotal.toFixed(2),
    deliveryFee: order.deliveryFee.toFixed(2),
    grandTotal: order.grandTotal.toFixed(2),
    finalTotal: order.finalTotal?.toFixed(2) ?? null,
    customerNote: order.customerNote,
    adminNote: order.adminNote,
    address: toAddress(order.deliveryAddress),
    slot: {
      id: order.slot.id,
      date: order.slot.date.toISOString(),
      slotType: order.slot.slotType,
    },
    items: order.items.map(toItemRow),
  }));
}

/**
 * Everything one slot's packing run needs, in one query.
 *
 * Two renderings of the same rows: a stock-pull total the owner sources
 * against, then a slip per order to fill bags from. Sourcing and packing are
 * different jobs, and the packer should not need a screen for the second.
 */
export async function getSlotPickingList(
  date: string,
  slotType: SlotType
): Promise<SlotPickingList> {
  const orders = await withDbRetry(() =>
    db.order.findMany({
      where: {
        // An unconfirmed or cancelled order must never reach the packing bench.
        status: { in: [OrderStatus.CONFIRMED, OrderStatus.PACKED] },
        slot: { date: calendarDay(date), slotType },
      },
      include: ORDER_INCLUDE,
      orderBy: { orderNumber: 'asc' },
    })
  );

  const totals = new Map<string, PickLine>();
  for (const order of orders) {
    for (const item of order.items) {
      const key = `${item.productName} ${item.variantLabel}`;
      const existing = totals.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        totals.set(key, {
          productName: item.productName,
          variantLabel: item.variantLabel,
          quantity: item.quantity,
        });
      }
    }
  }

  return {
    date,
    slotType,
    orderCount: orders.length,
    aggregate: [...totals.values()].sort(
      (a, b) =>
        a.productName.localeCompare(b.productName) ||
        a.variantLabel.localeCompare(b.variantLabel)
    ),
    orders: orders.map((order) => ({
      orderNumber: order.orderNumber,
      address: toAddress(order.deliveryAddress),
      paymentMethod: order.paymentMethod,
      // Already-paid orders show nothing rather than zero: a number on the slip
      // is an instruction to collect it.
      amountToCollect:
        order.paymentStatus === PaymentStatus.PAID
          ? null
          : (order.finalTotal ?? order.grandTotal).toFixed(2),
      customerNote: order.customerNote,
      items: order.items.map((item) => ({
        productName: item.productName,
        variantLabel: item.variantLabel,
        quantity: item.quantity,
      })),
    })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- order-queries`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/admin/order-queries.ts src/lib/admin/order-queries.test.ts
git commit -m "feat: read orders and picking lists for the admin screens

Same contract as shop-queries: plain shapes, every Decimal already a string,
every Date an ISO string, because neither survives the trip into a client
component and converting at the page would spread that knowledge across every
caller.

The picking list is one query rendered twice — a stock-pull total to source
against, then a slip per order to fill bags from. It is restricted to CONFIRMED
and PACKED so nothing unconfirmed or cancelled reaches the packing bench, and a
prepaid order shows no amount at all, since a number on the slip reads as an
instruction to collect it."
```

---

### Task 5: The Server Actions

**Files:**
- Create: `src/app/(admin)/admin/orders/actions.ts`
- Test: `src/app/(admin)/admin/orders/actions.test.ts`

**Interfaces:**
- Consumes: `nextStatus`, `canCancel` (Task 2); `settleLines`, `finalTotalFor`, `SettleableLine` (Task 3); `releaseSlot` from `@/lib/slots`; `requireAdmin`, `toActionError`, `ActionResult`
- Produces:
  - `advanceOrderStatus(orderId: string, from: OrderStatus): Promise<ActionResult>`
  - `cancelOrder(orderId: string, reason: string): Promise<ActionResult>`
  - `settleAndDeliver(orderId: string, actuals: Record<string, string>): Promise<ActionResult>`

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/admin/orders/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = {
  order: { updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  orderItem: { update: vi.fn() },
  orderEvent: { create: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  db: {
    order: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock('@/lib/slots', () => ({ releaseSlot: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Prisma, OrderStatus, PaymentMethod, PaymentStatus, UnitType } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin, NotAdminError } from '@/lib/admin-auth';
import { releaseSlot } from '@/lib/slots';
import { advanceOrderStatus, cancelOrder, settleAndDeliver } from './actions';

function orderRow(overrides = {}) {
  return {
    id: 'o_1',
    slotId: 's_1',
    status: OrderStatus.OUT_FOR_DELIVERY,
    paymentMethod: PaymentMethod.COD,
    paymentStatus: PaymentStatus.UNPAID,
    deliveryFee: new Prisma.Decimal('30'),
    grandTotal: new Prisma.Decimal('120'),
    items: [
      {
        id: 'oi_1',
        productName: 'Potato',
        variantLabel: '5 kg',
        unitType: UnitType.KG,
        unitPrice: new Prisma.Decimal('160'),
        unitValue: new Prisma.Decimal('5'),
        quantity: 1,
        lineTotal: new Prisma.Decimal('160'),
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ userId: 'admin_1', role: 'ADMIN' });
  vi.mocked(releaseSlot).mockReset();
  vi.mocked(db.order.findUnique).mockReset();
  tx.order.updateMany.mockReset().mockResolvedValue({ count: 1 });
  tx.order.update.mockReset();
  tx.orderItem.update.mockReset();
  tx.orderEvent.create.mockReset();
});

describe('advanceOrderStatus', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    const result = await advanceOrderStatus('o_1', OrderStatus.CONFIRMED);

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('moves the order one step and records it', async () => {
    const result = await advanceOrderStatus('o_1', OrderStatus.CONFIRMED);

    expect(result.ok).toBe(true);
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o_1', status: OrderStatus.CONFIRMED },
      data: { status: OrderStatus.PACKED },
    });
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'o_1', status: OrderStatus.PACKED, actorId: 'admin_1', note: null },
    });
  });

  it('refuses to advance an order awaiting its OTP', async () => {
    const result = await advanceOrderStatus('o_1', OrderStatus.PENDING_OTP);

    expect(result.ok).toBe(false);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('reports a lost race instead of writing a second event', async () => {
    // Two tabs open on one order is ordinary in a shop. The conditional write
    // matches nothing the second time, and that is the whole answer.
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    const result = await advanceOrderStatus('o_1', OrderStatus.CONFIRMED);

    expect(result).toEqual({ ok: false, error: 'This order was already updated. Refresh to see where it is.' });
    expect(tx.orderEvent.create).not.toHaveBeenCalled();
  });

  it('sends a delivery to settlement rather than writing DELIVERED directly', async () => {
    const result = await advanceOrderStatus('o_1', OrderStatus.OUT_FOR_DELIVERY);

    expect(result.ok).toBe(false);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
});

describe('cancelOrder', () => {
  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    const result = await cancelOrder('o_1', 'Customer called');

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
  });

  it('cancels and gives the delivery place back', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ status: OrderStatus.CONFIRMED }) as never
    );

    const result = await cancelOrder('o_1', 'Out of stock');

    expect(result.ok).toBe(true);
    expect(releaseSlot).toHaveBeenCalledWith('s_1', tx);
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'o_1', status: OrderStatus.CANCELLED, actorId: 'admin_1', note: 'Out of stock' },
    });
  });

  it('will not cancel a delivered order', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ status: OrderStatus.DELIVERED }) as never
    );

    const result = await cancelOrder('o_1', 'Too late');

    expect(result.ok).toBe(false);
    expect(releaseSlot).not.toHaveBeenCalled();
  });

  it('does not release the slot twice when the order is already cancelled', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ status: OrderStatus.CONFIRMED }) as never
    );
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    const result = await cancelOrder('o_1', 'Duplicate click');

    expect(result.ok).toBe(false);
    expect(releaseSlot).not.toHaveBeenCalled();
  });
});

describe('settleAndDeliver', () => {
  beforeEach(() => {
    vi.mocked(db.order.findUnique).mockResolvedValue(orderRow() as never);
  });

  it('requires an admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());

    const result = await settleAndDeliver('o_1', { oi_1: '4.700' });

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('writes the adjusted line and the final total', async () => {
    const result = await settleAndDeliver('o_1', { oi_1: '4.700' });

    expect(result.ok).toBe(true);
    expect(tx.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'oi_1' },
      data: { actualQuantity: '4.700', adjustedTotal: '150.40' },
    });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o_1' },
        data: expect.objectContaining({
          status: OrderStatus.DELIVERED,
          finalTotal: '180.40',
        }),
      })
    );
  });

  it('marks a cash order paid, because the driver collected', async () => {
    await settleAndDeliver('o_1', { oi_1: '4.700' });

    const data = tx.order.update.mock.calls[0][0].data;
    expect(data.paymentStatus).toBe(PaymentStatus.PAID);
    expect(data.deliveredAt).toBeInstanceOf(Date);
  });

  it('leaves an online order alone, absorbing the difference', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ paymentMethod: PaymentMethod.ONLINE, paymentStatus: PaymentStatus.PAID }) as never
    );

    await settleAndDeliver('o_1', { oi_1: '4.700' });

    expect(tx.order.update.mock.calls[0][0].data.paymentStatus).toBeUndefined();
  });

  it('only settles an order that is out for delivery', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ status: OrderStatus.PACKED }) as never
    );

    const result = await settleAndDeliver('o_1', { oi_1: '4.700' });

    expect(result.ok).toBe(false);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('writes a final total even when nothing was adjusted', async () => {
    // A uniformly populated column keeps the revenue query a plain sum.
    const result = await settleAndDeliver('o_1', {});

    expect(result.ok).toBe(true);
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.order.update.mock.calls[0][0].data.finalTotal).toBe('190.00');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- "orders/actions"`
Expected: FAIL — cannot resolve `./actions`.

- [ ] **Step 3: Write the implementation**

Create `src/app/(admin)/admin/orders/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { requireAdmin } from '@/lib/admin-auth';
import { releaseSlot } from '@/lib/slots';
import { toActionError, type ActionResult } from '@/lib/actions';
import { nextStatus, canCancel } from '@/lib/admin/order-status';
import { settleLines, finalTotalFor, type SettleableLine } from '@/lib/admin/settlement';

/** Shown whenever a conditional write matches nothing. */
const LOST_RACE = 'This order was already updated. Refresh to see where it is.';

function refresh() {
  revalidatePath('/admin/orders');
  revalidatePath('/admin');
}

/**
 * Moves an order one step along the pipeline.
 *
 * `from` is not decoration. Read-then-write lets two open tabs both see PACKED,
 * both decide the next state is OUT_FOR_DELIVERY, and both write an event — a
 * history showing the order dispatched twice. Making the current status part of
 * the WHERE closes that window inside the write itself, exactly as `bookSlot`
 * does for slot capacity, and a count of zero is the complete answer.
 */
export async function advanceOrderStatus(
  orderId: string,
  from: OrderStatus
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const to = nextStatus(from);
    if (!to) return { ok: false, error: 'This order cannot be advanced from here' };

    // Delivery is not a status change, it is a settlement. Going through this
    // path would skip deciding what the driver collects.
    if (to === OrderStatus.DELIVERED) {
      return { ok: false, error: 'Use the delivery form to settle and close this order' };
    }

    const outcome = await withDbRetry(() =>
      db.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: orderId, status: from },
          data: { status: to },
        });

        if (count === 0) return false;

        await tx.orderEvent.create({
          data: { orderId, status: to, actorId: admin.userId, note: null },
        });
        return true;
      })
    );

    if (!outcome) return { ok: false, error: LOST_RACE };

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'advanceOrderStatus');
  }
}

const reasonSchema = z.string().trim().min(1, 'Give a reason').max(200);

/**
 * Cancels an order and returns its delivery place.
 *
 * The release shares the cancellation's transaction so the van can never keep a
 * seat reserved for an order that no longer exists, and it is reached only when
 * the conditional write actually moved the row — otherwise a double-click would
 * hand the same place back twice and the slot would accept orders forever.
 */
export async function cancelOrder(orderId: string, reason: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const note = reasonSchema.parse(reason);

    const order = await withDbRetry(() =>
      db.order.findUnique({ where: { id: orderId }, select: { status: true, slotId: true } })
    );
    if (!order) return { ok: false, error: 'Order not found' };
    if (!canCancel(order.status)) {
      return { ok: false, error: 'This order is already finished and cannot be cancelled' };
    }

    const outcome = await withDbRetry(() =>
      db.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: orderId, status: order.status },
          data: { status: OrderStatus.CANCELLED, cancelReason: note },
        });

        if (count === 0) return false;

        await tx.orderEvent.create({
          data: { orderId, status: OrderStatus.CANCELLED, actorId: admin.userId, note },
        });
        await releaseSlot(order.slotId, tx);
        return true;
      })
    );

    if (!outcome) return { ok: false, error: LOST_RACE };

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'cancelOrder');
  }
}

const actualsSchema = z.record(
  z.string(),
  z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'Enter a weight like 4.7')
);

/**
 * Closes a delivered order at the weights actually delivered.
 *
 * `finalTotal` is written on every order that reaches here, including one with
 * nothing to adjust, so the revenue figures stay a plain sum rather than a
 * `finalTotal ?? grandTotal` repeated at every call site.
 *
 * Cash flips to PAID because the driver has the money — nothing else in the
 * codebase moves a COD order out of UNPAID. An online order is already paid and
 * absorbs the difference: §4.6 of the design doc is explicit that partial-refund
 * automation for small discrepancies is not worth building.
 */
export async function settleAndDeliver(
  orderId: string,
  actuals: Record<string, string>
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const entered = actualsSchema.parse(actuals);

    const order = await withDbRetry(() =>
      db.order.findUnique({ where: { id: orderId }, include: { items: true } })
    );
    if (!order) return { ok: false, error: 'Order not found' };
    if (order.status !== OrderStatus.OUT_FOR_DELIVERY) {
      return { ok: false, error: 'Only an order that is out for delivery can be settled' };
    }

    const lines: SettleableLine[] = order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      variantLabel: item.variantLabel,
      unitType: item.unitType,
      unitPrice: item.unitPrice.toFixed(2),
      unitValue: item.unitValue.toFixed(3),
      quantity: item.quantity,
      lineTotal: item.lineTotal.toFixed(2),
    }));

    const settled = settleLines(lines, entered);
    const finalTotal = finalTotalFor(settled.itemsTotal, order.deliveryFee.toFixed(2));

    const outcome = await withDbRetry(() =>
      db.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: orderId, status: OrderStatus.OUT_FOR_DELIVERY },
          data: { status: OrderStatus.DELIVERED },
        });

        if (count === 0) return false;

        for (const line of settled.lines) {
          if (line.adjustedTotal === null) continue;
          await tx.orderItem.update({
            where: { id: line.id },
            data: { actualQuantity: line.actualQuantity, adjustedTotal: line.adjustedTotal },
          });
        }

        await tx.order.update({
          where: { id: orderId },
          data: {
            finalTotal,
            deliveredAt: new Date(),
            ...(order.paymentMethod === PaymentMethod.COD
              ? { paymentStatus: PaymentStatus.PAID }
              : {}),
          },
        });

        await tx.orderEvent.create({
          data: {
            orderId,
            status: OrderStatus.DELIVERED,
            actorId: admin.userId,
            note: `Settled at ${finalTotal}`,
          },
        });
        return true;
      })
    );

    if (!outcome) return { ok: false, error: LOST_RACE };

    refresh();
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'settleAndDeliver');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- "orders/actions"`
Expected: PASS, 14 tests.

Note on the expected numbers: the fixture is one 5 kg line at ₹160 with a ₹30 fee. Settled at 4.7 kg it is `4.7 × 32 = 150.40`, so `finalTotal` is `180.40`. Unsettled it stays `160.00 + 30.00 = 190.00`.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add "src/app/(admin)/admin/orders/actions.ts" "src/app/(admin)/admin/orders/actions.test.ts"
git commit -m "feat: advance, cancel and settle orders from admin

Every status write is conditional on the status it is moving from. Read then
write lets two open tabs both see PACKED, both decide OUT_FOR_DELIVERY comes
next, and both write an event, leaving a history that shows the order
dispatched twice. Putting the current status in the WHERE closes that inside
the write, the same way bookSlot does for capacity, and a count of zero is the
whole answer. Cancel reaches releaseSlot only through that gate, so a
double-click cannot hand the same delivery place back twice.

Settlement marks cash orders PAID, since the driver is holding the money and
nothing else in the codebase moves a COD order out of UNPAID. Online orders are
left alone to absorb the difference, per section 4.6."
```

---

### Task 6: The orders list screen

**Files:**
- Modify: `src/app/(admin)/admin/orders/page.tsx` (replace the 8-line stub)
- Create: `src/app/(admin)/admin/orders/order-row.tsx`
- Create: `src/app/(admin)/admin/orders/order-filters.tsx`
- Test: none — these are `.tsx` and the runner only collects `src/**/*.test.ts`. The logic they call is covered by Tasks 2–5.

**Interfaces:**
- Consumes: `listAdminOrders`, `AdminOrderRow` (Task 4); `advanceOrderStatus`, `cancelOrder` (Task 5); `advanceLabel`, `canCancel`, `nextStatus` (Task 2); `formatRupees`, `formatSlotType`, `formatSlotDate` from `@/lib/format`
- Produces: the `/admin/orders` route

- [ ] **Step 1: Build the filter bar**

Create `src/app/(admin)/admin/orders/order-filters.tsx`. A plain form that GETs back to the same page, so filter state lives in the URL and a filtered view can be bookmarked or reloaded:

```tsx
import { OrderStatus, SlotType } from '@prisma/client';

export function OrderFilters({
  date,
  slotType,
  status,
}: {
  date?: string;
  slotType?: string;
  status?: string;
}) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 block text-gray-600">Date</span>
        <input type="date" name="date" defaultValue={date} className="rounded border px-2 py-1" />
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-gray-600">Slot</span>
        <select name="slot" defaultValue={slotType ?? ''} className="rounded border px-2 py-1">
          <option value="">All slots</option>
          {Object.values(SlotType).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-gray-600">Status</span>
        <select name="status" defaultValue={status ?? ''} className="rounded border px-2 py-1">
          <option value="">All statuses</option>
          {Object.values(OrderStatus).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>

      <button type="submit" className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white">
        Apply
      </button>
      <a href="/admin/orders" className="px-2 py-1.5 text-sm text-gray-600 underline">Clear</a>
    </form>
  );
}
```

- [ ] **Step 2: Build the expandable row**

Create `src/app/(admin)/admin/orders/order-row.tsx`. Client component — it owns the open/closed state and calls the actions:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { OrderStatus } from '@prisma/client';
import type { AdminOrderRow } from '@/lib/admin/order-queries';
import { advanceLabel, canCancel, nextStatus } from '@/lib/admin/order-status';
import { advanceOrderStatus, cancelOrder } from './actions';
import { formatRupees, formatSlotDate, formatSlotType } from '@/lib/format';
import { SettleForm } from './settle-form';

export function OrderRow({ order }: { order: AdminOrderRow }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const label = advanceLabel(order.status);
  const settling = nextStatus(order.status) === OrderStatus.DELIVERED;

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Something went wrong');
      else router.refresh();
    });
  }

  return (
    <li className="border-b py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setOpen(!open)} className="font-medium underline">
          {order.orderNumber}
        </button>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{order.status}</span>
        <span className="text-sm text-gray-600">
          {formatSlotDate(order.slot.date)} · {formatSlotType(order.slot.slotType)}
        </span>
        <span className="text-sm">{formatRupees(order.finalTotal ?? order.grandTotal)}</span>
        <span className="text-sm text-gray-600">
          {order.paymentMethod} · {order.paymentStatus}
        </span>

        <span className="ml-auto flex gap-2">
          {label && !settling && (
            <button
              disabled={pending}
              onClick={() => run(() => advanceOrderStatus(order.id, order.status))}
              className="rounded bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {label}
            </button>
          )}
          {canCancel(order.status) && (
            <button
              disabled={pending}
              onClick={() => {
                const reason = window.prompt('Why is this order being cancelled?');
                if (reason) run(() => cancelOrder(order.id, reason));
              }}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </span>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {open && (
        <div className="mt-3 grid gap-4 rounded bg-gray-50 p-3 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-medium">Items</h3>
            <ul className="text-sm">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-4">
                  <span>
                    {item.productName} · {item.variantLabel} × {item.quantity}
                    {item.actualQuantity && (
                      <em className="ml-1 text-gray-600">(delivered {item.actualQuantity})</em>
                    )}
                  </span>
                  <span>{formatRupees(item.adjustedTotal ?? item.lineTotal)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="text-sm">
            <h3 className="mb-1 font-medium">Deliver to</h3>
            <p>{order.address.name}</p>
            <p>{order.address.phone}</p>
            <p>
              {order.address.line1}
              {order.address.line2 ? `, ${order.address.line2}` : ''}
            </p>
            {order.address.landmark && <p>near {order.address.landmark}</p>}
            <p>
              {order.address.city} {order.address.pincode}
            </p>
            {order.customerNote && <p className="mt-2 italic">“{order.customerNote}”</p>}
          </div>

          {settling && <SettleForm order={order} onDone={() => router.refresh()} />}
        </div>
      )}
    </li>
  );
}
```

`SettleForm` is built in Task 7. Until then this file will not typecheck — that is expected, and Task 7 closes it. If you prefer a green tree between tasks, add a one-line placeholder component in `settle-form.tsx` now and replace it in Task 7.

- [ ] **Step 3: Replace the page stub**

Replace `src/app/(admin)/admin/orders/page.tsx` entirely:

```tsx
import { OrderStatus, SlotType } from '@prisma/client';
import { listAdminOrders } from '@/lib/admin/order-queries';
import { OrderFilters } from './order-filters';
import { OrderRow } from './order-row';

export const dynamic = 'force-dynamic';

/** Reads a query param only if it is a real member of the enum. */
function asEnum<T extends Record<string, string>>(
  values: T,
  raw: string | undefined
): T[keyof T] | undefined {
  return raw && Object.values(values).includes(raw) ? (raw as T[keyof T]) : undefined;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; slot?: string; status?: string }>;
}) {
  const params = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date : undefined;

  const orders = await listAdminOrders({
    date,
    slotType: asEnum(SlotType, params.slot),
    status: asEnum(OrderStatus, params.status),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Orders</h1>
        <a href="/admin/orders/picking" className="text-sm underline">
          Picking list
        </a>
      </div>

      <OrderFilters date={date} slotType={params.slot} status={params.status} />

      {orders.length === 0 ? (
        <p className="text-sm text-gray-600">No orders match these filters.</p>
      ) : (
        <ul>
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify it builds**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors once Task 7's `settle-form.tsx` exists; all tests still pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/orders"
git commit -m "feat: admin orders list with filters and one-action transitions

Filters live in the URL rather than component state, so a filtered view
survives a reload and can be handed to someone as a link.

The advance button is hidden at OUT_FOR_DELIVERY: that step is a settlement,
not a status change, and it goes through the delivery form instead."
```

---

### Task 7: The settlement form

**Files:**
- Create: `src/app/(admin)/admin/orders/settle-form.tsx`

**Interfaces:**
- Consumes: `settleAndDeliver` (Task 5); `isSettleable`, `orderedQuantity`, `settleLines`, `finalTotalFor` (Task 3); `AdminOrderRow` (Task 4)
- Produces: `<SettleForm order={AdminOrderRow} onDone={() => void} />`

- [ ] **Step 1: Build the form**

Create `src/app/(admin)/admin/orders/settle-form.tsx`. It reuses the same pure functions the action uses, so the total shown while typing and the total written to the database cannot drift:

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import type { AdminOrderRow } from '@/lib/admin/order-queries';
import {
  finalTotalFor,
  isSettleable,
  orderedQuantity,
  settleLines,
  type SettleableLine,
} from '@/lib/admin/settlement';
import { formatRupees } from '@/lib/format';
import { settleAndDeliver } from './actions';

export function SettleForm({ order, onDone }: { order: AdminOrderRow; onDone: () => void }) {
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lines: SettleableLine[] = order.items;

  // The same functions the Server Action calls. Quoting from one code path and
  // charging from another is how a shop ends up honouring a number it never set.
  const preview = useMemo(() => {
    const settled = settleLines(lines, actuals);
    return finalTotalFor(settled.itemsTotal, order.deliveryFee);
  }, [lines, actuals, order.deliveryFee]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await settleAndDeliver(order.id, actuals);
      if (!result.ok) setError(result.error ?? 'Something went wrong');
      else onDone();
    });
  }

  return (
    <div className="md:col-span-2 rounded border border-gray-300 bg-white p-3">
      <h3 className="mb-2 text-sm font-medium">Settle and mark delivered</h3>

      <ul className="mb-3 space-y-2 text-sm">
        {lines.map((line) => (
          <li key={line.id} className="flex items-center gap-3">
            <span className="flex-1">
              {line.productName} · {line.variantLabel} × {line.quantity}
            </span>

            {isSettleable(line) ? (
              <label className="flex items-center gap-2">
                <span className="text-gray-600">delivered</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={orderedQuantity(line)}
                  value={actuals[line.id] ?? ''}
                  onChange={(event) =>
                    setActuals({ ...actuals, [line.id]: event.target.value })
                  }
                  className="w-24 rounded border px-2 py-1 text-right"
                />
                <span className="text-gray-600">kg</span>
              </label>
            ) : (
              <span className="text-gray-500">fixed size</span>
            )}
          </li>
        ))}
      </ul>

      {/* A blank box means "as ordered". The placeholder shows what that is. */}
      <p className="mb-3 text-xs text-gray-500">
        Leave a box empty to bill the quantity ordered. Enter 0 if the item did not go out.
      </p>

      <div className="flex items-center gap-4">
        <span className="text-sm">
          Collect <strong>{formatRupees(preview)}</strong>
          {order.paymentStatus === 'PAID' && ' (already paid online)'}
        </span>
        <button
          disabled={pending}
          onClick={submit}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Mark delivered'}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds and the suite is green**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/orders/settle-form.tsx"
git commit -m "feat: settle weights at the door and close the order

The running total is computed with the same settleLines and finalTotalFor the
Server Action calls. Quoting from one code path and charging from another is
how a shop ends up honouring a number it never set, and this form is read out
loud to a customer while the driver waits.

An empty box bills the quantity ordered and the placeholder shows what that is,
so the owner types only into the lines that actually changed."
```

---

### Task 8: The printable picking list

**Files:**
- Create: `src/app/(admin)/admin/orders/picking/page.tsx`
- Create: `src/app/(admin)/admin/orders/picking/picking-sheet.tsx`

**Interfaces:**
- Consumes: `getSlotPickingList`, `SlotPickingList` (Task 4); `formatSlotDate`, `formatSlotType`, `formatRupees`
- Produces: the `/admin/orders/picking?date=&slot=` route

- [ ] **Step 1: Build the sheet**

Create `src/app/(admin)/admin/orders/picking/picking-sheet.tsx`. A server component — nothing here is interactive:

```tsx
import type { SlotPickingList } from '@/lib/admin/order-queries';
import { formatRupees, formatSlotDate, formatSlotType } from '@/lib/format';

export function PickingSheet({ list }: { list: SlotPickingList }) {
  return (
    <div className="text-sm">
      <header className="mb-4 border-b pb-2">
        <h1 className="text-lg font-semibold">
          {formatSlotType(list.slotType)} · {formatSlotDate(list.date)}
        </h1>
        <p className="text-gray-600">{list.orderCount} orders</p>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold uppercase tracking-wide">Pull from stock</h2>
        <table className="w-full">
          <tbody>
            {list.aggregate.map((line) => (
              <tr key={`${line.productName}-${line.variantLabel}`} className="border-b">
                <td className="py-1">{line.productName}</td>
                <td className="py-1 text-gray-600">{line.variantLabel}</td>
                <td className="py-1 text-right font-medium">× {line.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {list.orders.map((slip) => (
        // Each slip starts a fresh sheet of paper so bags can be filled from
        // one page at a time.
        <section key={slip.orderNumber} className="mb-6 break-before-page border-t pt-3">
          <h2 className="font-semibold">
            {slip.orderNumber} · {slip.address.name} · {slip.address.phone}
          </h2>

          <ul className="my-2">
            {slip.items.map((item) => (
              <li key={`${item.productName}-${item.variantLabel}`} className="py-0.5">
                ☐ {item.productName} · {item.variantLabel} × {item.quantity}
              </li>
            ))}
          </ul>

          <p className="text-gray-700">
            {slip.address.line1}
            {slip.address.line2 ? `, ${slip.address.line2}` : ''}
            {slip.address.landmark ? ` (near ${slip.address.landmark})` : ''} · {slip.address.pincode}
          </p>

          <p className="font-medium">
            {slip.amountToCollect
              ? `${slip.paymentMethod} — collect ${formatRupees(slip.amountToCollect)}`
              : 'Paid online — collect nothing'}
          </p>

          {slip.customerNote && <p className="italic">“{slip.customerNote}”</p>}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build the page**

Create `src/app/(admin)/admin/orders/picking/page.tsx`:

```tsx
import { SlotType } from '@prisma/client';
import { getSlotPickingList } from '@/lib/admin/order-queries';
import { PickingSheet } from './picking-sheet';

export const dynamic = 'force-dynamic';

/** Today in India, as a calendar date — the shop's default packing run. */
function todayInIndia(): string {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export default async function PickingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; slot?: string }>;
}) {
  const params = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : todayInIndia();
  const slotType = Object.values(SlotType).includes(params.slot as SlotType)
    ? (params.slot as SlotType)
    : SlotType.MORNING;

  const list = await getSlotPickingList(date, slotType);

  return (
    <div>
      <form method="get" className="mb-4 flex items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Date</span>
          <input type="date" name="date" defaultValue={date} className="rounded border px-2 py-1" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Slot</span>
          <select name="slot" defaultValue={slotType} className="rounded border px-2 py-1">
            {Object.values(SlotType).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white">
          Show
        </button>
      </form>

      {list.orderCount === 0 ? (
        <p className="text-sm text-gray-600">Nothing to pack for this slot.</p>
      ) : (
        <PickingSheet list={list} />
      )}
    </div>
  );
}
```

The filter bar carries `print:hidden` so it does not appear on paper. The admin sidebar in `src/app/(admin)/admin/layout.tsx` will still print; if that proves annoying in practice, add `print:hidden` to its `<aside>` — leave it alone for now rather than guessing.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: clean.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```

Sign in as the seeded admin, place a test order through the storefront, confirm it, then visit `/admin/orders` and `/admin/orders/picking`. Advance the order through to OUT_FOR_DELIVERY, settle a KG line short, and confirm `finalTotal` is what the arithmetic says it should be.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/orders/picking"
git commit -m "feat: printable picking list per delivery slot

One print job in two parts: a stock-pull total to source against, then a slip
per order to fill bags from, each starting a fresh sheet. A prepaid order says
'collect nothing' rather than showing a number, because a figure on a slip in a
driver's hand reads as an instruction.

The filter bar is print:hidden. The sidebar still prints; that is left alone
until someone has actually run a page off and been annoyed by it."
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §2.1 forward-one-step + cancel | 2, 5 |
| §2.2 fee never recomputed | 3 (`finalTotalFor` + its test) |
| §2.3 totals then per-order slips | 4, 8 |
| §2.4 Server Actions not REST | 5 |
| §3 `unitValue` migration + backfill rule | 1 |
| §4.1 `order-status.ts` | 2 |
| §4.2 `settlement.ts` | 3 |
| §4.3 `order-queries.ts` | 4 |
| §4.4 `actions.ts` | 5 |
| §5 conditional writes | 5 |
| §6 settlement flow, COD → PAID, finalTotal always | 3, 5, 7 |
| §7 pages | 6, 7, 8 |
| §8 four test files | 2, 3, 4, 5 |

**Type consistency checked:** `SettleableLine` (Task 3) is structurally satisfied by `AdminOrderItemRow` (Task 4), which is why `SettleForm` can pass `order.items` straight in — `AdminOrderItemRow` adds `actualQuantity`/`adjustedTotal` and TypeScript accepts the wider object. `settleLines` is called identically in Task 5 and Task 7. `nextStatus`/`canCancel`/`advanceLabel` keep the same names across Tasks 2, 5 and 6.

**Known ordering wrinkle:** Task 6 imports `./settle-form`, created in Task 7. Either run 6 and 7 back to back, or stub the component as noted in Task 6 Step 2.
