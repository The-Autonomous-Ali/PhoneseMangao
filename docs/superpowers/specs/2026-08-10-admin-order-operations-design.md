# Admin order operations — design

**Date:** 2026-08-10 · **Branch:** `phase1.5-hardening` · **Scope:** Phase 6A

Phase 6 in `docs/remaining-work-plan.md` lists nine pieces. They split into three
sub-projects along clean seams, and this spec covers only the first:

| Group | Pieces | Status |
|---|---|---|
| **6A Order operations** | 6.1 list · 6.2 transitions · 6.3 picking list · 6.4 settlement | **this spec** |
| 6B Shop configuration | 6.5 slots · 6.6 pincodes · 6.7 settings | own cycle |
| 6C Alerts + dashboard | 6.8 Telegram · 6.9 dashboard | own cycle, after 6A |

6A is the launch gate. Today an order can be placed, paid for and confirmed, but
nothing can move it from CONFIRMED to a customer's door. The picking list and
one-action status advance are what the shop actually runs on.

---

## 1. What exists already

- `PENDING → CONFIRMED` happens in `src/app/api/orders/[id]/verify-otp/route.ts`
  for COD, and in the Razorpay webhook for online orders. Both write an `OrderEvent`.
- `src/app/api/orders/[id]/cancel/route.ts` cancels a *customer's own* order and
  releases the slot.
- `src/lib/slots.ts` provides `bookSlot` / `releaseSlot` as conditional writes.
- `src/lib/admin-auth.ts` provides `requireAdmin()`, called at the top of every
  admin Server Action.
- `src/app/(admin)/admin/orders/page.tsx` is an 8-line stub.

## 2. Decisions

Four decisions were taken before this spec, and each closes an ambiguity that
would otherwise be resolved differently in different files.

### 2.1 Transitions are forward-one-step, plus cancel

One button advances exactly one step. No skipping, no undo. The owner corrects a
mis-click by calling the developer — rare, and it keeps the `OrderEvent` trail a
truthful record of what happened rather than of what was clicked.

### 2.2 The delivery fee is never recomputed at settlement

If the basket earned free delivery at checkout, it keeps it, even when adjusted
weights drop the items total below the threshold. A customer told they would not
pay for delivery must not be charged for it afterwards because the shop's scale
read light. `finalTotal` therefore uses the `deliveryFee` **stored on the order**,
never a fresh `calculateTotals()`.

### 2.3 The picking list prints totals first, then per-order slips

One print job, two sections off one query. Page one is what to pull from stock;
the pages after it are one bag-filling slip per order, carrying name, phone,
address, and the amount to collect. Sourcing and packing are different jobs and
the packer should not need a screen for the second.

### 2.4 Mutations are Server Actions, not REST

`docs/reference/grocery-ecommerce-system-design.md` §7 specifies
`PATCH /api/admin/orders/:id/status` and `.../settle`. **This spec deviates.**
Every admin screen built so far — categories, products, variants — uses Server
Actions with `requireAdmin()` at the top, and introducing a second mutation style
inside the same admin area costs more than the REST surface would buy. Nothing
consumes those endpoints; there is no mobile client. The §7 admin block should be
read as superseded for orders. If an external consumer ever appears, the action
bodies are already thin wrappers over `src/lib/admin/*` and a route can call the
same functions.

---

## 3. Schema change

`OrderItem` denormalises `productName`, `variantLabel`, `unitType`, `unitPrice`
and `quantity` so an order still reads correctly after the product is renamed or
withdrawn. `variantId` is stored as a plain `String` with no relation, precisely
so a deleted variant cannot break history.

It does **not** store `unitValue`, and settlement cannot be computed without it.

A seeded potato variant is `label: '5 kg', unitValue: '5', price: '160'`. The
stored line is `unitPrice: 160.00, quantity: 1`. To price a 4.7 kg delivery you
need ₹32/kg, and `160 / 1` is not it. Joining back to `Variant` is not an option:
the row may be gone, and its price may have changed since the order was placed.

```prisma
model OrderItem {
  // ...
  unitPrice      Decimal  @db.Decimal(10, 2)
  unitValue      Decimal  @db.Decimal(10, 3)   // NEW
  quantity       Int
  lineTotal      Decimal  @db.Decimal(10, 2)
  actualQuantity Decimal? @db.Decimal(10, 3)
  adjustedTotal  Decimal? @db.Decimal(10, 2)
}
```

`PricedLine` in `src/lib/cart-pricing.ts` gains `unitValue: string`, read from
`variant.unitValue`, and `src/app/api/orders/route.ts` writes it through with the
other denormalised fields. The column is required, not nullable — a line without
it is unsettleable.

**Migration against existing rows.** There is no production data — the shop has
not launched — but the dev database holds test orders, and a required column with
no default fails against them. `docs/remaining-work-plan.md` already records that
those test orders must be cleared before any demo. The migration therefore
deletes them rather than inventing a default: a backfilled `unitValue` of `1`
would make a 5 kg line settle at one-fifth of the right price, and a wrong number
that looks plausible is worse than a missing row. The implementation plan runs
the delete as an explicit first step, not as a side effect of the migration.

---

## 4. Modules

Four units, each usable and testable without the others.

### 4.1 `src/lib/admin/order-status.ts`

The transition table and its guards. No I/O, no database, enums only.

```ts
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING:          'CONFIRMED',
  CONFIRMED:        'PACKED',
  PACKED:           'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'DELIVERED',
};

nextStatus(current): OrderStatus | null
canCancel(current): boolean
```

`PENDING_OTP` has no forward transition. Advancing it from admin would bypass the
COD anti-fraud gate that `verify-otp` exists to enforce — the whole point of that
state is that a stranger's order costs the person placing it a code sent to the
number on it. The only admin action on a `PENDING_OTP` order is cancel.

`DELIVERED`, `CANCELLED` and `FAILED` are terminal. `canCancel` is true for every
non-terminal state.

### 4.2 `src/lib/admin/settlement.ts`

Pure money arithmetic, no database. This is the module that touches money on a
delivered order, so it is DB-free by design and exhaustively unit-testable.

```ts
settleLines(lines, actualByLineId): { lines: SettledLine[]; itemsTotal: string }
finalTotalFor(adjustedItemsTotal, storedDeliveryFee): string
```

Per line: `pricePerUnit = unitPrice / unitValue`, then
`adjustedTotal = actualQuantity × pricePerUnit`, rounded to 2dp. Only `KG` lines
are adjustable; every other `unitType` keeps `lineTotal` untouched and gets no
`actualQuantity`. All arithmetic is `Prisma.Decimal`, consistent with
`pricing.ts` and `cart-pricing.ts`.

### 4.3 `src/lib/admin/order-queries.ts`

The read layer, mirroring `src/lib/shop-queries.ts`: plain serialisable shapes,
every Decimal already a string, nothing for the visual layer to convert.

```ts
listAdminOrders({ date?, slotType?, status? }): AdminOrderRow[]
getSlotPickingList(date, slotType): { slot, aggregate: PickLine[], orders: PackSlip[] }
```

`aggregate` groups by `productName + variantLabel` and sums quantity across every
order in the slot. Both sections come from one query.

### 4.4 `src/app/(admin)/admin/orders/actions.ts`

`advanceOrderStatus(orderId, from)`, `cancelOrder(orderId, reason)`,
`settleAndDeliver(orderId, actuals)`. Each opens with `requireAdmin()` and
returns `ActionResult` via `toActionError`, matching `categories/actions.ts`.

---

## 5. Concurrency

Every transition is a conditional write, for the reason already documented at
length in `bookSlot`:

```ts
const { count } = await tx.order.updateMany({
  where: { id, status: from },
  data:  { status: to },
});
if (count === 0) return { ok: false, error: 'This order was already updated' };
```

Read-then-write lets two open tabs both see `PACKED`, both decide the next state
is `OUT_FOR_DELIVERY`, and both write an `OrderEvent` — a history showing the
order dispatched twice. Making the current status part of the `WHERE` closes the
window without a follow-up read. `count === 0` is the complete answer: someone
else moved it, so re-read and say so.

The status update and its `OrderEvent` are always in one transaction. So is
cancel with its `releaseSlot`.

---

## 6. Settlement flow

At `OUT_FOR_DELIVERY`, the advance button opens a settlement form rather than
writing immediately.

- Each `KG` line gets an input prefilled with the ordered weight
  (`quantity × unitValue`). Other lines are shown but not editable.
- On submit, one transaction writes: each line's `actualQuantity` and
  `adjustedTotal`, the order's `finalTotal` and `deliveredAt`, status `DELIVERED`,
  and one `OrderEvent`.
- `finalTotal = Σ(adjustedTotal ?? lineTotal) + storedDeliveryFee`.
- `finalTotal` is written on **every** delivered order, including one with no KG
  lines, where it equals `grandTotal`. A uniformly populated column means the
  dashboard's revenue query in 6C is a plain sum, not `finalTotal ?? grandTotal`
  repeated at every call site.
- **COD** sets `paymentStatus = PAID`: the driver has collected. Nothing else in
  the codebase currently moves a COD order out of `UNPAID`.
- **Online** orders are already `PAID` and are left alone. Per §4.6 of the design
  doc, the difference is absorbed; partial-refund automation is explicitly not
  worth building.
- An order with no KG lines still goes through the form, which is then a single
  confirm button.

---

## 7. Pages

| Path | Kind | Contents |
|---|---|---|
| `/admin/orders` | server | filters (date, slot, status), list |
| `orders-list.tsx` | client | rows expanding to items, address, phone, actions |
| `settle-form.tsx` | client | KG inputs, live final total |
| `/admin/orders/picking` | server | print view, `?date=&slot=` |

Default view is today, all slots, all statuses. The UI stays deliberately plain:
the frontend design is supplied separately once the backend is done, so nothing
here should be polished, and every rupee figure arrives from the query layer
already formatted.

---

## 8. Testing

| File | Covers |
|---|---|
| `settlement.test.ts` | rounding; the 5 kg pack at ₹160; zero delivered; non-KG untouched; fee preserved across the free-delivery threshold |
| `order-status.test.ts` | the full table; terminal states; the `PENDING_OTP` guard |
| `actions.test.ts` | `requireAdmin` on each action; the lost-race path returning a clean error; cancel releasing the slot |
| `order-queries.test.ts` | picking-list aggregation across several orders |

`settlement.test.ts` is the one that matters most — it is the only module here
that decides what a customer is charged.

---

## 9. Out of scope

6.5 slots, 6.6 pincodes, 6.7 settings, 6.8 Telegram alerts, 6.9 dashboard. Also
out of scope: undo of a status transition, partial-refund automation (§4.6),
and the `/api/admin/*` REST surface from §7 (see 2.4).
