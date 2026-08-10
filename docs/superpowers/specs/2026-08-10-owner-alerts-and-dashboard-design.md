# Owner alerts and dashboard — design

**Date:** 2026-08-10 · **Branch:** `phase1.5-hardening` · **Scope:** Phase 6C (6.8–6.9)

The last backend phase. 6A gave the owner a way to run orders and 6B a way to
configure the shop; 6C tells him an order has arrived, and shows him the day at
a glance when he opens the admin.

| Piece | Today |
|---|---|
| 6.8 Owner alerts | Nothing. An order reaching CONFIRMED is silent — the owner finds out by refreshing |
| 6.9 Dashboard | `/admin` is a 10-line stub |

---

## 1. Decisions

### 1.1 Alerts go over WhatsApp, not Telegram

`docs/reference/grocery-ecommerce-system-design.md` §2 chose Telegram for v1
because it is free and needs no approval. The owner has chosen WhatsApp, to
avoid running a second messaging service.

**This is not the free reuse it looks like, and the spec records why.** The
existing driver sends **Authentication**-category templates, which Meta accepts
only for one-time codes. An owner alert is a **Utility** template: a separate
submission, a separate approval, and a payment method on the account. It is a
new template and a new code path, sharing only the HTTP transport.

The decision stands; this section exists so the next person does not read
"reuse the OTP channel" and expect it to have been one line.

### 1.2 The alert interface is structured, not a string

`sendOwnerAlert` takes `{ orderNumber, customerName, customerPhone, slot,
summary }` rather than a formatted message.

WhatsApp needs positional template parameters; the console driver needs
readable text. Passing a string would force the WhatsApp driver to parse back
apart what it had just been handed, and would break the moment the wording
changed. Passing the parts lets each driver render what its channel wants.

### 1.3 A failed alert never fails an order

`notifyOrderConfirmed` is called after the transaction commits, and swallows
its own errors into the log.

The shop losing a notification is recoverable — the order is on the admin
screen either way. The shop losing a *paid order* because Meta returned a 500 is
not. `orders/route.ts` already takes this position for the confirmation OTP,
whose comment reads "the order exists and the code is stored; failing here
would strand a placed order behind an error page". Alerts get the same
treatment for the same reason.

### 1.4 Revenue is settled money on the delivery day

The dashboard's headline figure sums `finalTotal` over orders whose
`deliveredAt` falls on the day in question, split into cash and prepaid.

An order placed Monday for Tuesday, quoted at ₹520 and settled at ₹480, counts
₹480 on Tuesday. That is the money the driver actually handed over, on the day
he handed it over, and it is the only version of the number that reconciles
against the cash box and the bank. Counting estimates on the order date would
produce a figure nobody ever receives, since weight settlement means the quote
is almost always wrong by a little.

6A writes `finalTotal` on every delivered order, including those with nothing to
adjust, specifically so this is a plain `SUM` with no `?? grandTotal` fallback.

Orders that have not been delivered are shown separately as "still to come", at
their quoted `grandTotal`, and labelled as estimates.

---

## 2. Modules

### 2.1 `src/lib/services/whatsapp-transport.ts` — extracted

`sms/whatsapp.ts` currently inlines the Graph POST inside `sendOtpSms`. A second
message type would duplicate the fetch, the transport-versus-response error
split, and the rule that only a status code is logged — Meta's error body echoes
the request, and neither an access token nor an OTP belongs in a log line.

Extracted as:

```ts
sendWhatsAppTemplate(input: {
  to: string;
  templateName: string;
  components: unknown[];
}): Promise<void>
```

The pinned `GRAPH_VERSION` and the digits-only `to` normalisation move with it.
`sms/whatsapp.ts` keeps its Authentication-template shape and calls this; the
new alert driver calls it with a Utility-template shape.

### 2.2 `src/lib/services/notify/`

Mirrors `services/sms/`, which is the pattern already established for a
swappable channel.

```ts
// types.ts
export interface OwnerAlert {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  /** Already formatted for reading: "Tomorrow morning (7–10am)". */
  slot: string;
  /** "3 items · COD · collect ₹480" */
  summary: string;
}

export interface NotifyDriver {
  name: string;
  sendOwnerAlert(alert: OwnerAlert): Promise<void>;
}
```

- `console.ts` — one log line. What runs until Meta approves the template.
- `whatsapp.ts` — maps the five fields to positional parameters.
- `index.ts` — selects on the **existing `SMS_DRIVER`**. Alerts travel the same
  channel as OTPs by the owner's decision, so a second driver switch would be
  two names for one choice, and an opportunity for them to disagree.

### 2.3 The Meta template

Utility category, five body parameters, in this order:

```
🛒 New order {{1}}
{{2}} · {{3}}
{{4}}
{{5}}
```

| Param | Value |
|---|---|
| `{{1}}` | `KD-1042` |
| `{{2}}` | `Ramesh` |
| `{{3}}` | `98765 43210` |
| `{{4}}` | `Tomorrow morning (7–10am)` |
| `{{5}}` | `3 items · COD · collect ₹480` |

New env var `WHATSAPP_ALERT_TEMPLATE_NAME`. `WHATSAPP_OWNER_NUMBER` exists
already and is currently unused — this is what it was reserved for.

**Both stay optional, and alerts are skipped with a warning when either is
absent.** Not the treatment `env.ts` gives the three OTP keys, which are
required as a group when `SMS_DRIVER=whatsapp`, and the difference is
deliberate: OTP delivery is load-bearing, because nobody can log in or confirm a
cash order without it, while an alert is a convenience on top of a screen that
shows the same information anyway.

Making them required would also be self-defeating. The template has to be
approved by Meta before it exists, so a required `WHATSAPP_ALERT_TEMPLATE_NAME`
would stop the shop booting on the OTP configuration that already works, purely
because a second approval is still pending. And requiring the template while
leaving the number optional would force someone to get a template approved for
alerts they had no intention of receiving.

### 2.4 `src/lib/notify-order.ts`

```ts
notifyOrderConfirmed(orderId: string): Promise<void>
```

Loads what the alert needs, formats it, sends it, and swallows any failure into
`console.error`. Never throws. Reads the customer from the `deliveryAddress`
snapshot, as 6A's queries do, since that is what the driver will work from.

Called from the three places an order reaches CONFIRMED:

| Caller | When |
|---|---|
| `api/orders/[id]/verify-otp/route.ts` | a cash order is confirmed by code |
| `api/webhooks/razorpay/route.ts` | payment is captured |
| `(admin)/admin/orders/actions.ts` | admin advances PENDING → CONFIRMED |

All three call it **after** their transaction commits.

### 2.5 `src/lib/admin/dashboard-queries.ts`

```ts
getDashboard(date: string): Promise<DashboardSummary>
```

```ts
interface DashboardSummary {
  date: string;
  collected: { orders: number; total: string; cash: string; prepaid: string };
  upcoming: { slotType: SlotType; orders: number; estimated: string }[];
  needsAction: { pendingOtp: number; pending: number; confirmed: number; packed: number };
  lowStock: { productName: string; variantLabel: string; stockQty: number }[];
}
```

Money as strings, dates as ISO — the same contract as every other query module.

**`collected` and `upcoming` are scoped to `date`. `needsAction` and `lowStock`
are not.** An order left PENDING since yesterday is precisely what the owner
needs to see, and scoping the backlog to today would hide it on the one screen
built to surface it — the older it is, the more it matters and the less likely
a date filter is to show it. `needsAction` is therefore the whole open backlog,
regardless of when those orders were placed or which slot they are for. Low
stock is a fact about the catalogue and has no date at all.

**Low stock** is variants at or below 5 units. `stockQty: null` is excluded: null
means the shop does not track stock for that line, which is the normal case for
loose produce, and reporting it as "0 left" would bury the real warnings. The
threshold is a module constant rather than a setting — one number, no evidence
yet that the owner wants to tune it, and it can become a setting the day he asks.

---

## 3. Schema change

```prisma
@@index([deliveredAt])
```

The revenue query filters on `deliveredAt` on every dashboard load, and no
existing index covers it — the three on `Order` are `[userId, placedAt]`,
`[status, placedAt]` and `[slotId]`. Unnoticeable at today's volume and a full
table scan after a year of orders, on the screen the owner opens most.

---

## 4. Pages

| Path | Kind | Contents |
|---|---|---|
| `/admin` | server | Replaces the stub. Collected, still-to-come by slot, needs-action, low stock |

Plain, like the rest — the frontend design arrives separately.

---

## 5. Testing

| File | Covers |
|---|---|
| `services/whatsapp-transport.test.ts` | posts to the pinned Graph version; strips non-digits from the recipient; wraps a transport failure; logs status only, never the response body |
| `services/notify/index.test.ts` | driver selection follows `SMS_DRIVER`; console driver in production warns |
| `services/notify/whatsapp.test.ts` | the five parameters land in template order; a missing owner number skips rather than throws |
| `notify-order.test.ts` | **never throws when the channel fails**; reads the customer from the address snapshot |
| `admin/dashboard-queries.test.ts` | cash and prepaid split; upcoming grouped by slot; `stockQty: null` excluded from low stock; a day with no deliveries reports zero rather than empty |

The test that matters most is `notify-order.test.ts` proving the failure path,
because everything it protects — a captured payment, a confirmed delivery — is
already committed by the time it runs.

---

## 6. Out of scope

Charts, date-range reports, per-product sales history, alerts on any status
other than CONFIRMED, and customer-facing notifications. Telegram is not built:
the owner chose one channel, and building the other speculatively would leave a
path nobody has ever switched on.
