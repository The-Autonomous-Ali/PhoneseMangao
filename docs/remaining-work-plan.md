# Remaining work

**Updated:** 2026-08-10 · **Branch:** `phase1.5-hardening` @ `63deb5f` · 454 tests green

Phases 1–5 are done and pushed. A customer can browse, fill a basket, check out,
and pay — cash with an OTP confirmation, or online once payments are switched
on. The shop owner can run the catalog.

**One backend phase remains before launch.**

---

## Tomorrow, in order

### 1. Phase 6 — operations · *the launch gate*

This is the screen the owner lives in daily. The design doc calls out two
things it must get right: the picking list ("he will ask for this on day one")
and the ability to advance an order's status in one action.

| # | Piece | Done when |
|---|---|---|
| 6.1 | **Admin orders list** | Filter by date, slot and status; each row expands to items, address and phone |
| 6.2 | **Status transitions** | One action advances PENDING → CONFIRMED → PACKED → OUT_FOR_DELIVERY → DELIVERED, each writing an OrderEvent |
| 6.3 | **Picking list** | Print-friendly page grouped by slot, showing product, size and quantity — what the packer carries |
| 6.4 | **Weight settlement** | At "mark delivered", enter `actualQuantity` per KG line; computes `adjustedTotal` and writes `finalTotal` |
| 6.5 | **`/admin/slots`** | Week view: set capacity, close one slot, block a whole date for a holiday |
| 6.6 | **`/admin/pincodes`** | Add and remove serviceable pincodes — currently a database edit |
| 6.7 | **`/admin/settings`** | Delivery fee, minimum order, free-delivery threshold, WhatsApp number, shop-closed switch, `payments_enabled` |
| 6.8 | **Telegram alerts** | Owner gets a message when an order reaches CONFIRMED |
| 6.9 | **Dashboard** | Today's orders by slot, revenue, low stock — replaces the stub |

Biggest of the nine is 6.4: settlement touches money on a delivered order, and
§4.6 is explicit that partial-refund automation for small discrepancies is not
worth building. Cash orders settle by the driver collecting `finalTotal`;
online orders absorb the difference unless it is material.

6.5 and 6.6 are small and unblock real operation — the shop currently has slots
only because cron generates them at a fixed capacity of 20, and three seeded
pincodes.

### 2. Your frontend design

Handed over once the backend is done. The current UI is deliberately plain and
should be treated as provisional.

Restyling should be safe to do at the component level: `src/lib/shop-queries.ts`
returns plain serialisable shapes, and every rupee figure is produced by
`src/lib/pricing.ts` and `src/lib/cart-pricing.ts` as a `Decimal`-backed string.
Nothing in the visual layer needs to touch either.

### 3. Phase 1.5 leftovers · *not blocking, worth clearing*

Recorded in `.superpowers/sdd/2026-08-08-production-hardening/progress.md`.

- **Task 5** — migrate the auth routes onto the `handleRoute` wrapper that
  already exists in `src/lib/api/handler.ts`
- **Task 6** — error boundaries
- **Task 7** — admin phone from config. `prisma/seed.ts` still carries
  `TODO: replace with the real admin phone number before go-live` and a
  hardcoded `+911234567890`
- **Task 8** — **CI workflow.** The highest-value item here: five phases now
  sit on one branch, and `tsc --noEmit` has already been red once undetected
- **Task 9** — client details checklist
- **Task 10** — end-to-end verification pass

### 4. Phase 7 — polish · *after launch*

SEO metadata, OG images, WhatsApp float button, customer order-tracking page,
mobile audit.

---

## Decisions I need from you

1. **Merge `phase1.5-hardening` into `master`?** It now carries five phases and
   most of the product. The longer it runs, the worse a conflict gets — and the
   branch name no longer describes what is on it.
2. **Slot capacity.** Hardcoded at 20 per slot in `generate-slots`. Should 6.5
   make it editable per slot, per day, or leave the constant?
3. **Telegram vs WhatsApp for owner alerts.** The design doc says Telegram for
   v1 because it works today and is free. You now have WhatsApp Cloud API
   wired for OTPs — the same channel could carry owner alerts and save a second
   service. Costs ~₹0.14 an alert.
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

---

## Known state and small debts

- Local `.env` holds a placeholder `CRON_SECRET` and fake Razorpay keys, added
  so the cron and webhook routes could be exercised. Inert while
  `payments_enabled` is false. **Replace before enabling payments.**
- The dev database has test orders, a "Home" address on the seeded admin, and
  one variant left at `stockQty: 48`. Clear before any demo.
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
