# Phase 1.5 — Production Hardening & External-Service Readiness

**Parent design:** [`grocery-ecommerce-system-design.md`](../../reference/grocery-ecommerce-system-design.md) (source system design doc).

**Status:** Approved for implementation planning.

**Sequence:** Cross-cutting, sits between Phase 1 (Foundation) and Phase 2 (Admin Catalog). This is not a feature phase — it installs the conventions and safety nets that Phases 2–7 inherit. Doing it now is deliberate: retrofitting error handling and configuration discipline across seven phases' worth of routes costs far more than establishing them across four.

---

## 1. Purpose

Two goals, both driven by decisions made during Phase 1 verification.

**Never block on details the client has not supplied yet.** Every external service (SMS, payments, image hosting, order alerts) sits behind a swappable adapter configured entirely by environment variables. With no credentials present the app runs in a fully working stub mode. When the client hands over keys, they are pasted into the environment — no code changes, no rebuild of application logic. Phases 2–7 proceed at full speed today.

**Never show a raw failure to a user.** Phase 1's end-to-end verification produced a real 500 from a sleeping database. Today no API route in the codebase has a `try`/`catch` and the app has no error boundaries, so any unhandled fault reaches the user as a bare error page. That becomes one shared error path plus friendly error screens.

## 2. Scope

**In:**
- Swappable driver layer for external services, starting with SMS (the only one Phase 1 touches)
- Central API route error wrapper: consistent status codes, safe client messages, full server-side logging
- Database resilience for Neon free-tier suspend/wake: connection timeout + bounded retry on connection-class failures
- Startup environment validation with clear, named failures
- App Router error boundaries: `error.tsx`, `global-error.tsx`, `not-found.tsx`
- GitHub Actions CI: install, generate, lint, typecheck, test, build on every push
- `docs/client-details-needed.md` — the living checklist of what is outstanding from the client
- Seed admin phone moved from a hardcoded placeholder to configuration

**Out:**
- The MSG91/Fast2SMS driver implementation itself. The interface and its selection logic land here; the concrete driver lands when credentials exist. Building it blind against an unseen account would be guesswork.
- Error-tracking/APM services (Sentry and equivalents). Reconsider at launch; the constraint for now is to stay free.
- Redesigning rate limiting, and any Phase 2–7 feature work.
- Load testing and performance tuning. Premature with no traffic and no catalog.

## 3. Design Principle: Configuration, Not Code

The rule every item below follows: **anything the client must supply is configuration; anything we decide is code.** A missing client detail must never be the reason a build stalls, and supplying it later must never require editing application logic.

This has a consequence worth stating plainly. Deploying with stub drivers means real customers cannot receive a real OTP. That is acceptable for a demo, and unacceptable for a live shop — so the failure mode must be loud at deploy time rather than silent until a customer tries to log in. Section 7 handles this.

## 4. External Service Drivers

```
src/lib/services/sms/
  types.ts      # SmsDriver interface — sendSms(to, message): Promise<void>
  console.ts    # stub driver: logs the message, resolves
  index.ts      # selects the driver from env, exports sendSms()
```

`index.ts` picks a driver from `SMS_DRIVER` and exports one function. Callers never learn which driver is active. `src/lib/otp.ts`'s `sendOtp` becomes a thin caller of `sendSms` and loses its `NODE_ENV` branch entirely — that branch is the current production crash (`otp.ts:32` throws `'SMS provider not configured'` and `request/route.ts:46` never catches it).

Adding MSG91 later means adding `msg91.ts`, registering it in the selector, and setting `SMS_DRIVER=msg91`. Nothing else changes. The same shape applies to payments, images, and alerts when their phases arrive; SMS is the template.

**Interface:** semantic per message type, not raw text — `sendOtpSms(to: string, code: string): Promise<void>`. Throws on delivery failure.

The semantic shape is load-bearing, not stylistic. Indian transactional SMS is sent against DLT-registered templates: the provider is given a template id and its variables, not free-form prose. A generic `sendSms(to, message)` would therefore have to be unpicked back into template + variables inside the driver, and would need redesigning the moment a second message type (order confirmation, delivery alert) appeared. One method per message type maps cleanly onto one registered template, which is exactly how the provider and the regulator model it. Later phases add methods; they never reshape the interface.

## 5. API Error Handling

One wrapper in `src/lib/api/handler.ts` that every route handler is wrapped in:

| Cause | Status | Client sees | Server logs |
|---|---|---|---|
| Zod validation failure | 400 | field-level message | full issue list |
| `AppError` (thrown deliberately) | its own | its own safe message | full context |
| Prisma connection failure (P1001/P1002/P1017) | 503 | "Service is starting up, please try again" | full error |
| Anything else | 500 | "Something went wrong" | stack trace + request id |

Every response carries a generated request id, also attached to the log line, so a user-reported failure is traceable to its log entry. Stack traces, Prisma messages, and connection strings are never returned to the client — a Prisma connection error text contains the database hostname, which is exactly what leaked in Phase 1's failure.

The four existing auth routes are migrated onto the wrapper as part of this work, which both proves the abstraction and removes their current unprotected `await`s.

## 6. Database Resilience

The confirmed failure: Neon's free tier suspends the compute after idle; the first request afterwards waited 104 seconds and returned 500, while the identical request against a warm database took 9.3s. Free tier is a deliberate, standing choice, so this must be engineered around rather than paid away.

Two changes:

1. **`connect_timeout=30`** in `DATABASE_URL` (documented in `.env.example`), giving a cold compute room to wake instead of failing mid-handshake.
2. **`withDbRetry` helper** wrapping database calls: on connection-class errors only, up to 3 attempts with backoff of 1s then 2s.

Those numbers are chosen against measured behaviour, not guessed: the observed wake took roughly 90 seconds, and 3 attempts at a 30-second timeout plus backoff covers about 95. A single 30-second timeout would not.

The retry restricts itself to error codes that guarantee the query never executed — `P1001` (cannot reach server) and `P1002` (connect timeout). This distinction is the whole safety argument: a connection that was never established cannot have written anything, so retrying is safe even for writes. `P1017` (server closed the connection) is deliberately **not** retried despite also being connection-class, because it can strike after a statement was sent — leaving execution ambiguous. It still maps to a 503 under §5; it simply gets no automatic second attempt, since a blindly retried write is how you get duplicate orders.

Result: a sleeping database becomes a slow first request, not a broken page. If all retries are exhausted, the user gets the 503 from §5 rather than a 500.

**Residual risk, stated honestly:** this converts a broken page into a slow one; it does not make the first visit after an idle period fast. A shopper who waits ninety seconds has still had a bad experience, even though nothing errored. The two real cures are a paid database tier (ruled out by the standing free-tier decision) or a scheduled ping that keeps the compute awake — but a keep-warm job consumes compute hours continuously, and free-tier allowances are metered in compute hours, so it may simply exhaust the quota and cause a worse outage. Whether a keep-warm schedule fits inside the current free allowance must be checked against Neon's live limits before anyone relies on it; it is deliberately not part of this phase. The honest position is that free-tier hosting carries a first-visit latency cost, and this phase makes that cost survivable rather than eliminating it.

## 7. Environment Validation

`src/lib/env.ts` parses `process.env` once through a Zod schema and exports a typed object. Server-only. Anything needing configuration imports from here rather than reading `process.env` directly.

Rules enforced:
- `DATABASE_URL` — required, must be a valid postgres URL
- `JWT_SECRET` — required, minimum 32 characters (currently unvalidated; a short secret weakens every session token)
- `SMS_DRIVER` — optional in development, defaulting to `console`
- **In production, `SMS_DRIVER` must be set explicitly.** An unset value fails startup with a named error. Setting `console` in production is permitted — for a client demo — but logs a prominent warning on every send.

That last rule is the deliberate answer to §3's consequence: shipping a shop where OTPs vanish into a log becomes an explicit, visible choice rather than an accident discovered by a customer.

Validation failures name the offending variable and what was expected. A missing `JWT_SECRET` currently surfaces as a thrown error during a login attempt; it should surface at boot.

## 8. Error Boundaries

- `src/app/error.tsx` — recoverable route errors, with a working retry via `reset()`
- `src/app/global-error.tsx` — failures in the root layout
- `src/app/not-found.tsx` — 404s

Plain, calm, on-brand copy; no stack traces or error text in production. These are the last line of defence: whatever slips past §5, the user still sees a designed page.

## 9. Continuous Integration

`.github/workflows/ci.yml`, on push and pull request: `npm ci` → `prisma generate` → lint → `tsc --noEmit` → `vitest run` → `next build`.

CI supplies dummy `DATABASE_URL` and `JWT_SECRET` values so §7's validation is satisfied without a live database; no step contacts Neon. Note for the implementation plan: type-checking on the development machine took over six minutes, so CI needs a generous timeout.

The point is regression protection across phases — Phase 5 must not be able to quietly break Phase 1's login.

## 10. Client Details Checklist

`docs/client-details-needed.md`, maintained as the single source of truth for outstanding external dependencies. Each row: what is needed, which phase blocks without it, its lead time, and its current status.

Seeded with the known items: real admin phone number; SMS account plus TRAI DLT template registration (weeks of lead time, needs the client's business documents, and gates real logins); Razorpay keys; Cloudinary account; Telegram bot token; shop details (name, address, delivery fee, minimum order, WhatsApp number); and confirmation of the hosting plan, since Vercel's free Hobby tier is intended for non-commercial projects and a shop selling groceries is commercial.

The last two are flagged risks rather than tasks — decisions for the user, recorded so they cannot be forgotten at launch.

## 11. Testing

Following the existing TDD convention (tests alongside source, Vitest, 34 tests currently passing):

- `env.test.ts` — accepts a valid environment; rejects missing `DATABASE_URL`, short `JWT_SECRET`, and unset production `SMS_DRIVER`
- `handler.test.ts` — each row of §5's table maps to its status; no stack trace or hostname appears in any client payload
- `db-retry.test.ts` — retries P1001/P1002 and succeeds on a later attempt; does not retry non-connection errors; gives up after the cap
- `sms/index.test.ts` — selects the driver named by env; defaults to console in development
- Existing auth route tests must still pass unchanged after migration to the wrapper — that is the proof the refactor preserved behaviour

## 12. Definition of Done

- Every API route goes through the shared error wrapper; no unprotected `await` remains in a route
- `sendOtp` no longer throws on `NODE_ENV=production`; it delegates to the configured driver
- A suspended database produces a retried request and, at worst, a friendly 503 — never a 500
- Invalid or missing configuration fails at startup with a named, actionable message
- `error.tsx`, `global-error.tsx`, and `not-found.tsx` render for their respective failures
- CI passes on a clean checkout and blocks nothing else
- `docs/client-details-needed.md` exists and lists every outstanding client dependency
- Full suite green, production build exits 0, and Phase 1's end-to-end auth flow still verifies via `curl`

## 13. Notes for Verification

Phase 1's verification produced two harness traps worth recording, both of which cost real time:

- **PowerShell 5.1 cannot verify this auth flow.** Its cookie container silently refuses to store a `Secure` cookie received over `http://localhost`, and it drops the restricted `Cookie` request header. Both produce convincing false 401s. Use `curl.exe`.
- **Redirects must be disabled when asserting on a guarded route.** A followed 307 returns 200 from the login page, which reads as a passing `/admin` check. Assert on the status of the first response.
