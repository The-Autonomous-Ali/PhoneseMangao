# Phase 1 — Foundation

**Parent design:** [`grocery-ecommerce-system-design.md`](../../../../../Downloads/grocery-ecommerce-system-design.md) (source system design doc; see repo copy at `docs/reference/grocery-ecommerce-system-design.md` once copied in).

**Status:** Approved for implementation planning.

**Sequence:** 1 of 7. This project is decomposed into phases per the source doc's Build Order (§9). Each phase gets its own spec → plan → implementation cycle:

1. **Foundation** ← this spec
2. Admin catalog
3. Storefront
4. Checkout
5. Payments
6. Operations
7. Polish

---

## 1. Purpose

Stand up the skeleton every later phase builds on: the Next.js project itself, the complete data model, phone-OTP authentication usable by both customers and the admin, and an admin shell with role-gated routing. No catalog, storefront, checkout, or payment logic yet — those are separate specs.

## 2. Scope

**In:**
- Next.js 15 (App Router) + TypeScript scaffold, Tailwind CSS, shadcn/ui installed
- Full Prisma schema (all models from the system design, §3) + initial migration against Neon Postgres
- Seed script: one `ADMIN` user (placeholder phone — swapped for the real number before go-live) + default `Setting` rows (`delivery_fee`, `min_order_value`, `whatsapp_number`, `shop_open`)
- Phone-OTP auth, end to end: request → verify → JWT in httpOnly cookie
- `middleware.ts` role guard on `/admin/*` and `/api/admin/*`
- Admin shell: shared login page, sidebar layout, placeholder pages for Orders / Catalog / Slots / Pincodes / Settings
- Local git repository with initial commit

**Out (belongs to a later phase, not built here):**
- Catalog CRUD (Phase 2)
- Storefront pages, cart (Phase 3)
- Checkout, slot booking logic (Phase 4)
- Razorpay integration (Phase 5)
- Admin order management, Telegram alerts, cron jobs (Phase 6)
- SEO, OG images, WhatsApp float, mobile audit (Phase 7)
- Real SMS sending (MSG91/Fast2SMS) — stubbed this phase, see §5
- Cloudinary, Telegram, Razorpay env vars — not needed until their respective phases

## 3. Data Model

The full schema from the system design doc §3 is created now, in one migration, because models cross-reference each other (`Order` → `Variant`, `DeliverySlot`; `OrderItem` → `Order`) and later phases should only be adding *usage* of tables, not restructuring foreign keys underneath already-shipped code.

**One deliberate addition beyond the source doc:** the doc's security checklist (§8) requires "10 requests per IP per hour" rate limiting on OTP requests, but the `OtpRequest` model as specified has no field to query that against. This spec adds:

```prisma
model OtpRequest {
  id         String    @id @default(cuid())
  phone      String
  ip         String?           // added: enables the per-IP rate limit the doc's security checklist requires
  codeHash   String
  purpose    String
  expiresAt  DateTime
  attempts   Int       @default(0)
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([phone, createdAt])
  @@index([ip, createdAt])
}
```

Every other model is copied verbatim from the source doc — see that doc for the full listing (`User`, `Address`, `Category`, `Product`, `Variant`, `ServicePincode`, `DeliverySlot`, `Order`, `OrderItem`, `OrderEvent`, `Setting`, and all enums).

**Seed data (this phase only):**
- One `User` with `role: ADMIN`, `phone: "+911234567890"` (placeholder — flagged with a `// TODO: replace with real admin phone` comment in the seed script)
- `Setting` rows: `delivery_fee`, `min_order_value`, `whatsapp_number`, `shop_open` with reasonable defaults (e.g. `shop_open: true`)

No categories, products, variants, pincodes, or slots are seeded — that data entry starts in Phase 2 (catalog) and Phase 4 (slots), per the doc's own instruction to hand the admin catalog to the client early.

## 4. Auth Flow

Phone OTP for everyone (customers and admin alike), per source doc §5.

```
POST /api/auth/otp/request   { phone }
  → Zod-validate phone (E.164)
  → rate limit: count OtpRequest rows for this phone in last hour (max 3),
                count OtpRequest rows for this IP in last hour (max 10)
  → generate 6-digit code, bcrypt-hash it, store OtpRequest (expiresAt = now+5min)
  → lib/otp.ts sends it — see "OTP delivery" below
  → 200 { ok: true } (never leak whether the phone exists)

POST /api/auth/otp/verify    { phone, code }
  → find latest unconsumed OtpRequest for phone, check expiresAt
  → compare code against codeHash
  → attempts++; at 3 failed attempts, invalidate the row (consumedAt = now, forcing a fresh request)
  → on success: consumedAt = now; upsert User by phone; sign JWT { userId, role };
                set cookie (httpOnly, secure, sameSite=lax, 30 days)
  → 200 { role } — client redirects: ADMIN → /admin, CUSTOMER → /

POST /api/auth/logout
  → clear cookie

GET  /api/auth/me
  → return { id, phone, name, role } from the verified cookie, or 401
```

**OTP delivery (`lib/otp.ts`):** one function, `sendOtp(phone: string, code: string): Promise<void>`. This phase's implementation `console.log`s the code, gated on `NODE_ENV !== 'production'`. Whenever MSG91/Fast2SMS credentials arrive, only this function's body changes; every caller and the rest of the auth flow is untouched.

**Cookie:** name `session`, httpOnly, secure, sameSite=lax, 30-day expiry, payload `{ userId, role }` signed with `JWT_SECRET`.

**Role guard (`middleware.ts`):** verifies the JWT cookie on every request matching `/admin/*` or `/api/admin/*`. Missing/invalid token → redirect to `/login` (page routes) or 401 JSON (API routes). Valid token but `role !== 'ADMIN'` → 403. Does not rely on hiding links, per the doc's security checklist.

## 5. Admin Shell

- `/login` — shared phone + OTP form (two-step: enter phone → enter code), used by both customers and admin. Not under `/admin`, so customers can reach it too once the storefront exists.
- `/admin` layout — sidebar with Orders / Catalog / Slots / Pincodes / Settings links, neutral Tailwind + shadcn styling (no brand identity yet — restyled once the frontend design arrives).
- Each admin section this phase is a stub page ("Coming in Phase N") except the layout and role guard, which are fully functional.
- Root `/` gets a minimal placeholder page (not the real storefront — that's Phase 3) so the app isn't blank.

## 6. Error Handling & Security

- Zod schema on every request body; malformed input → 400 with field-level messages.
- Consistent error shape: `{ error: string }`.
- Rate-limit breach → 429.
- Invalid/expired/attempts-exceeded OTP → 400, generic message (don't reveal which check failed).
- JWT secret and DB URL only — no payment/SMS/image secrets needed this phase; `.env.example` lists all vars from the source doc's §10 but comments which phase introduces each one.
- Passwords/OTPs never logged in production path; the dev console-log stub is explicitly dev-only (gated on `NODE_ENV !== 'production'`).

## 7. Testing

Vitest, colocated `*.test.ts` files, for the logic worth protecting now:
- OTP generation/hashing/expiry/attempt-cap behavior
- Rate-limit counting (phone + IP windows)
- JWT sign/verify round-trip
- Role-guard middleware (allows ADMIN, blocks CUSTOMER/anonymous)

Tests that don't need a database (hashing, JWT sign/verify, attempt-cap arithmetic) run against plain functions. Tests that do (rate-limit counting, middleware role checks) run against a mocked Prisma client (`vi.mock('@/lib/db')`) rather than a real database — Phase 1 doesn't have enough DB-dependent logic to justify a test-database harness yet; that's worth revisiting once Phase 4's slot-booking transaction lands.

No e2e/browser testing this phase (Phase 7 territory). No UI component tests — the admin shell is stub pages this phase.

## 8. Folder Structure (this phase's slice)

```
src/
├── app/
│   ├── (shop)/
│   │   └── page.tsx                 # minimal placeholder home
│   ├── (admin)/admin/
│   │   ├── layout.tsx               # sidebar shell, role guard render
│   │   ├── page.tsx                 # dashboard placeholder
│   │   ├── orders/page.tsx          # stub
│   │   ├── products/page.tsx        # stub
│   │   ├── slots/page.tsx           # stub
│   │   ├── pincodes/page.tsx        # stub
│   │   └── settings/page.tsx        # stub
│   ├── login/page.tsx               # shared phone+OTP login
│   └── api/
│       └── auth/
│           ├── otp/request/route.ts
│           ├── otp/verify/route.ts
│           ├── logout/route.ts
│           └── me/route.ts
├── components/ui/                   # shadcn
├── lib/
│   ├── db.ts                        # Prisma singleton
│   ├── auth.ts                      # JWT sign/verify, getSession
│   ├── otp.ts                       # generate/hash/verify/send + rate limit
│   └── validation/                  # Zod schemas
├── middleware.ts
prisma/
├── schema.prisma
└── seed.ts
```

## 9. Environment Variables (this phase)

```
DATABASE_URL=       # Neon Postgres connection string
JWT_SECRET=          # generated, 32+ random bytes
```

All other vars from the source doc's §10 (`RAZORPAY_*`, `MSG91_*`, `CLOUDINARY_*`, `TELEGRAM_*`, `NEXT_PUBLIC_WHATSAPP_NUMBER`) are listed in `.env.example` as commented-out placeholders noting which phase activates them, so the file only grows, never gets restructured.

## 10. Definition of Done

- `npx prisma migrate dev` runs clean against a Neon DB from a fresh clone
- `npx prisma db seed` creates the admin user and default settings
- A phone number can request an OTP (visible in server console in dev), verify it, and land on `/admin` (if seeded ADMIN) or `/` (any other phone, auto-created as CUSTOMER)
- Visiting `/admin` while logged out redirects to `/login`; visiting while logged in as CUSTOMER returns 403
- `npx vitest run` passes for all Phase 1 tests
- `git log` shows an initial commit with the full scaffold
