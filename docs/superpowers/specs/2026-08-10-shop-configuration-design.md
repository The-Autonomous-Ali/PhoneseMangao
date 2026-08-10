# Shop configuration — design

**Date:** 2026-08-10 · **Branch:** `phase1.5-hardening` · **Scope:** Phase 6B (6.5–6.7)

Phase 6 splits three ways. 6A — order operations — is built and committed
(`d13cc97..45789a5`). This spec covers 6B: the three screens through which the
owner configures the shop. 6C (Telegram alerts, dashboard) follows separately.

| Screen | Today |
|---|---|
| `/admin/slots` | 8-line stub. Slots exist only because cron generates them at a fixed capacity of 20 |
| `/admin/pincodes` | 8-line stub. Three seeded pincodes, changeable only by editing the database |
| `/admin/settings` | 8-line stub. `getShopSettings` reads six keys; nothing writes them |

None of this blocks taking an order, which is why it came after 6A. All of it
blocks the shop being run by its owner rather than by its developer.

---

## 1. Decisions

### 1.1 Capacity is set in two places, not one

`generate-slots` hardcodes `SLOT_CAPACITY = 20`. Making only the generated rows
editable would mean re-editing 21 slots every week to keep a permanent change,
which the owner would stop doing by the third week. Making only a global default
editable would leave no way to cap a single festival morning without closing it.

So both: a `slot_capacity` setting the cron reads when generating, and an
editable `capacity` on each existing slot.

Lowering a slot's capacity below its current `booked` count is **allowed** and
needs no new logic. `bookSlot` guards on `booked < capacity` inside the write,
so a lowered capacity stops new orders while the orders already taken stand.

### 1.2 Closing a slot stops new orders and does nothing else

The owner blocks a date for a festival. Orders already booked into it still have
customers expecting a delivery, so they are untouched. The confirm step reports
how many there are, so the decision is made knowingly, and cancelling remains a
deliberate per-order act on the orders screen.

Automatic cancellation was rejected: it would cancel real customers' orders from
a single click, and 6A's transitions are forward-only, so there is no undo.

### 1.3 The payments switch is guarded in the action

`SETTING_DEFAULTS` documents why `payments_enabled` defaults to false — a shop
whose Razorpay KYC has not cleared would otherwise offer a payment method that
errors at the last step of checkout. The settings screen must not reintroduce
that failure by letting the switch be flipped on a server with no keys.

`env.RAZORPAY_KEY_ID` answers the question, and `env.ts` already enforces the
three Razorpay keys all-or-nothing, so one of them is a sufficient test.

The check lives in the Server Action. The input also renders disabled with the
reason beside it, but that is a courtesy: a disabled input is not a control, and
`admin-auth.ts` already explains at length why these guards belong server-side.

### 1.4 Pincodes deactivate, they do not delete

`ServicePincode.isActive` exists for this, `isServiceable` already filters on it,
and categories and products both deactivate rather than delete. A hard delete
would also silently strand any saved customer address in that pincode with
nothing in the record explaining when or why the shop stopped serving it.

### 1.5 Two save models on the settings screen

Money and text save as one form behind a Save button. The two booleans write
immediately on click, as `setCategoryActive` does in the catalog.

This is deliberate rather than sloppy. `shop_open` is an emergency control — the
reason to touch it is that something has gone wrong right now — and making the
owner find a Save button after flipping it adds a step at the worst moment. The
catalog already mixes the two models on one screen, so this follows the house
pattern rather than inventing one.

---

## 2. Modules

### 2.1 `src/lib/validation/config.ts`

Zod schemas for every input on these three screens, joining the existing
`catalog.ts`, `address.ts` and `auth.ts`.

```ts
pincodeSchema:  { pincode: string, area?: string }
capacitySchema: number, integer, 0–500
settingsSchema: { deliveryFee, minOrderValue, freeDeliveryAbove,
                  whatsappNumber, slotCapacity }
```

The pincode rule reuses `PINCODE_PATTERN` from `serviceability.ts` rather than
restating it — two copies of a validation rule drift, and this one decides
whether a customer can order at all.

A capacity of 0 is valid: it is how a slot is kept visible but unbookable.

### 2.2 `src/lib/settings.ts` — extended

Gains `slot_capacity: 20` in `SETTING_DEFAULTS`, `slotCapacity: number` on
`ShopSettings`, and a writer:

```ts
writeSettings(values: Partial<Record<SettingKey, unknown>>): Promise<void>
```

An upsert per key inside one transaction. Reading stays exactly as it is — the
existing tolerance for a missing or malformed row is what keeps the shop taking
orders when a settings write has gone wrong, and a writer does not change that.

### 2.3 `src/lib/admin/slot-queries.ts`

```ts
getSlotWeek(fromDate: string): Promise<SlotWeek>
```

Seven days from `fromDate`, each with its three slot types, carrying `id`,
`capacity`, `booked`, `isOpen` and `cutoffAt`. Days with no generated slots
appear as empty rows rather than being skipped, so the owner can see that the
cron has not run rather than seeing a shorter week and assuming it has.

Returns plain serialisable shapes with dates as ISO strings, the same contract as
`shop-queries.ts` and `order-queries.ts`.

### 2.4 The three action modules

- `admin/slots/actions.ts` — `setSlotCapacity`, `setSlotOpen`, `setDateOpen`
- `admin/pincodes/actions.ts` — `addPincode`, `setPincodeActive`
- `admin/settings/actions.ts` — `updateSettings`, `setShopOpen`, `setPaymentsEnabled`

Each opens with `requireAdmin()` and returns `ActionResult` through
`toActionError`, matching `categories/actions.ts` and 6A's `orders/actions.ts`.

`setDateOpen(date, isOpen)` writes all three of that date's slots in one
transaction, so a half-applied block cannot survive a failure partway through.
It takes a boolean rather than being a one-way `blockDate`, because a festival
gets cancelled and a date blocked by mistake has to be recoverable — and
reopening three slots individually is exactly the fiddly step that leaves one of
them still closed.

---

## 3. The cron change

`generate-slots` reads `slot_capacity` from settings instead of its constant.
It gains one database read before `withAdvisoryLock`.

A missing or malformed `slot_capacity` row falls back to the `SETTING_DEFAULTS`
value through the tolerance `getShopSettings` already applies to every key. A
cron that skipped a night because one settings row held nonsense would leave the
shop with nothing to sell, which is far worse than generating at the default.

That tolerance covers a bad *value*, not a failed *read*: `getShopSettings` goes
through `withDbRetry`, which rethrows once the connection retries are exhausted.
That is the right behaviour and is left alone — if the database is unreachable
the cron cannot write slots either, so there is nothing to salvage by catching.

---

## 4. Pages

| Path | Kind | Contents |
|---|---|---|
| `/admin/slots` | server | Week grid, date navigation, capacity inputs |
| `slots/slot-grid.tsx` | client | Per-slot capacity edit, open toggle, block-date action |
| `/admin/pincodes` | server | List and add form |
| `pincodes/pincode-manager.tsx` | client | Add, toggle active |
| `/admin/settings` | server | Reads current settings |
| `settings/settings-form.tsx` | client | Money and text fields, plus the two toggles |

The UI stays plain. The frontend design is supplied separately once the backend
is done, so nothing here should be polished.

---

## 5. Testing

| File | Covers |
|---|---|
| `validation/config.test.ts` | pincode rule matches `serviceability`; capacity bounds; zero allowed; money format |
| `admin/slot-queries.test.ts` | a week assembled with gaps; booked and capacity carried through |
| `settings.test.ts` *(extended)* | `slot_capacity` default and override; `writeSettings` upserts |
| `slots/actions.test.ts` | `requireAdmin`; `setDateOpen` writes three slots in one transaction and reopens as well as blocks; capacity below booked is permitted |
| `pincodes/actions.test.ts` | `requireAdmin`; rejects a malformed pincode; deactivate rather than delete |
| `settings/actions.test.ts` | `requireAdmin`; **payments refused with no Razorpay key**; accepted with one |
| `cron/generate-slots/route.test.ts` *(extended)* | generates at the configured capacity, not the old constant |

The payments guard is the test that matters most here: it is the one protecting
a customer from reaching the last step of checkout and finding it broken.

---

## 6. Out of scope

The slot generation horizon (fixed at 7 days), editing cutoff times,
radius-based serviceability, and 6C's Telegram alerts and dashboard.
