# PhoneseMangao — Updated Implementation Spec

Supersedes the infra and auth sections of `docs/reference/grocery-ecommerce-system-design.md`.
Everything not listed here is unchanged.

---

## 1. Infrastructure

| Concern | Old plan | New plan |
|---|---|---|
| Hosting | Vercel | Oracle Cloud Always Free (ARM, Mumbai) |
| Database | Neon / Supabase | Postgres on the same box |
| Cron | Vercel Cron | System crontab + Postgres advisory lock |
| CDN / SSL | Vercel | Cloudflare free tier |
| OTP delivery | MSG91 (SMS) | WhatsApp Cloud API (direct from Meta) |
| Customer login | Phone + OTP only | Google sign-in + phone verified at first checkout |

Unchanged: Razorpay (payments), Cloudinary (images), Telegram (owner order alerts).

**Fixed monthly cost: ₹0.** Variable: ~₹0.14 per WhatsApp OTP, Razorpay 2% + GST on online payments only.

---

## 2. `next.config.ts`

Currently empty. Needs standalone output so the Docker image stays small and the app
stays portable off Oracle later.

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
};

export default nextConfig;
```

---

## 3. `.env.example`

```bash
# Core
DATABASE_URL=                      # postgres on the same host
JWT_SECRET=                        # 32+ random bytes
APP_URL=https://yourdomain.in      # required for the OAuth redirect URI

# Google sign-in
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# WhatsApp Cloud API (replaces MSG91_*)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=             # System User token — NOT the 24h dev-dashboard token
WHATSAPP_AUTH_TEMPLATE_NAME=       # Authentication-category template
WHATSAPP_OWNER_NUMBER=             # owner alerts

# Cron auth
CRON_SECRET=                       # crontab sends this as a header

# Unchanged
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_CHAT_ID=
NEXT_PUBLIC_WHATSAPP_NUMBER=
```

Delete `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID`.

---

## 4. Prisma schema changes

Only the `User` model changes. Everything else stays as-is.

```prisma
model User {
  id       String  @id @default(cuid())
  phone    String? @unique          // was required — now arrives at first checkout
  email    String? @unique          // from Google
  googleId String? @unique
  name     String?
  imageUrl String?

  phoneVerifiedAt DateTime?         // set when the WhatsApp OTP is confirmed

  role      Role      @default(CUSTOMER)
  addresses Address[]
  orders    Order[]
  createdAt DateTime  @default(now())

  @@index([email])
}
```

Migration note: `phone` going nullable is safe on an empty table. If you already have
rows, backfill first.

Add `'PHONE_VERIFY'` as a valid `OtpRequest.purpose` alongside `'LOGIN'` and `'COD_CONFIRM'`.

---

## 5. Auth: Google sign-in

**Do not install Auth.js.** Your `src/lib/auth.ts` already signs and verifies sessions with
`jose`, `src/middleware.ts` reads that cookie, and both have passing tests. Adding Auth.js
means a second session system and rewriting all of it. Implement the OAuth handshake
directly and hand off to the session code you already have.

### `src/lib/google.ts` (new)

```ts
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export function getRedirectUri(): string {
  return `${process.env.APP_URL}/api/auth/google/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export async function exchangeCode(code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error("Google token exchange failed");

  const { access_token } = await tokenRes.json();

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) throw new Error("Google userinfo failed");

  return profileRes.json();
}
```

### `src/app/api/auth/google/start/route.ts` (new)

```ts
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthUrl } from "@/lib/google";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return NextResponse.redirect(buildAuthUrl(state));
}
```

### `src/app/api/auth/google/callback/route.ts` (new)

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { exchangeCode } from "@/lib/google";
import { signSession, setSessionCookie } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const store = await cookies();
  const expected = store.get("oauth_state")?.value;

  // CSRF: the state we issued must come back unchanged.
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }
  store.delete("oauth_state");

  const profile = await exchangeCode(code);
  if (!profile.email_verified) {
    return NextResponse.redirect(new URL("/login?error=unverified", request.url));
  }

  // Link to an existing account by email if one exists, else create.
  const user = await db.user.upsert({
    where: { email: profile.email },
    update: { googleId: profile.sub, name: profile.name, imageUrl: profile.picture },
    create: {
      email: profile.email,
      googleId: profile.sub,
      name: profile.name,
      imageUrl: profile.picture,
    },
  });

  await setSessionCookie(await signSession({ userId: user.id, role: user.role }));

  // No phone yet -> they must verify one before they can check out.
  const next = user.phoneVerifiedAt ? "/" : "/verify-phone";
  return NextResponse.redirect(new URL(next, request.url));
}
```

### Account linking

Both login paths resolve to one `User` row. If someone signs in with Google using an email
that isn't on file, but later verifies a phone that already exists on a phone-created
account, merge into the older row rather than creating a duplicate — check for an existing
`User` by phone inside the phone-verify handler before writing.

---

## 6. Rolling session refresh

Currently the 30-day cookie counts from login, so a weekly customer is logged out on day 31.

In `src/middleware.ts`, after a session verifies, re-issue the cookie:

```ts
const response = NextResponse.next();
if (session) {
  const fresh = await signSession(session);
  response.cookies.set(SESSION_COOKIE_NAME, fresh, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}
return response;
```

Also widen the matcher — it currently only covers `/admin`, so customer routes never
refresh:

```ts
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Keep the admin role check gated to `/admin` paths inside the handler.

---

## 7. WhatsApp OTP

Replace the `throw` in `src/lib/otp.ts`. Everything else in that file — bcrypt hashing,
5-minute expiry, 3-attempt cap, per-phone and per-IP rate limits — stays exactly as written.

```ts
export async function sendOtp(phone: string, code: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[dev otp] ${phone}: ${code}`);
    return;
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone.replace(/\D/g, ""), // 91XXXXXXXXXX, no '+'
        type: "template",
        template: {
          name: process.env.WHATSAPP_AUTH_TEMPLATE_NAME,
          language: { code: "en" },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: code }],
            },
          ],
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
  }
}
```

**Meta setup, in order:**
1. Business Manager → WhatsApp Business Account → add the shop's number.
2. Add a payment method. Without one, numbers get deactivated and sends fail.
3. Create a template under the **Authentication** category — not Utility. Utility templates
   are rejected for OTPs. The copy-code button is part of the auth template format.
4. Generate a **System User** access token with `whatsapp_business_messaging`. The token
   shown in the dev dashboard expires in 24 hours.

Business verification is not required to start; an unverified WABA allows 250 unique
recipients per rolling 24 hours, which is well above launch volume.

**Failure path:** if `sendOtp` throws, show the shop's phone number and let the customer
call. Don't leave them on a dead screen.

---

## 8. Atomic slot booking

The current design increments `DeliverySlot.booked` inside a transaction, which overbooks
under concurrency. Make the guard part of the write:

```ts
const [slot] = await db.$queryRaw<{ id: string }[]>`
  UPDATE "DeliverySlot"
  SET booked = booked + 1
  WHERE id = ${slotId}
    AND "isOpen" = true
    AND booked < capacity
    AND "cutoffAt" > NOW()
  RETURNING id
`;
if (!slot) throw new Error("SLOT_FULL");
```

Zero rows back means the slot filled or closed — surface that to the customer and let them
pick another. Release the increment on order cancellation and on cron expiry.

---

## 9. Cron jobs

Two routes, both guarded by `CRON_SECRET` in an `x-cron-secret` header:

- `POST /api/cron/generate-slots` — daily 00:30
- `POST /api/cron/expire-unpaid` — every 15 min

Host crontab:

```
30 0 * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/generate-slots
*/15 * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/expire-unpaid
```

Wrap each handler body in a Postgres advisory lock so a second app instance can't double-run
it later:

```ts
const [{ locked }] = await db.$queryRaw<{ locked: boolean }[]>`
  SELECT pg_try_advisory_lock(hashtext('expire-unpaid')) AS locked
`;
if (!locked) return NextResponse.json({ skipped: true });
try {
  // ... job body
} finally {
  await db.$executeRaw`SELECT pg_advisory_unlock(hashtext('expire-unpaid'))`;
}
```

---

## 10. Deployment

`Dockerfile` (works because of `output: "standalone"`):

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json prisma ./
RUN npm ci && npx prisma generate

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

Run the app and Postgres with docker compose on the Oracle box. Put Caddy or nginx in front
for TLS, then Cloudflare in front of that — proxy the DNS record so the origin IP stays
hidden.

Add `GOOGLE_CLIENT_ID`'s authorized redirect URI in Google Cloud Console:
`https://yourdomain.in/api/auth/google/callback`.

---

## 11. Do this before launch

- Nightly `pg_dump` to Cloudflare R2. The Oracle free tier has no SLA — without backups a
  lost instance is a lost business.
- UptimeRobot on a `/api/health` route.
- Razorpay webhook is the only place `paymentStatus` changes, and it must be idempotent.
  That was right in the original design — keep it.

---

## 12. Build order

1. Prisma migration (nullable phone, Google fields, `phoneVerifiedAt`)
2. Google OAuth routes + login page button
3. `/verify-phone` page + WhatsApp `sendOtp`
4. Session refresh in middleware
5. Catalog and cart (Phase 2–4, unchanged from the original plan)
6. Razorpay + webhook
7. Admin dashboard, cron jobs, Telegram alerts
8. Docker + Oracle deploy + Cloudflare + backups
