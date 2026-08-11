# Remaining work

**Updated:** 2026-08-11 · **Branch:** `phase1.5-hardening` · 656 tests green

**The backend is feature-complete.** A customer can browse, fill a basket, check
out and pay — cash with an OTP confirmation, or online once payments are
switched on. The owner can run the catalog, work orders through to delivered,
settle weights at the door, configure the shop, and gets told when an order
arrives.

**No backend phase remains.** What is left is verification, CI, and the items
only the owner can do — listed further down.

---

## What is left, in order

### 1. Phase 6 — operations · ~~*the launch gate*~~ **done**

**All three parts are built.**

| Part | Spec | Built across |
|---|---|---|
| 6A (6.1–6.4) | `2026-08-10-admin-order-operations-design.md` | `d13cc97..45789a5` |
| 6B (6.5–6.7) | `2026-08-10-shop-configuration-design.md` | `ee90a5a..a978dee` |
| 6C (6.8–6.9) | `2026-08-10-owner-alerts-and-dashboard-design.md` | through the dashboard commit |

| # | Piece | Done when |
|---|---|---|
| ~~6.1~~ | ~~**Admin orders list**~~ | **Done.** Filters live in the URL so a view can be sent as a link |
| ~~6.2~~ | ~~**Status transitions**~~ | **Done.** Forward one step, no undo; conditional writes guard two open tabs |
| ~~6.3~~ | ~~**Picking list**~~ | **Done.** Stock totals, then a slip per order, each on a fresh sheet |
| ~~6.4~~ | ~~**Weight settlement**~~ | **Done.** Needed a new `OrderItem.unitValue` column — see below |
| ~~6.5~~ | ~~**`/admin/slots`**~~ | **Done.** Week view; capacity per slot plus a `slot_capacity` default the cron reads |
| ~~6.6~~ | ~~**`/admin/pincodes`**~~ | **Done.** Add and deactivate — no hard delete, matching categories |
| ~~6.7~~ | ~~**`/admin/settings`**~~ | **Done.** Payments switch refuses to turn on without Razorpay keys |
| ~~6.8~~ | ~~**Telegram alerts**~~ | **Done, over WhatsApp not Telegram** — see below |
| ~~6.9~~ | ~~**Dashboard**~~ | **Done.** Collected money, still-to-come by slot, backlog, low stock |

6.4 turned out to need a schema change. `OrderItem` denormalised `unitPrice`
but not `unitValue`, so a "5 kg" bag at ₹160 stored `160.00 × 1` and ₹32/kg was
unrecoverable — and `variantId` carries no relation, so Variant could not be
asked. The column now exists and is written at checkout. Cash orders settle by
the driver collecting `finalTotal`; online orders absorb the difference, per
§4.6. The delivery fee is never recomputed at settlement: a basket that earned
free delivery keeps it even when adjusted weights fall below the threshold.

6.5 needed capacity in two places, not one. Per-slot alone would mean re-editing
twenty-one rows a week to keep a permanent change; a global default alone would
leave no way to cap a single festival morning. `generate-slots` now reads
`slot_capacity`, and each generated slot can be overridden. Closing a slot stops
new orders and nothing else — the orders already in it still need delivering,
and the confirm step says so with the count.

6.8 went over WhatsApp rather than Telegram, by the owner's decision. **This
needs something from Meta before it does anything:** a second template, in the
**Utility** category, separate from the Authentication one used for OTPs, plus
a payment method on the account. Until `WHATSAPP_ALERT_TEMPLATE_NAME` and
`WHATSAPP_OWNER_NUMBER` are both set, alerts are skipped with a warning and the
console driver prints them to the log — deliberately, so a pending approval
cannot stop the shop booting. The template's five parameters are documented in
`.env.example` and in the 6C spec.

### 2. Delivery is now by radius, not pincode

Added after the client asked for delivery within 5 km. `isServiceable` measures
a dropped pin against the shop with a haversine, and a **listed pincode is still
served whatever its distance** — the override that covers the colony at 5.2 km
the shop has always served.

Two things it needs:

- **The shop's coordinates.** Until `shop_lat`/`shop_lng` are set on
  `/admin/settings`, the radius rule cannot run and serviceability behaves
  exactly as it did before — a pincode whitelist. That is deliberate: shipping
  this could not make the whole town unserviceable on deploy.
- **A map pin in the frontend.** `POST`/`PUT /api/addresses` accept optional
  `lat` and `lng` numbers, and `GET /api/serviceability?pincode=&lat=&lng=`
  returns `distanceKm`, a reason code and the shop's own location so a map has a
  centre and a circle to draw. A missing pin returns `LOCATION_NEEDED`, which
  the address form should treat as "ask for a pin", **not** "we do not deliver
  here".

### 3. Your frontend design

Handed over now that the backend is done. The current UI is deliberately plain
and should be treated as provisional.

Restyling should be safe to do at the component level: `src/lib/shop-queries.ts`
returns plain serialisable shapes, and every rupee figure is produced by
`src/lib/pricing.ts` and `src/lib/cart-pricing.ts` as a `Decimal`-backed string.
Nothing in the visual layer needs to touch either.

### 4. Phase 1.5 leftovers · *not blocking, worth clearing*

The `.superpowers/sdd/…/progress.md` this once pointed at no longer exists —
this list is now the only record.

- **Task 5** — migrate the auth routes onto the `handleRoute` wrapper that
  already exists in `src/lib/api/handler.ts`
- **Task 6** — error boundaries
- **Task 7** — admin phone from config. `prisma/seed.ts` still carries
  `TODO: replace with the real admin phone number before go-live` and a
  hardcoded `+911234567890`
- ~~**Task 8** — **CI workflow**~~ **Done** (`b2bdd02`).
  `.github/workflows/ci.yml` runs lint → typecheck → test → build on every push
  and on PRs into master, on Node 22 to match the Dockerfile. It exists because
  `tsc --noEmit` went red while the suite stayed green four separate times
  across 6A, 6B and the radius work. **It has not yet run** — the branch has not
  been pushed since it was added, so the first run is still unobserved
- **Task 9** — client details checklist
- ~~**Task 10** — **end-to-end verification pass**~~ **Done.** A real order was
  driven from OTP login to settled delivery against the live database. Three
  findings came out of it — see *What the end-to-end pass found* below

### 5. Phase 7 — polish · *after launch*

SEO metadata, OG images, WhatsApp float button, customer order-tracking page,
mobile audit.

---

## Decisions I need from you

1. **Merge `phase1.5-hardening` into `master`?** Still open, and now the whole
   backend sits on it. The longer it runs the worse a conflict gets, and the
   branch name stopped describing its contents several phases ago.
2. ~~**Slot capacity.**~~ Settled: a `slot_capacity` default the cron reads,
   plus a per-slot override.
3. ~~**Telegram vs WhatsApp for owner alerts.**~~ Settled: WhatsApp. Needs the
   Utility template noted above.
4. **Rolling session refresh** puts a `Set-Cookie` on nearly every response,
   which makes them uncacheable by Cloudflare. Fine at this volume. If catalog
   pages should be CDN-cached, the fix is refreshing only past half the token's
   life.

---

## Only you can do these — both have lead time

- **Razorpay test keys** (`rzp_test_…`, issued before KYC clears). Put them in
  `.env`, register the webhook at `${APP_URL}/api/webhooks/razorpay` for
  `payment.captured` and `payment.failed`, set `payments_enabled` to true, and
  run one test payment. Everything else in Phase 5 is already proven against
  signed payloads.
- **Meta WhatsApp**: payment method on the account, an **Authentication**-category
  template, and a **System User** token. Until this is done OTPs only print to
  the server log — nobody can log in or confirm a cash order.
- **A second Meta template**, **Utility** category, for owner alerts. Five body
  parameters, documented in `.env.example`. Lower priority than the one above:
  without it the shop runs, it just does not message the owner.
- **The shop's coordinates**, for the 5 km radius. In Google Maps, right-click
  the shop and click the pair of numbers at the top of the menu to copy them;
  latitude is the first. Enter them on `/admin/settings`.

---

## What the end-to-end pass found

One order — `PM260811-3EKT` — was driven the whole way on 2026-08-11: OTP
login, address, cart, COD checkout, OTP confirmation, the status walk, weight
settlement, delivery. It all worked. The 5 kg bag of onions at ₹160 settled at
4.7 kg for ₹150.40, which is ₹32/kg, and `finalTotal` came to ₹230.40 against a
₹240.00 estimate. The dashboard then reported ₹230.40 collected, all cash.

Worth knowing: settlement writes **strings into `Decimal` columns**, and every
unit test mocks Prisma, so that had never actually been exercised. It works.
That was the single largest untested assumption in the codebase.

Three things came out of it, none of which any test would have caught.

### 1. A cash order never reduces stock · *the real one*

`stockQty` is decremented in exactly one place — the Razorpay webhook
(`webhooks/razorpay/route.ts:105`), on `payment.captured`. A COD order
therefore never touches it, at any point in its life, including delivery.

The comment there reads "stock comes down when the money arrives, not when the
basket is filled", which is right for online payment. For cash the money
arrives at the door, and nothing decrements stock then either. Ten COD orders
for the same tracked item all pass `priceCart`'s stock check against the same
untouched count, and the shop oversells.

It does not bite loose produce, which carries `stockQty: null` and is not
tracked. It bites the packed goods that are.

**Not fixed, because where the decrement belongs is a decision.** Reserving at
CONFIRMED prevents overselling but consumes stock on an order that may still be
cancelled; taking it at DELIVERED is accurate but too late to prevent anything.

### 2. A dropped database connection is a 500 on a read

`/orders` returned 500 once during the sweep, then 200 on every retry.
The cause was `P1017 — server has closed the connection`, Neon dropping an idle
connection, and `withDbRetry` not retrying it.

That exclusion is deliberate and documented (`db-retry.ts:8-11`): the server can
close a connection *after* a statement was sent, so a retry could duplicate a
write. Correct for writes. On a read there is no write to duplicate, so the
customer gets a 500 where a retry would have been provably safe.

Worth narrowing — retry P1017 for reads — but it is a change to the one module
everything else depends on, so it deserves its own thought.

### 3. Customers who sign in by OTP have no name

The alert read `New order PM260811-3EKT — Customer +919876500001`. `User.name`
is only ever set by Google sign-in, so an OTP customer has none, and the address
snapshot carries `name: null`.

`notify-order.ts` falls back to `'Customer'`. The picking slip and the orders
list do not, so a packing slip prints a blank where the name should be — which
is the sheet the driver carries to the door. Either add the same fallback in
both, or ask for a name at checkout.

---

## Known state and small debts

- Local `.env` holds a placeholder `CRON_SECRET` and fake Razorpay keys, added
  so the cron and webhook routes could be exercised. Inert while
  `payments_enabled` is false. **Replace before enabling payments.**
- The dev database's six test orders were deleted when `OrderItem.unitValue`
  was added, and the slot counters reset with them. A "Home" address on the
  seeded admin and one variant at `stockQty: 48` remain.
- **The end-to-end pass left one delivered test order in the dev database**
  (`PM260811-3EKT`) and one test customer (`+919876500001`). Harmless, and
  useful as evidence, but clear both before any demo — a delivered order counts
  toward the dashboard's revenue figure.
- **The admin screens were verified as rendering, not as clicking.** Every
  admin page returns 200 with a session and 307 without one, and the query layer
  was run against real data. The Server Actions behind the buttons were
  exercised by replaying their database writes, not by pressing the buttons —
  the browser extension was not connected. The forms themselves are unclicked.
- **Replace the seeded pincodes through `/admin/pincodes` now**, rather than in
  the database. The screen exists for it.
- `grocery-ecommerce-system-design.md` in the repo root is an untracked
  duplicate of `docs/reference/`. Delete it or commit it.
- `GET /api/categories`, `/api/products` and `/api/products/:slug` from the
  design doc's API surface are deliberately unbuilt — the storefront pages
  query directly as server components, so nothing consumes them yet.

---

## Before launch

From `CHANGES.md` §11 and `docs/deployment.md`:

- [ ] Oracle instance, domain, Cloudflare on **Full (strict)**
- [ ] Google OAuth redirect URI registered, byte-exact
- [ ] Replace the seeded pincodes and the admin phone number
- [ ] Nightly `pg_dump` to R2 running — **and one restore actually tested**
- [ ] UptimeRobot pointed at `/api/health`
- [ ] `SMS_DRIVER=whatsapp`, `IMAGE_DRIVER=cloudinary` set in production
- [ ] One real order placed end to end on the production box

**A cash-only launch is viable.** Everything from browsing to a confirmed COD
order works today. If Razorpay drags, Phase 6 followed by a COD-only launch
means the shop is taking orders while payments get sorted.
