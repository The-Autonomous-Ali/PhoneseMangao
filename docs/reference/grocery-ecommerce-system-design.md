# System Design — Slot-Based Grocery & Produce Ecommerce

**Scope:** Single-shop ecommerce site selling fruits, vegetables and grocery items, with date + time-slot delivery, online payment and COD, WhatsApp contact, and a self-serve admin dashboard for the shop owner.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | SSR for SEO on category/product pages, server actions, single deployable |
| Language | TypeScript | Non-negotiable for a schema this stateful |
| Database | PostgreSQL (Neon or Supabase) | Relational data, transactions needed for slot booking |
| ORM | Prisma | Migrations + type safety |
| Auth | Phone OTP (custom, JWT in httpOnly cookie) | No email in this market; OTP doubles as fake-order filter |
| Payments | Razorpay | UPI/cards/netbanking, India-native |
| SMS/OTP | MSG91 or Fast2SMS | Cheap, DLT-registered templates |
| Images | Cloudinary | Free tier is enough, on-the-fly resizing |
| Hosting | Vercel | Zero-config for Next.js |
| Order alerts | Telegram Bot (v1) → WhatsApp Cloud API (v2) | Telegram works today and free; WhatsApp needs Meta verification |

**Deliberately deferred:** Redis (not needed at this scale — Postgres handles it), microservices, a separate backend, GraphQL.

---

## 2. Architecture

```
                        ┌──────────────────────────┐
   Customer browser ───►│   Next.js (Vercel)       │
                        │                          │
                        │  /app         storefront │
                        │  /app/admin   dashboard  │
                        │  /app/api     routes     │
                        └───────┬──────────────────┘
                                │
              ┌─────────────────┼─────────────────┬──────────────┐
              ▼                 ▼                 ▼              ▼
        ┌───────────┐    ┌────────────┐    ┌───────────┐  ┌───────────┐
        │ Postgres  │    │  Razorpay  │    │  MSG91    │  │Cloudinary │
        │ (Prisma)  │    │            │    │  (OTP)    │  │ (images)  │
        └───────────┘    └─────┬──────┘    └───────────┘  └───────────┘
                               │ webhook
                               ▼
                     /api/webhooks/razorpay
                               │
                               ▼
                     Telegram / WhatsApp alert → shop owner
```

Everything is one Next.js app. Two route groups: `(shop)` for customers, `(admin)` behind a role check.

---

## 3. Data Model

The single most important decision: **prices live on variants, not products.** "Tomato" is a product. "Tomato — 1kg" and "Tomato — 500g" are variants, each with its own price, unit type and stock. This is what makes mixed per-kg / per-piece pricing trivial instead of a pile of special cases.

```prisma
// ---------- Users & addresses ----------

model User {
  id        String   @id @default(cuid())
  phone     String   @unique          // E.164, e.g. +919876543210
  name      String?
  role      Role     @default(CUSTOMER)
  addresses Address[]
  orders    Order[]
  createdAt DateTime @default(now())
}

enum Role {
  CUSTOMER
  ADMIN
}

model Address {
  id        String  @id @default(cuid())
  userId    String
  user      User    @relation(fields: [userId], references: [id])
  label     String? // "Home", "Shop"
  line1     String
  line2     String?
  landmark  String?
  city      String
  pincode   String
  isDefault Boolean @default(false)

  @@index([userId])
}

// ---------- Catalog ----------

model Category {
  id        String    @id @default(cuid())
  name      String                    // Fruits / Vegetables / Grocery
  slug      String    @unique
  imageUrl  String?
  sortOrder Int       @default(0)
  isActive  Boolean   @default(true)
  products  Product[]
}

model Product {
  id          String    @id @default(cuid())
  categoryId  String
  category    Category  @relation(fields: [categoryId], references: [id])
  name        String
  slug        String    @unique
  description String?
  imageUrl    String?
  isActive    Boolean   @default(true)
  sortOrder   Int       @default(0)
  variants    Variant[]
  createdAt   DateTime  @default(now())

  @@index([categoryId, isActive])
}

model Variant {
  id          String   @id @default(cuid())
  productId   String
  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  label       String            // "1 kg", "500 g", "1 piece", "Bundle"
  unitType    UnitType
  unitValue   Decimal  @db.Decimal(10, 3)  // 1.000 kg, 500.000 g, 1 piece
  price       Decimal  @db.Decimal(10, 2)
  mrp         Decimal? @db.Decimal(10, 2)  // for showing a strike-through
  stockQty    Int?                          // null = untracked
  isAvailable Boolean  @default(true)       // the toggle the client actually uses
  sku         String?  @unique

  @@index([productId, isAvailable])
}

enum UnitType {
  KG
  GRAM
  PIECE
  BUNDLE
  PACK
  LITRE
  ML
}

// ---------- Delivery ----------

model ServicePincode {
  id       String  @id @default(cuid())
  pincode  String  @unique
  area     String?
  isActive Boolean @default(true)
}

model DeliverySlot {
  id       String   @id @default(cuid())
  date     DateTime @db.Date
  slotType SlotType
  capacity Int      @default(20)
  booked   Int      @default(0)
  cutoffAt DateTime          // absolute timestamp ordering closes
  isOpen   Boolean  @default(true)
  orders   Order[]

  @@unique([date, slotType])
  @@index([date, isOpen])
}

enum SlotType {
  MORNING
  AFTERNOON
  EVENING
}

// ---------- Orders ----------

model Order {
  id          String   @id @default(cuid())
  orderNumber String   @unique          // human-facing: ORD-20260806-0042
  userId      String
  user        User     @relation(fields: [userId], references: [id])

  // Snapshot, NOT a foreign key — the address must not change under a placed order
  deliveryAddress Json

  slotId      String
  slot        DeliverySlot @relation(fields: [slotId], references: [id])

  status        OrderStatus   @default(PENDING)
  paymentMethod PaymentMethod
  paymentStatus PaymentStatus @default(UNPAID)

  itemsTotal  Decimal @db.Decimal(10, 2)
  deliveryFee Decimal @db.Decimal(10, 2)
  grandTotal  Decimal @db.Decimal(10, 2)

  // Settlement for weight variance on per-kg items
  finalTotal  Decimal? @db.Decimal(10, 2)

  razorpayOrderId   String? @unique
  razorpayPaymentId String?

  customerNote String?
  adminNote    String?
  cancelReason String?

  items       OrderItem[]
  events      OrderEvent[]
  placedAt    DateTime  @default(now())
  deliveredAt DateTime?

  @@index([userId, placedAt])
  @@index([status, placedAt])
  @@index([slotId])
}

model OrderItem {
  id        String  @id @default(cuid())
  orderId   String
  order     Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  variantId String

  // Denormalised snapshot — prices change, old orders must not
  productName  String
  variantLabel String
  unitType     UnitType
  unitPrice    Decimal @db.Decimal(10, 2)
  quantity     Int
  lineTotal    Decimal @db.Decimal(10, 2)

  // Filled at delivery for per-kg items
  actualQuantity Decimal? @db.Decimal(10, 3)
  adjustedTotal  Decimal? @db.Decimal(10, 2)

  @@index([orderId])
}

model OrderEvent {
  id        String      @id @default(cuid())
  orderId   String
  order     Order       @relation(fields: [orderId], references: [id], onDelete: Cascade)
  status    OrderStatus
  note      String?
  actorId   String?
  createdAt DateTime    @default(now())

  @@index([orderId])
}

enum OrderStatus {
  PENDING_OTP     // COD, phone not yet verified
  PENDING         // awaiting payment
  CONFIRMED
  PACKED
  OUT_FOR_DELIVERY
  DELIVERED
  CANCELLED
  FAILED
}

enum PaymentMethod {
  ONLINE
  COD
}

enum PaymentStatus {
  UNPAID
  PAID
  REFUNDED
  FAILED
}

// ---------- Infrastructure ----------

model OtpRequest {
  id         String   @id @default(cuid())
  phone      String
  codeHash   String            // bcrypt — never store the raw OTP
  purpose    String            // "LOGIN" | "COD_CONFIRM"
  expiresAt  DateTime
  attempts   Int      @default(0)
  consumedAt DateTime?
  createdAt  DateTime @default(now())

  @@index([phone, createdAt])
}

model Setting {
  key   String @id     // "delivery_fee", "min_order_value", "whatsapp_number", "shop_open"
  value Json
}
```

**Why `deliveryAddress` is JSON:** if a customer edits their saved address after ordering, a foreign key would silently rewrite where a past order went. Snapshot it.

**Why `stockQty` is nullable:** for produce the client will almost never count units. He'll flip `isAvailable` on and off. Give him the toggle as the primary control and treat exact counts as opt-in for packaged grocery.

---

## 4. Core Flows

### 4.1 Browse → Cart

Cart lives in `localStorage`, holding only `{ variantId, quantity }`. Never store prices client-side — they get re-fetched and re-validated at checkout. This avoids a server-side cart table entirely and means guests can build a cart before logging in.

### 4.2 Checkout

```
1. POST /api/cart/validate
   → server re-prices every variantId from DB
   → drops anything now unavailable, returns diff for the UI to show
2. Pincode check against ServicePincode
3. GET /api/slots?days=7
   → returns open slots with remaining capacity, cutoff not passed
4. Customer picks address + slot + payment method
5. POST /api/orders  → branches on payment method
```

### 4.3 Slot booking — the part with a real race condition

Two customers taking the last slot at the same moment must not both succeed. Do the increment as a conditional update inside the order transaction:

```ts
await prisma.$transaction(async (tx) => {
  const claimed = await tx.$executeRaw`
    UPDATE "DeliverySlot"
    SET booked = booked + 1
    WHERE id = ${slotId}
      AND "isOpen" = true
      AND booked < capacity
      AND "cutoffAt" > NOW()
  `;

  if (claimed === 0) throw new SlotUnavailableError();

  const order = await tx.order.create({ /* ... */ });
  await tx.orderItem.createMany({ /* ... */ });
  return order;
});
```

The `booked < capacity` predicate inside the `UPDATE` is what makes this safe — Postgres locks the row for the duration. Do **not** read the count and then write it; that's a lost-update bug waiting to happen on your first busy morning.

Release the slot (`booked - 1`) on cancellation and on payment failure.

### 4.4 Online payment

```
POST /api/orders
  → create Order (status PENDING, paymentStatus UNPAID)
  → razorpay.orders.create({ amount: grandTotal * 100, receipt: orderNumber })
  → store razorpayOrderId, return it to the browser

Browser opens Razorpay Checkout

POST /api/webhooks/razorpay          ← the ONLY place status changes
  → verify HMAC SHA256 signature against RAZORPAY_WEBHOOK_SECRET
  → on payment.captured:
      order.paymentStatus = PAID
      order.status        = CONFIRMED
      decrement stock, log OrderEvent, fire owner alert
  → on payment.failed:
      order.status = FAILED, release slot
```

**Critical:** the browser redirect after payment is a UX signal only. Never mark an order paid from client-side callback data — it's trivially forgeable. And make the webhook idempotent: Razorpay retries, so check `if (order.paymentStatus === 'PAID') return 200` before doing any work.

### 4.5 COD with OTP

```
POST /api/orders  (paymentMethod: COD)
  → Order created with status PENDING_OTP
  → generate 6-digit OTP, bcrypt it into OtpRequest, send via MSG91
POST /api/orders/:id/verify-otp
  → compare, check expiry (5 min) and attempts (max 3)
  → on success: status = CONFIRMED, fire owner alert
```

If unverified after 15 minutes, a cron job cancels the order and releases the slot.

### 4.6 Weight variance settlement

For `unitType: KG` items, what's delivered rarely matches what was ordered. At the "mark delivered" step in admin, the owner can enter `actualQuantity` per line item. The system computes `adjustedTotal` and writes `finalTotal` on the order.

- **COD:** the driver simply collects `finalTotal`. Clean.
- **Online:** you've already captured the estimate. Only handle the difference if it's material — otherwise absorb it. Do not build partial-refund automation for ₹8 discrepancies; it isn't worth the code.

My advice stands: sell online-paid produce in fixed graded packs and reserve true per-kg for COD.

---

## 5. Auth

Phone OTP for everyone, not just COD.

```
POST /api/auth/otp/request   { phone }
  → rate limit: 3 per phone per hour, 10 per IP per hour
  → 6 digits, bcrypt hashed, 5 min expiry
POST /api/auth/otp/verify    { phone, code }
  → max 3 attempts, then invalidate the request row entirely
  → upsert User, issue JWT in httpOnly + secure + sameSite=lax cookie, 30 days
```

Admin routes check `role === 'ADMIN'` in middleware. Do not rely on hiding the `/admin` link.

---

## 6. Admin Dashboard

This is the part the client lives in daily. Build it first — he can enter the catalog while you build the storefront.

**Orders** — the default landing screen. Filter by date, slot and status. Each order expands to items, address, phone, and a status advance button. Print-friendly picking list grouped by slot (he will ask for this on day one).

**Catalog** — categories, products, variants. Bulk availability toggle is the highest-value control here; a "mark unavailable" switch on every variant, reachable in one click.

**Slots** — a week view. Set capacity per slot, close individual slots, block whole dates for holidays. Auto-generate the next 14 days nightly via cron.

**Pincodes** — add/remove serviceable pincodes.

**Settings** — delivery fee, minimum order value, WhatsApp number, a global "shop closed" switch.

---

## 7. API Surface

```
Public
  GET  /api/categories
  GET  /api/products?category=&q=&page=
  GET  /api/products/:slug
  POST /api/cart/validate
  GET  /api/slots?days=7
  GET  /api/serviceability?pincode=

Auth
  POST /api/auth/otp/request
  POST /api/auth/otp/verify
  POST /api/auth/logout
  GET  /api/auth/me

Customer (authenticated)
  GET  /api/addresses          POST /api/addresses
  PUT  /api/addresses/:id      DELETE /api/addresses/:id
  POST /api/orders
  GET  /api/orders             GET /api/orders/:id
  POST /api/orders/:id/verify-otp
  POST /api/orders/:id/cancel

Webhooks
  POST /api/webhooks/razorpay

Admin
  GET  /api/admin/orders?date=&slot=&status=
  PATCH /api/admin/orders/:id/status
  PATCH /api/admin/orders/:id/settle
  CRUD  /api/admin/products, /variants, /categories
  CRUD  /api/admin/slots, /pincodes
  GET/PUT /api/admin/settings

Cron (Vercel Cron)
  POST /api/cron/generate-slots      daily 00:30
  POST /api/cron/expire-unpaid       every 15 min
```

---

## 8. Security Checklist

- Razorpay webhook signature verified server-side with `crypto.timingSafeEqual`
- Order totals **always** recomputed on the server from DB prices — never trust a client-submitted total
- OTPs hashed at rest, rate limited per phone and per IP, attempt-capped
- Admin role checked in middleware on every `/api/admin/*` and `/admin/*` route
- Zod validation on every request body
- No secrets in `NEXT_PUBLIC_*` — only the Razorpay **key ID** is public; the secret never leaves the server
- Webhook route excluded from CSRF/auth middleware but signature-gated

---

## 9. Build Order

**Phase 1 — foundation.** Prisma schema, migrations, seed script, OTP auth, admin shell with role guard.

**Phase 2 — admin catalog.** Categories, products, variants, image upload. *Hand this to the client and get him entering data while you keep building.*

**Phase 3 — storefront.** Category pages, product detail, cart, serviceability check.

**Phase 4 — checkout.** Slot picker, address form, order creation with the transactional slot claim, COD + OTP path.

**Phase 5 — payments.** Razorpay integration, webhook, idempotency, failure handling.

**Phase 6 — operations.** Admin order management, status transitions, picking list, slot management, Telegram alerts, cron jobs.

**Phase 7 — polish.** SEO metadata, OG images, WhatsApp float button, order tracking page, mobile audit.

Launch after Phase 6. Phase 7 can ship incrementally once the client is taking real orders.

---

## 10. Environment Variables

```
DATABASE_URL=
JWT_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
MSG91_AUTH_KEY=
MSG91_TEMPLATE_ID=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_CHAT_ID=
NEXT_PUBLIC_WHATSAPP_NUMBER=
```

---

## 11. Folder Structure

```
src/
├── app/
│   ├── (shop)/
│   │   ├── page.tsx                 # home: categories + featured
│   │   ├── c/[slug]/page.tsx        # category listing
│   │   ├── p/[slug]/page.tsx        # product detail
│   │   ├── cart/page.tsx
│   │   ├── checkout/page.tsx        # address → slot → payment
│   │   └── orders/[id]/page.tsx     # tracking
│   ├── (admin)/admin/
│   │   ├── page.tsx                 # dashboard: today by slot, revenue, low stock
│   │   ├── orders/
│   │   ├── products/
│   │   ├── slots/
│   │   ├── pincodes/
│   │   └── settings/
│   └── api/
├── components/
│   ├── ui/                          # shadcn
│   ├── shop/                        # ProductCard, VariantPicker, SlotPicker
│   └── admin/
├── lib/
│   ├── db.ts                        # Prisma singleton
│   ├── auth.ts                      # JWT sign/verify, getSession
│   ├── razorpay.ts
│   ├── otp.ts
│   ├── notify.ts                    # Telegram now, WhatsApp later
│   ├── serviceability.ts            # ← single swap point for radius mode
│   ├── pricing.ts                   # single source of truth for all totals
│   └── slots.ts                     # generation + availability
├── store/cart.ts                    # Zustand, persisted to localStorage
└── middleware.ts                    # /admin and /api/admin role guard
```

Keep `pricing.ts` as the only place a total is ever computed. The moment total calculation exists in two files, they drift, and you get orders whose line items don't sum to the amount charged.

---

## 12. Open Decision — Serviceability

This design implements a **pincode whitelist**, not the radius check you originally picked. My reasoning:

- Radius needs a paid Google Geocoding call on every address entry, so it adds a recurring bill to a project where the client likely doesn't want one.
- It is geographically wrong in the ways that matter — a 5 km circle includes the far bank of a river with no bridge and excludes a colony at 5.2 km the client is happy to serve.
- The client can maintain a pincode list himself from the admin. He cannot meaningfully maintain a radius.

Everything routes through one function, so this is reversible in an afternoon:

```ts
// lib/serviceability.ts
export async function isServiceable(input: { pincode: string; lat?: number; lng?: number }) {
  // current: whitelist lookup
  const hit = await db.servicePincode.findFirst({
    where: { pincode: input.pincode, isActive: true },
  });
  return Boolean(hit);

  // radius mode: geocode the address, haversine against SHOP_LAT/SHOP_LNG
  // from Settings, compare to DELIVERY_RADIUS_KM
}
```

If you want radius from day one, that's the only file that changes — plus adding `lat`/`lng` capture on the address form.
