# CHANGES.md — implementation report

**Date:** 2026-08-09 · **Branch:** `phase1.5-hardening` · **Spec:** [`../CHANGES.md`](../CHANGES.md)

Everything in `CHANGES.md` that specifies a change to make now is implemented.
Three items are explicitly deferred by the spec itself to later phases, and one
has no caller yet. Both are detailed under "Not done" below.

## Verification

All four run clean as of this report:

| Command | Result |
|---|---|
| `npm test` | **176 passed** / 20 files (was 63 / 12) |
| `npx tsc --noEmit` | clean — *also fixes the pre-existing failure recorded in the Phase 1.5 resume notes* |
| `npm run lint` | clean |
| `npm run build` | succeeds, 21 routes |

The Prisma migration was applied to the live Neon database with
`prisma migrate deploy` (`migrate dev` needs a TTY this shell does not have).

---

## Status by section

| § | Section | Status |
|---|---|---|
| 1 | Infrastructure | Done — realised in `docker-compose.yml`, `Caddyfile`, `docs/deployment.md` |
| 2 | `next.config.ts` | Done |
| 3 | `.env.example` | Done — MSG91 removed, every listed variable present and validated |
| 4 | Prisma schema | Done — migration written and applied |
| 5 | Google sign-in | Done — including account linking |
| 6 | Rolling session refresh | Done |
| 7 | WhatsApp OTP | Done — including the call-the-shop failure path on **both** OTP entry points |
| 8 | Atomic slot booking | Helpers built and tested; **nothing calls `bookSlot` yet** |
| 9 | Cron jobs | Done |
| 10 | Deployment | Done |
| 11 | Before launch | Scripted — backups and `/api/health`. UptimeRobot itself is an account action |
| 12 | Build order | Steps 1–4 and 8 done; **5, 6 and part of 7 are later phases** |

---

## Deviations from the spec

Six places where following the text literally would have produced broken or
worse code. Each preserves the intent.

### 1. WhatsApp went into the driver registry, not into `otp.ts`

§7 says "replace the `throw` in `src/lib/otp.ts`". That `throw` no longer
exists — OTP delivery moved behind a driver registry (`src/lib/services/sms/`,
selected by `SMS_DRIVER`) in the hardening work that preceded this spec.
Inlining a `fetch` into `otp.ts` would have bypassed that layer and broken
`sms/index.test.ts`.

Implemented as `src/lib/services/sms/whatsapp.ts` — same Meta endpoint, same
payload, same env vars. Selecting `SMS_DRIVER=whatsapp` without credentials now
fails at boot instead of on every login.

### 2. §6's widened matcher needed the auth gate inverted

As written, widening the matcher to every route while keeping the existing
handler would redirect anonymous visitors from `/` to `/login` — and from
`/login` to `/login`, a loop. The spec's own note ("keep the admin role check
gated to `/admin` paths inside the handler") implies the restructure; it is now
explicit. The role check covers `/admin` and `/api/admin`; every other path only
refreshes.

### 3. Refresh had to skip `/api/auth/*`

Not in the spec, and a real bug without it. Middleware runs before the route
handler, so on `POST /api/auth/logout` it would re-issue the session cookie the
logout handler just cleared — two `Set-Cookie` headers for one name, and logout
silently failing. The same applies to the phone-verify merge, which issues a
cookie for a different user row.

### 4. §9's advisory lock leaks under Prisma's connection pool

`pg_try_advisory_lock` is **session**-scoped. Prisma hands out pooled
connections, so a lock taken on one connection and released on another never
lifts — the `finally` runs, the lock stays, and every later run skips forever. A
process killed mid-job never reaches its `finally` at all.

Changed to `pg_try_advisory_xact_lock` inside a transaction, which Postgres
releases at commit or rollback either way.

### 5. §10's Dockerfile had a broken `COPY`

`COPY package*.json prisma ./` copies the *contents* of `prisma/` into `/app`,
so `schema.prisma` lands at `/app/schema.prisma` and `prisma generate` reports
no schema found. Split into two `COPY`s naming the destination directory.

Also added, because the spec's version would not have run: `openssl` (Prisma's
query engine links against OpenSSL 3, absent from `node:22-alpine`),
`HOSTNAME=0.0.0.0` (the standalone server binds loopback by default, so Caddy
could not reach it), a non-root runtime user, and a separate `migrator` stage so
migrations are an explicit `docker compose run` rather than something an
automatic 3am restart can trigger.

### 6. §5's account-linking rule needed a stop condition

"Merge into the older row" is correct when one row is a legacy phone-only
account. But if **both** rows have a `googleId`, they are two different people
as far as this app can tell, and merging hands one of them the other's order
history. That case returns 409 and asks the customer to call the shop.

---

## Correction made on review

§7 requires that a failed send show the shop's phone number rather than leave
the customer on a dead screen. This was initially built into `/verify-phone`
only — the login path (`/api/auth/otp/request`) still had a bare
`await sendOtp(...)`, which produced a 500 and a generic "try again".

Both paths now return 502 on a delivery failure, and both forms render the
shop's number from `NEXT_PUBLIC_WHATSAPP_NUMBER`. The OTP row is written before
the send in both cases, so the code stays valid if delivery recovers.

---

## Not done, and why

**§8 has no caller.** `bookSlot` and `releaseSlot` are written and tested, and
`expire-unpaid` uses `releaseSlot`. Nothing calls `bookSlot` because nothing
places orders yet. It gets wired in when checkout is built.

**§12 steps 5, 6 and part of 7 are later phases.** Step 5 is "Catalog and cart
(Phase 2–4, unchanged from the original plan)" — the spec defers to the original
design doc. Step 6 is Razorpay. Step 7's cron jobs are done; its admin dashboard
and Telegram alerts are not — `src/app/(admin)/admin/*` are still the stub pages
that say "will land here in a later phase". §12 is a roadmap, not a changelist.

**§11's Razorpay note is a keep-this-property instruction** with nothing yet to
keep. The new `expire-unpaid` sweep respects it: it sets `status` and
`cancelReason`, never `paymentStatus`.

---

## Files

### New — application

| Path | Purpose |
|---|---|
| `src/lib/google.ts` | OAuth URL building and code exchange, profile parsed with zod |
| `src/lib/slots.ts` | `bookSlot` / `releaseSlot`, guard inside the `UPDATE` |
| `src/lib/cron.ts` | Constant-time secret check, transaction-scoped advisory lock |
| `src/lib/services/sms/whatsapp.ts` | WhatsApp Cloud API driver |
| `src/app/api/auth/google/start/route.ts` | Issues CSRF state, redirects to Google |
| `src/app/api/auth/google/callback/route.ts` | Verifies state, upserts on email, issues session |
| `src/app/api/auth/phone/request/route.ts` | Session-gated OTP send, `PHONE_VERIFY` |
| `src/app/api/auth/phone/verify/route.ts` | Confirms code, merges duplicate accounts |
| `src/app/api/cron/generate-slots/route.ts` | Seven days of slots, idempotent |
| `src/app/api/cron/expire-unpaid/route.ts` | Cancels stale online orders, frees slots |
| `src/app/api/health/route.ts` | Health check that queries the database |
| `src/app/verify-phone/{page,verify-phone-form}.tsx` | Phone confirmation screen |
| `src/app/login/login-form.tsx` | Login form split out so the page can read `?error=` server-side |

Each of the first six ships a `.test.ts` beside it.

### New — deployment

`Dockerfile` · `.dockerignore` · `docker-compose.yml` · `Caddyfile` ·
`deploy/crontab` · `deploy/cron-job.sh` · `deploy/backup.sh` ·
`docs/deployment.md`

### Modified

`next.config.ts` · `.env.example` · `prisma/schema.prisma` ·
`src/lib/env.ts` · `src/lib/otp.ts` · `src/lib/services/sms/index.ts` ·
`src/middleware.ts` · `src/app/login/page.tsx` ·
`src/app/api/auth/otp/request/route.ts` — plus the four test files that cover them.

### Migration

`prisma/migrations/20260809195515_google_signin_and_phone_verification/`

`phone` becomes nullable; `email`, `googleId`, `imageUrl`, `phoneVerifiedAt`
added; unique indexes on `email` and `googleId`, plus a lookup index on `email`.
Safe on existing rows — dropping `NOT NULL` is a widening change, and both new
unique columns start entirely `NULL`, which Postgres treats as distinct.

---

## Needs your action before launch

1. **Google Cloud Console** — register `https://yourdomain.in/api/auth/google/callback`
   as an authorized redirect URI. It must byte-match what the app builds from
   `APP_URL`; a trailing slash on either side fails at the consent screen.
2. **Meta** — add a payment method to the WhatsApp Business Account (without one
   the number is deactivated and every send fails), create the template under
   the **Authentication** category, and generate a **System User** token. The
   token shown in the dev dashboard expires in 24 hours.
3. **Cloudflare** — set SSL/TLS to **Full (strict)**. "Flexible" talks plain HTTP
   to the origin, so session cookies would cross the internet in the clear while
   the browser still shows a padlock.
4. **Restore-test one backup** before launch. An untested backup is a guess.
5. **UptimeRobot** — point it at `/api/health`.

Full sequence in [`deployment.md`](deployment.md).

## Worth deciding later

**Rolling refresh puts a `Set-Cookie` on nearly every response,** which makes
those responses uncacheable by Cloudflare. That is the literal behaviour §6 asks
for and it is fine at this volume. If catalog pages should be CDN-cacheable
later, the fix is to refresh only when the token is past half its life, which
needs `verifySession` to expose the expiry.

## Resolved by this work

The Phase 1.5 resume notes flagged three open questions about serverless
hosting — the ~95s `withDbRetry` envelope exceeding function duration caps,
`maxDuration` configuration, and Vercel Hobby being non-commercial. Moving to a
long-running Node process on Oracle makes all three moot.
