# Owner Alerts and Dashboard (Phase 6C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the shop owner when an order is confirmed, and show him the day at a glance when he opens the admin.

**Architecture:** The Graph API transport is extracted out of the OTP driver so a second message type can reuse it, and alerts get their own driver module mirroring `services/sms/`. One function, `notifyOrderConfirmed`, is called after the transaction from each of the three places an order reaches CONFIRMED, and never throws. The dashboard is one query module and one page.

**Tech Stack:** Next.js 15.5 (App Router), React 19, Prisma 6.19 + PostgreSQL, Zod 4, Vitest 4, WhatsApp Cloud API (Graph v21.0).

**Spec:** `docs/superpowers/specs/2026-08-10-owner-alerts-and-dashboard-design.md`

## Global Constraints

- **An alert must never fail an order.** `notifyOrderConfirmed` swallows every error into `console.error` and is called only after the surrounding transaction has committed.
- **Never log a Graph API response body or an access token.** Meta's error body echoes the request. Log the status code only — the existing driver's comment at `sms/whatsapp.ts:71` states this rule.
- **Money is a string end to end.** Never `parseFloat` a rupee value; query layers return `.toFixed(2)` strings.
- **`GRAPH_VERSION` stays pinned** at `v21.0`. Meta changes template payload shapes between versions, so tracking "latest" is a breakage on their schedule.
- **Environment is read through `getEnv()`**, never `process.env` directly.
- **All database access goes through `withDbRetry`.**
- **Tests are `.ts` only.** `vitest.config.mts` collects `src/**/*.test.ts`; a `.tsx` test is never run.
- **The UI stays plain** — the frontend design arrives separately.
- Run tests with `npm test`. Typecheck `npx tsc --noEmit`. Lint `npm run lint`.

---

### Task 1: Extract the WhatsApp transport

Two message types need the same POST, the same transport-versus-response error split, and the same "status only" logging rule. Extracting first means the alert driver has nothing to duplicate.

**Files:**
- Create: `src/lib/services/whatsapp-transport.ts`
- Create: `src/lib/services/whatsapp-transport.test.ts`
- Modify: `src/lib/services/sms/whatsapp.ts` (replace its inlined fetch)

**Interfaces:**
- Consumes: `getEnv` from `@/lib/env`
- Produces: `sendWhatsAppTemplate(input: { to: string; templateName: string; components: unknown[] }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/services/whatsapp-transport.test.ts`. Mirror the env-swapping style of `sms/whatsapp.test.ts`, which this file sits beside:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { sendWhatsAppTemplate } from './whatsapp-transport';

const ORIGINAL = { ...process.env };

const CONFIGURED = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  APP_URL: 'https://shop.example.in',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  CRON_SECRET: 'y'.repeat(16),
  IMAGE_DRIVER: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'shopcloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'cloudinary-secret',
  SMS_DRIVER: 'whatsapp',
  WHATSAPP_PHONE_NUMBER_ID: '555000111',
  WHATSAPP_ACCESS_TOKEN: 'system-user-token',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'shop_login_code',
};

function ok(): Response {
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
}

beforeEach(() => {
  process.env = { ...ORIGINAL, ...CONFIGURED } as NodeJS.ProcessEnv;
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('sendWhatsAppTemplate', () => {
  it('posts to the pinned graph version and phone number id', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    await sendWhatsAppTemplate({ to: '+91 98765-43210', templateName: 't', components: [] });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://graph.facebook.com/v21.0/555000111/messages');
  });

  it('strips everything but digits from the recipient', async () => {
    // The Cloud API rejects a leading '+', and customers type spaces and dashes
    // that E.164 validation lets through in other shapes.
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    await sendWhatsAppTemplate({ to: '+91 98765-43210', templateName: 't', components: [] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).to).toBe('919876543210');
  });

  it('sends the template name and components it was given', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const components = [{ type: 'body', parameters: [{ type: 'text', text: 'KD-1042' }] }];

    await sendWhatsAppTemplate({ to: '919876543210', templateName: 'shop_alert', components });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.template.name).toBe('shop_alert');
    expect(body.template.components).toEqual(components);
    expect(body.messaging_product).toBe('whatsapp');
  });

  it('sends the access token as a bearer credential', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    await sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer system-user-token'
    );
  });

  it('wraps a transport failure, since fetch only rejects when unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND'); }));

    await expect(
      sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] })
    ).rejects.toThrow('could not reach the Cloud API');
  });

  it('reports the status without echoing the response body', async () => {
    // Meta's error body quotes the request back, which would put the access
    // token and any template parameter into the server log.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Bearer sensitive' } }), { status: 401 }))
    );

    await expect(
      sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] })
    ).rejects.toThrow(/status 401/);

    await expect(
      sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] })
    ).rejects.not.toThrow(/sensitive/);
  });

  it('throws when credentials are missing rather than posting without them', async () => {
    process.env = { ...ORIGINAL, ...CONFIGURED, WHATSAPP_ACCESS_TOKEN: '' } as NodeJS.ProcessEnv;
    resetEnvCache();
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] })
    ).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- whatsapp-transport`
Expected: FAIL — cannot resolve `./whatsapp-transport`.

- [ ] **Step 3: Write the transport**

Create `src/lib/services/whatsapp-transport.ts`:

```ts
import { getEnv } from '@/lib/env';

// Pinned rather than tracking "latest". Meta keeps a graph version working for
// about two years and changes template payload shapes between versions, so an
// unpinned URL turns into a silent breakage on their schedule, not ours.
const GRAPH_VERSION = 'v21.0';

/**
 * Posts one template message to the WhatsApp Cloud API.
 *
 * Shared by the OTP driver and the owner-alert driver. They send different
 * template categories — Authentication and Utility, which Meta approves
 * separately — but the transport underneath is identical, and duplicating it
 * would mean duplicating the two rules that matter: that `fetch` only rejects
 * when the host is unreachable, so an unhappy Meta needs its own check; and
 * that the error body is never logged, because it quotes the request back and
 * would put the access token and the message parameters into the log.
 */
export async function sendWhatsAppTemplate(input: {
  to: string;
  templateName: string;
  components: unknown[];
}): Promise<void> {
  const env = getEnv();

  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp is not configured');
  }

  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        // Digits only. The Cloud API rejects a leading '+', and customers type
        // numbers with spaces and dashes that E.164 validation lets through in
        // other shapes.
        to: input.to.replace(/\D/g, ''),
        type: 'template',
        template: {
          name: input.templateName,
          language: { code: 'en' },
          components: input.components,
        },
      }),
    });
  } catch (cause) {
    throw new Error('WhatsApp send failed: could not reach the Cloud API', { cause });
  }

  if (!response.ok) {
    throw new Error(`WhatsApp send failed with status ${response.status}`);
  }
}
```

- [ ] **Step 4: Rewrite the OTP driver to use it**

Replace the body of `src/lib/services/sms/whatsapp.ts` entirely:

```ts
import { getEnv } from '@/lib/env';
import { sendWhatsAppTemplate } from '@/lib/services/whatsapp-transport';
import type { SmsDriver } from './types';

/**
 * Delivers OTPs over the WhatsApp Cloud API, direct from Meta — no aggregator.
 *
 * Requires an Authentication-category template. Utility templates are rejected
 * for one-time codes, and only the Authentication format renders the copy-code
 * button, which is why the code is sent twice: once for the message body and
 * once for the button that copies it.
 */
export const whatsappDriver: SmsDriver = {
  name: 'whatsapp',

  async sendOtpSms(to: string, code: string): Promise<void> {
    // Validated at boot by env.ts when SMS_DRIVER is 'whatsapp'. Asserted here
    // so this module reads as total rather than relying on that at a distance.
    const templateName = getEnv().WHATSAPP_AUTH_TEMPLATE_NAME;
    if (!templateName) {
      throw new Error('WhatsApp driver is selected but its credentials are not configured');
    }

    await sendWhatsAppTemplate({
      to,
      templateName,
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: code }],
        },
      ],
    });
  },
};
```

- [ ] **Step 5: Run both test files**

Run: `npm test -- whatsapp`
Expected: PASS. The existing `sms/whatsapp.test.ts` must still pass unchanged — it asserts on the outgoing request, which has not changed shape.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/services/whatsapp-transport.ts src/lib/services/whatsapp-transport.test.ts src/lib/services/sms/whatsapp.ts
git commit -m "refactor: extract the WhatsApp Cloud API transport

Owner alerts need the same POST as OTPs with a different template. Duplicating
it would duplicate the two rules that matter: that fetch only rejects when the
host is unreachable, so an unhappy Meta needs a separate check, and that the
error body is never logged, because it quotes the request back and would put
the access token into the log.

The OTP driver keeps its Authentication-template shape and the outgoing request
is byte-identical, which is what its existing tests assert."
```

---

### Task 2: The alert driver

**Files:**
- Create: `src/lib/services/notify/types.ts`
- Create: `src/lib/services/notify/console.ts`
- Create: `src/lib/services/notify/whatsapp.ts`
- Create: `src/lib/services/notify/index.ts`
- Create: `src/lib/services/notify/index.test.ts`
- Create: `src/lib/services/notify/whatsapp.test.ts`
- Modify: `src/lib/env.ts` (add `WHATSAPP_ALERT_TEMPLATE_NAME`)

**Interfaces:**
- Consumes: `sendWhatsAppTemplate` (Task 1); `getEnv`
- Produces:
  - `interface OwnerAlert { orderNumber, customerName, customerPhone, slot, summary }` — all `string`
  - `interface NotifyDriver { name: string; sendOwnerAlert(alert: OwnerAlert): Promise<void> }`
  - `getNotifyDriver(): NotifyDriver`
  - `sendOwnerAlert(alert: OwnerAlert): Promise<void>`

- [ ] **Step 1: Add the env var**

In `src/lib/env.ts`, beside the other WhatsApp keys in the schema (around line 76):

```ts
    WHATSAPP_ALERT_TEMPLATE_NAME: z.string().optional(),
```

And in the `Env` type (around line 182):

```ts
  WHATSAPP_ALERT_TEMPLATE_NAME?: string;
```

And in the `parseEnv` mapping, beside the others:

```ts
    WHATSAPP_ALERT_TEMPLATE_NAME: blankToUndefined(raw.WHATSAPP_ALERT_TEMPLATE_NAME),
```

**Do not** add it to `WHATSAPP_REQUIRED_KEYS`. The spec is explicit: requiring it would stop the shop booting on an OTP configuration that already works, purely because a second Meta approval is still pending.

- [ ] **Step 2: Write the failing driver tests**

Create `src/lib/services/notify/whatsapp.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/services/whatsapp-transport', () => ({ sendWhatsAppTemplate: vi.fn() }));

import { sendWhatsAppTemplate } from '@/lib/services/whatsapp-transport';
import { resetEnvCache } from '@/lib/env';
import { whatsappNotifyDriver } from './whatsapp';
import type { OwnerAlert } from './types';

const ORIGINAL = { ...process.env };

const ALERT: OwnerAlert = {
  orderNumber: 'KD-1042',
  customerName: 'Ramesh',
  customerPhone: '98765 43210',
  slot: 'Tomorrow morning (7–10am)',
  summary: '3 items · COD · collect ₹480',
};

const CONFIGURED = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  WHATSAPP_ALERT_TEMPLATE_NAME: 'shop_new_order',
  WHATSAPP_OWNER_NUMBER: '+919000000000',
};

beforeEach(() => {
  process.env = { ...ORIGINAL, ...CONFIGURED } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.mocked(sendWhatsAppTemplate).mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('whatsappNotifyDriver', () => {
  it('sends the five fields as template parameters, in order', async () => {
    await whatsappNotifyDriver.sendOwnerAlert(ALERT);

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to: '+919000000000',
      templateName: 'shop_new_order',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'KD-1042' },
            { type: 'text', text: 'Ramesh' },
            { type: 'text', text: '98765 43210' },
            { type: 'text', text: 'Tomorrow morning (7–10am)' },
            { type: 'text', text: '3 items · COD · collect ₹480' },
          ],
        },
      ],
    });
  });

  it('skips rather than throwing when no owner number is set', async () => {
    // An owner who has not given his own number should not stop orders.
    process.env = { ...ORIGINAL, ...CONFIGURED, WHATSAPP_OWNER_NUMBER: '' } as NodeJS.ProcessEnv;
    resetEnvCache();

    await expect(whatsappNotifyDriver.sendOwnerAlert(ALERT)).resolves.toBeUndefined();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('skips rather than throwing when the template is not approved yet', async () => {
    process.env = {
      ...ORIGINAL,
      ...CONFIGURED,
      WHATSAPP_ALERT_TEMPLATE_NAME: '',
    } as NodeJS.ProcessEnv;
    resetEnvCache();

    await expect(whatsappNotifyDriver.sendOwnerAlert(ALERT)).resolves.toBeUndefined();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });
});
```

Create `src/lib/services/notify/index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { getNotifyDriver } from './index';

const ORIGINAL = { ...process.env };

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('getNotifyDriver', () => {
  it('follows SMS_DRIVER, because alerts travel the same channel as OTPs', async () => {
    process.env = { ...ORIGINAL, ...BASE, NODE_ENV: 'development', SMS_DRIVER: 'console' } as NodeJS.ProcessEnv;
    resetEnvCache();

    expect(getNotifyDriver().name).toBe('console');
  });

  it('selects WhatsApp when the OTP channel is WhatsApp', async () => {
    process.env = {
      ...ORIGINAL,
      ...BASE,
      NODE_ENV: 'development',
      SMS_DRIVER: 'whatsapp',
      WHATSAPP_PHONE_NUMBER_ID: '555000111',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_AUTH_TEMPLATE_NAME: 'shop_login_code',
    } as NodeJS.ProcessEnv;
    resetEnvCache();

    expect(getNotifyDriver().name).toBe('whatsapp');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- notify`
Expected: FAIL — cannot resolve `./whatsapp` and `./index`.

- [ ] **Step 4: Write the types**

Create `src/lib/services/notify/types.ts`:

```ts
/**
 * What the owner is told about a new order.
 *
 * Structured rather than a formatted string because the two channels want
 * different things: WhatsApp needs positional template parameters, the console
 * needs a readable line. Handing a driver a finished sentence would force the
 * WhatsApp one to pull apart what it had just been given, and would break the
 * day the wording changed.
 */
export interface OwnerAlert {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  /** Already readable: "Tomorrow morning (7–10am)". */
  slot: string;
  /** "3 items · COD · collect ₹480" */
  summary: string;
}

export interface NotifyDriver {
  name: string;
  sendOwnerAlert(alert: OwnerAlert): Promise<void>;
}
```

- [ ] **Step 5: Write the console driver**

Create `src/lib/services/notify/console.ts`:

```ts
import type { NotifyDriver, OwnerAlert } from './types';

/** What runs until the Utility template is approved, and in development. */
export const consoleNotifyDriver: NotifyDriver = {
  name: 'console',

  async sendOwnerAlert(alert: OwnerAlert): Promise<void> {
    console.log(
      `[alert] New order ${alert.orderNumber} — ${alert.customerName} ${alert.customerPhone} — ` +
        `${alert.slot} — ${alert.summary}`
    );
  },
};
```

- [ ] **Step 6: Write the WhatsApp driver**

Create `src/lib/services/notify/whatsapp.ts`:

```ts
import { getEnv } from '@/lib/env';
import { sendWhatsAppTemplate } from '@/lib/services/whatsapp-transport';
import type { NotifyDriver, OwnerAlert } from './types';

/**
 * Sends the owner a new-order alert over WhatsApp.
 *
 * A Utility-category template, which Meta approves separately from the
 * Authentication one the OTP driver uses — Authentication templates are
 * accepted only for one-time codes. The five parameters are positional and
 * must match the approved template exactly; their order is documented in
 * docs/superpowers/specs/2026-08-10-owner-alerts-and-dashboard-design.md.
 *
 * Missing configuration skips the alert instead of throwing. The template has
 * to clear Meta's review before it exists, and the owner may not have given his
 * own number — neither is a reason to make noise on a path that runs
 * immediately after a payment has been captured.
 */
export const whatsappNotifyDriver: NotifyDriver = {
  name: 'whatsapp',

  async sendOwnerAlert(alert: OwnerAlert): Promise<void> {
    const env = getEnv();
    const to = env.WHATSAPP_OWNER_NUMBER;
    const templateName = env.WHATSAPP_ALERT_TEMPLATE_NAME;

    if (!to || !templateName) {
      console.warn(
        '[alert] WhatsApp alerts are not configured ' +
          '(WHATSAPP_OWNER_NUMBER, WHATSAPP_ALERT_TEMPLATE_NAME); skipping.'
      );
      return;
    }

    await sendWhatsAppTemplate({
      to,
      templateName,
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: alert.orderNumber },
            { type: 'text', text: alert.customerName },
            { type: 'text', text: alert.customerPhone },
            { type: 'text', text: alert.slot },
            { type: 'text', text: alert.summary },
          ],
        },
      ],
    });
  },
};
```

- [ ] **Step 7: Write the selector**

Create `src/lib/services/notify/index.ts`:

```ts
import { getEnv } from '@/lib/env';
import { consoleNotifyDriver } from './console';
import { whatsappNotifyDriver } from './whatsapp';
import type { NotifyDriver, OwnerAlert } from './types';

export type { NotifyDriver, OwnerAlert } from './types';

/**
 * Alerts follow `SMS_DRIVER` rather than having a switch of their own.
 *
 * They travel the same channel as OTPs by the owner's decision, so a second
 * variable would be two names for one choice — and an opportunity for them to
 * disagree, leaving alerts pointed at a channel the shop no longer uses.
 */
export function getNotifyDriver(): NotifyDriver {
  switch (getEnv().SMS_DRIVER) {
    case 'console':
      return consoleNotifyDriver;
    case 'whatsapp':
      return whatsappNotifyDriver;
  }
}

export async function sendOwnerAlert(alert: OwnerAlert): Promise<void> {
  return getNotifyDriver().sendOwnerAlert(alert);
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- notify`
Expected: PASS.

- [ ] **Step 9: Document the new variable**

Add to `.env.example`, beside the other WhatsApp keys:

```
# Owner alerts. Both optional: alerts are skipped when either is missing, so a
# pending Meta approval cannot stop the shop booting. The template is Utility
# category with five body parameters — order number, customer name, phone,
# slot, summary. See docs/superpowers/specs/2026-08-10-owner-alerts-and-dashboard-design.md
WHATSAPP_ALERT_TEMPLATE_NAME=
WHATSAPP_OWNER_NUMBER=
```

Check whether `WHATSAPP_OWNER_NUMBER` is already listed before adding a second copy.

- [ ] **Step 10: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/services/notify src/lib/env.ts .env.example
git commit -m "feat: an owner-alert driver over the same channel as OTPs

Structured rather than a formatted string, because WhatsApp wants positional
template parameters and the console wants a readable line; handing a driver a
finished sentence would make the WhatsApp one pull apart what it had just been
given.

Selection follows SMS_DRIVER rather than adding a switch of its own — one
choice should not have two names that can disagree.

Both new settings are optional and a missing one skips the alert. The Utility
template has to clear Meta's review before it exists, and a pending approval
must not stop the shop booting on OTP configuration that already works."
```

---

### Task 3: Fire the alert on confirmation

**Files:**
- Create: `src/lib/notify-order.ts`
- Create: `src/lib/notify-order.test.ts`
- Modify: `src/app/api/orders/[id]/verify-otp/route.ts` (after the transaction)
- Modify: `src/app/api/webhooks/razorpay/route.ts` (after the transaction)
- Modify: `src/app/(admin)/admin/orders/actions.ts` (in `advanceOrderStatus`)

**Interfaces:**
- Consumes: `sendOwnerAlert`, `OwnerAlert` (Task 2); `formatSlotDate`, `formatSlotType`, `formatRupees` from `@/lib/format`
- Produces: `notifyOrderConfirmed(orderId: string): Promise<void>` — never throws

- [ ] **Step 1: Write the failing test**

Create `src/lib/notify-order.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { order: { findUnique: vi.fn() } } }));
vi.mock('@/lib/services/notify', () => ({ sendOwnerAlert: vi.fn() }));

import { Prisma, PaymentMethod, PaymentStatus, SlotType } from '@prisma/client';
import { db } from '@/lib/db';
import { sendOwnerAlert } from '@/lib/services/notify';
import { notifyOrderConfirmed } from './notify-order';

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o_1',
    orderNumber: 'KD-1042',
    paymentMethod: PaymentMethod.COD,
    paymentStatus: PaymentStatus.UNPAID,
    grandTotal: new Prisma.Decimal('480'),
    finalTotal: null,
    deliveryAddress: { name: 'Ramesh', phone: '+919876543210' },
    slot: { date: new Date('2026-08-11T00:00:00Z'), slotType: SlotType.MORNING },
    items: [{ id: 'oi_1' }, { id: 'oi_2' }, { id: 'oi_3' }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(db.order.findUnique).mockReset().mockResolvedValue(orderRow() as never);
  vi.mocked(sendOwnerAlert).mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('notifyOrderConfirmed', () => {
  it('describes the order the way the owner reads it', async () => {
    await notifyOrderConfirmed('o_1');

    const alert = vi.mocked(sendOwnerAlert).mock.calls[0][0];
    expect(alert.orderNumber).toBe('KD-1042');
    expect(alert.customerName).toBe('Ramesh');
    expect(alert.customerPhone).toBe('+919876543210');
    expect(alert.summary).toContain('3 items');
    expect(alert.summary).toContain('COD');
    expect(alert.summary).toContain('480');
  });

  it('reads the customer from the address snapshot taken at checkout', async () => {
    // That snapshot is what the driver works from; the saved address may have
    // been edited or deleted since.
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({ deliveryAddress: { name: 'Sita', phone: '+911111111111' } }) as never
    );

    await notifyOrderConfirmed('o_1');

    expect(vi.mocked(sendOwnerAlert).mock.calls[0][0].customerName).toBe('Sita');
  });

  it('says nothing is to be collected on a prepaid order', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(
      orderRow({
        paymentMethod: PaymentMethod.ONLINE,
        paymentStatus: PaymentStatus.PAID,
      }) as never
    );

    await notifyOrderConfirmed('o_1');

    expect(vi.mocked(sendOwnerAlert).mock.calls[0][0].summary).toContain('paid');
  });

  it('NEVER throws when the channel fails', async () => {
    // Everything this runs after — a captured payment, a confirmed delivery —
    // is already committed. A failed alert must not surface as a failed order.
    vi.mocked(sendOwnerAlert).mockRejectedValue(new Error('Meta is down'));

    await expect(notifyOrderConfirmed('o_1')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('never throws when the order cannot be read', async () => {
    vi.mocked(db.order.findUnique).mockRejectedValue(new Error('connection lost'));

    await expect(notifyOrderConfirmed('o_1')).resolves.toBeUndefined();
  });

  it('does nothing quietly when the order has vanished', async () => {
    vi.mocked(db.order.findUnique).mockResolvedValue(null as never);

    await expect(notifyOrderConfirmed('o_1')).resolves.toBeUndefined();
    expect(sendOwnerAlert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- notify-order`
Expected: FAIL — cannot resolve `./notify-order`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/notify-order.ts`:

```ts
import { PaymentStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { sendOwnerAlert } from '@/lib/services/notify';
import { formatRupees, formatSlotDate, formatSlotType } from '@/lib/format';

/**
 * Tells the owner an order has been confirmed.
 *
 * Never throws, and every caller invokes it after its transaction has
 * committed. By the time this runs the money may already have been captured
 * and the slot claimed; a Meta outage must not turn that into a failed request
 * the customer sees. The shop losing a notification is recoverable — the order
 * is on the admin screen either way — and `orders/route.ts` already takes this
 * position for the confirmation OTP, for the same reason.
 */
export async function notifyOrderConfirmed(orderId: string): Promise<void> {
  try {
    const order = await withDbRetry(() =>
      db.order.findUnique({
        where: { id: orderId },
        include: {
          items: { select: { id: true } },
          slot: { select: { date: true, slotType: true } },
        },
      })
    );

    if (!order) return;

    const address = (order.deliveryAddress ?? {}) as { name?: string; phone?: string };
    const total = (order.finalTotal ?? order.grandTotal).toFixed(2);
    const count = order.items.length;

    const payment =
      order.paymentStatus === PaymentStatus.PAID
        ? `${order.paymentMethod} · paid`
        : `${order.paymentMethod} · collect ${formatRupees(total)}`;

    await sendOwnerAlert({
      orderNumber: order.orderNumber,
      customerName: address.name ?? 'Customer',
      customerPhone: address.phone ?? '',
      slot: `${formatSlotDate(order.slot.date.toISOString())} ${formatSlotType(order.slot.slotType)}`,
      summary: `${count} item${count === 1 ? '' : 's'} · ${payment}`,
    });
  } catch (error) {
    console.error(`[alert] could not notify the owner about order ${orderId}`, error);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- notify-order`
Expected: PASS, 6 tests.

- [ ] **Step 5: Call it from the COD confirmation**

In `src/app/api/orders/[id]/verify-otp/route.ts`, add the import:

```ts
import { notifyOrderConfirmed } from '@/lib/notify-order';
```

and after the `withDbRetry(() => db.$transaction(...))` block that sets CONFIRMED, before the response:

```ts
  // After the commit, and awaited only so a serverless invocation is not frozen
  // mid-request. It never throws.
  await notifyOrderConfirmed(id);
```

- [ ] **Step 6: Call it from the Razorpay webhook**

In `src/app/api/webhooks/razorpay/route.ts`, add the same import, and after the transaction that sets `status: OrderStatus.CONFIRMED` commits, before the handler returns:

```ts
  await notifyOrderConfirmed(order.id);
```

Place it outside the transaction callback. Inside, a slow Meta would hold a database transaction open across a network call to a third party.

- [ ] **Step 7: Call it from the admin advance action**

In `src/app/(admin)/admin/orders/actions.ts`, add the import, and inside `advanceOrderStatus` after `if (!moved) return { ok: false, error: LOST_RACE };`:

```ts
    // Only on the transition that means "a new order is real". The owner does
    // not need a message when he himself clicks Packed.
    if (to === OrderStatus.CONFIRMED) await notifyOrderConfirmed(orderId);
```

- [ ] **Step 8: Run everything and commit**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all tests pass.

```bash
git add src/lib/notify-order.ts src/lib/notify-order.test.ts "src/app/api/orders/[id]/verify-otp/route.ts" src/app/api/webhooks/razorpay/route.ts "src/app/(admin)/admin/orders/actions.ts"
git commit -m "feat: alert the owner when an order is confirmed

Fired from the three places an order reaches CONFIRMED — the cash OTP route,
the Razorpay webhook, and the admin advance — each after its transaction has
committed.

It never throws, and that is the whole design. By the time it runs the payment
may already be captured and the slot claimed, so a Meta outage must not become
a failed request the customer sees. Losing a notification is recoverable: the
order is on the admin screen either way.

Outside the transaction, too. Inside it, a slow Meta would hold a database
transaction open across a call to a third party."
```

---

### Task 4: Dashboard queries

**Files:**
- Modify: `prisma/schema.prisma` (add `@@index([deliveredAt])` to `Order`)
- Create: `prisma/migrations/<timestamp>_order_delivered_at_index/migration.sql` (generated)
- Create: `src/lib/admin/dashboard-queries.ts`
- Create: `src/lib/admin/dashboard-queries.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface DashboardSummary { date, collected, upcoming, needsAction, lowStock }`
  - `getDashboard(date: string): Promise<DashboardSummary>`

- [ ] **Step 1: Add the index**

In `prisma/schema.prisma`, in `model Order`, beside the existing indexes:

```prisma
  // The dashboard's revenue query filters on this on every load, and none of
  // the other three indexes covers it.
  @@index([deliveredAt])
```

Then:

```bash
npx prisma migrate dev --name order_delivered_at_index
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/admin/dashboard-queries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    order: { findMany: vi.fn(), groupBy: vi.fn() },
    variant: { findMany: vi.fn() },
  },
}));

import { Prisma, OrderStatus, PaymentMethod, PaymentStatus, SlotType } from '@prisma/client';
import { db } from '@/lib/db';
import { getDashboard } from './dashboard-queries';

function delivered(overrides: Record<string, unknown> = {}) {
  return {
    paymentMethod: PaymentMethod.COD,
    finalTotal: new Prisma.Decimal('480'),
    grandTotal: new Prisma.Decimal('520'),
    ...overrides,
  };
}

function upcoming(overrides: Record<string, unknown> = {}) {
  return {
    grandTotal: new Prisma.Decimal('300'),
    slot: { slotType: SlotType.MORNING },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(db.order.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(db.order.groupBy).mockReset().mockResolvedValue([] as never);
  vi.mocked(db.variant.findMany).mockReset().mockResolvedValue([] as never);
});

describe('getDashboard — collected', () => {
  it('sums the settled figure, not the estimate', async () => {
    // The driver handed over finalTotal. grandTotal is what was quoted before
    // anything was weighed, and it is not money anyone received.
    vi.mocked(db.order.findMany).mockResolvedValueOnce([delivered()] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.collected.total).toBe('480.00');
    expect(summary.collected.orders).toBe(1);
  });

  it('splits cash from prepaid, because only one is in the cash box', async () => {
    vi.mocked(db.order.findMany).mockResolvedValueOnce([
      delivered({ paymentMethod: PaymentMethod.COD, finalTotal: new Prisma.Decimal('480') }),
      delivered({ paymentMethod: PaymentMethod.ONLINE, finalTotal: new Prisma.Decimal('320') }),
    ] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.collected.cash).toBe('480.00');
    expect(summary.collected.prepaid).toBe('320.00');
    expect(summary.collected.total).toBe('800.00');
  });

  it('reports zeroes rather than nothing on a day with no deliveries', async () => {
    const summary = await getDashboard('2026-08-11');

    expect(summary.collected).toEqual({
      orders: 0,
      total: '0.00',
      cash: '0.00',
      prepaid: '0.00',
    });
  });

  it('asks only for orders delivered on the day in question', async () => {
    await getDashboard('2026-08-11');

    const where = vi.mocked(db.order.findMany).mock.calls[0][0]!.where as {
      deliveredAt: { gte: Date; lt: Date };
    };
    expect(where.deliveredAt.gte).toEqual(new Date('2026-08-11T00:00:00.000Z'));
    expect(where.deliveredAt.lt).toEqual(new Date('2026-08-12T00:00:00.000Z'));
  });
});

describe('getDashboard — upcoming', () => {
  it('groups what is still to come by slot, at the quoted price', async () => {
    vi.mocked(db.order.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        upcoming({ slot: { slotType: SlotType.MORNING }, grandTotal: new Prisma.Decimal('300') }),
        upcoming({ slot: { slotType: SlotType.MORNING }, grandTotal: new Prisma.Decimal('200') }),
        upcoming({ slot: { slotType: SlotType.EVENING }, grandTotal: new Prisma.Decimal('150') }),
      ] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.upcoming).toEqual([
      { slotType: SlotType.MORNING, orders: 2, estimated: '500.00' },
      { slotType: SlotType.EVENING, orders: 1, estimated: '150.00' },
    ]);
  });
});

describe('getDashboard — needs action', () => {
  it('counts the whole backlog, not just the selected day', async () => {
    // An order left PENDING since yesterday is exactly what has to be seen. A
    // date filter would hide it on the screen built to surface it.
    vi.mocked(db.order.groupBy).mockResolvedValue([
      { status: OrderStatus.PENDING, _count: 2 },
      { status: OrderStatus.CONFIRMED, _count: 5 },
    ] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.needsAction.pending).toBe(2);
    expect(summary.needsAction.confirmed).toBe(5);
    expect(summary.needsAction.packed).toBe(0);

    const args = vi.mocked(db.order.groupBy).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).not.toHaveProperty('placedAt');
    expect(args.where).not.toHaveProperty('deliveredAt');
  });
});

describe('getDashboard — low stock', () => {
  it('lists variants at or below the threshold', async () => {
    vi.mocked(db.variant.findMany).mockResolvedValue([
      { label: '1 kg', stockQty: 3, product: { name: 'Onion' } },
    ] as never);

    const summary = await getDashboard('2026-08-11');

    expect(summary.lowStock).toEqual([
      { productName: 'Onion', variantLabel: '1 kg', stockQty: 3 },
    ]);
  });

  it('excludes untracked stock rather than reporting it as none left', async () => {
    // stockQty null means the shop does not count this line — normal for loose
    // produce. Showing it as "0 left" would bury the real warnings.
    await getDashboard('2026-08-11');

    const where = vi.mocked(db.variant.findMany).mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where.stockQty).toEqual({ not: null, lte: 5 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- dashboard-queries`
Expected: FAIL — cannot resolve `./dashboard-queries`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/admin/dashboard-queries.ts`:

```ts
import { OrderStatus, PaymentMethod, SlotType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';

/**
 * Below this, a variant is worth warning about. A constant rather than a
 * setting: one number, and no evidence yet that the owner wants to tune it. It
 * can become a setting the day he asks.
 */
const LOW_STOCK_THRESHOLD = 5;

/** Statuses that are waiting on somebody. */
const OPEN_STATUSES = [
  OrderStatus.PENDING_OTP,
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
];

export interface DashboardSummary {
  date: string;
  collected: { orders: number; total: string; cash: string; prepaid: string };
  upcoming: { slotType: SlotType; orders: number; estimated: string }[];
  needsAction: { pendingOtp: number; pending: number; confirmed: number; packed: number };
  lowStock: { productName: string; variantLabel: string; stockQty: number }[];
}

function calendarDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * The shop's day, for the admin landing screen.
 *
 * `collected` and `upcoming` are scoped to the date. `needsAction` and
 * `lowStock` are not, on purpose: an order left PENDING since yesterday is
 * precisely what the owner has to see, and the older it gets the less likely a
 * date filter is to show it.
 */
export async function getDashboard(date: string): Promise<DashboardSummary> {
  const dayStart = calendarDay(date);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const deliveredOrders = await withDbRetry(() =>
    db.order.findMany({
      where: { deliveredAt: { gte: dayStart, lt: dayEnd } },
      select: { paymentMethod: true, finalTotal: true, grandTotal: true },
    })
  );

  const upcomingOrders = await withDbRetry(() =>
    db.order.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        slot: { date: dayStart },
      },
      select: { grandTotal: true, slot: { select: { slotType: true } } },
    })
  );

  const openCounts = await withDbRetry(() =>
    db.order.groupBy({
      by: ['status'],
      where: { status: { in: OPEN_STATUSES } },
      _count: true,
    })
  );

  const lowStock = await withDbRetry(() =>
    db.variant.findMany({
      // `not: null` matters as much as the threshold. A null stockQty means the
      // shop does not track that line, which is normal for loose produce, and
      // listing it as "0 left" would bury the warnings that are real.
      where: { stockQty: { not: null, lte: LOW_STOCK_THRESHOLD }, isAvailable: true },
      select: { label: true, stockQty: true, product: { select: { name: true } } },
      orderBy: { stockQty: 'asc' },
    })
  );

  let cash = new Prisma.Decimal(0);
  let prepaid = new Prisma.Decimal(0);
  for (const order of deliveredOrders) {
    // finalTotal is written on every delivered order by the settlement step, so
    // this needs no fallback. grandTotal is only ever the estimate.
    const amount = order.finalTotal ?? order.grandTotal;
    if (order.paymentMethod === PaymentMethod.COD) cash = cash.add(amount);
    else prepaid = prepaid.add(amount);
  }

  const bySlot = new Map<SlotType, { orders: number; estimated: Prisma.Decimal }>();
  for (const order of upcomingOrders) {
    const existing = bySlot.get(order.slot.slotType) ?? {
      orders: 0,
      estimated: new Prisma.Decimal(0),
    };
    existing.orders += 1;
    existing.estimated = existing.estimated.add(order.grandTotal);
    bySlot.set(order.slot.slotType, existing);
  }

  const counted = (status: OrderStatus): number =>
    openCounts.find((row) => row.status === status)?._count ?? 0;

  return {
    date,
    collected: {
      orders: deliveredOrders.length,
      total: cash.add(prepaid).toFixed(2),
      cash: cash.toFixed(2),
      prepaid: prepaid.toFixed(2),
    },
    upcoming: [...bySlot.entries()].map(([slotType, totals]) => ({
      slotType,
      orders: totals.orders,
      estimated: totals.estimated.toFixed(2),
    })),
    needsAction: {
      pendingOtp: counted(OrderStatus.PENDING_OTP),
      pending: counted(OrderStatus.PENDING),
      confirmed: counted(OrderStatus.CONFIRMED),
      packed: counted(OrderStatus.PACKED),
    },
    lowStock: lowStock.map((variant) => ({
      productName: variant.product.name,
      variantLabel: variant.label,
      stockQty: variant.stockQty ?? 0,
    })),
  };
}
```

- [ ] **Step 5: Run the test**

Run: `npm test -- dashboard-queries`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations src/lib/admin/dashboard-queries.ts src/lib/admin/dashboard-queries.test.ts
git commit -m "feat: read the shop's day for the dashboard

Revenue is settled money on the delivery day: finalTotal, summed over orders
delivered that day, split cash from prepaid because only one of them is in the
cash box. Settlement writes finalTotal on every delivered order, so this needs
no fallback to the estimate.

The needs-action counts are deliberately not scoped to the selected date. An
order left PENDING since yesterday is exactly what has to be seen, and the
older it gets the less likely a date filter is to show it.

Low stock excludes a null stockQty rather than reading it as zero. Null means
the shop does not count that line, which is normal for loose produce, and
listing it would bury the warnings that are real.

Adds an index on deliveredAt: the revenue query filters on it on every load of
the screen the owner opens most, and none of the other three covered it."
```

---

### Task 5: The dashboard page

**Files:**
- Modify: `src/app/(admin)/admin/page.tsx` (replace the 10-line stub)
- Test: none — `.tsx` is not collected. Logic is covered by Task 4.

**Interfaces:**
- Consumes: `getDashboard`, `DashboardSummary` (Task 4); `formatRupees`, `formatSlotType` from `@/lib/format`
- Produces: the `/admin` route

- [ ] **Step 1: Replace the stub**

Replace `src/app/(admin)/admin/page.tsx` entirely:

```tsx
import { getDashboard } from '@/lib/admin/dashboard-queries';
import { formatRupees, formatSlotType } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Today in India. The offset is explicit because the container runs UTC. */
function todayInIndia(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default async function AdminDashboardPage() {
  const summary = await getDashboard(todayInIndia());
  const action = summary.needsAction;
  const openTotal = action.pendingOtp + action.pending + action.confirmed + action.packed;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Today</h1>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Collected today"
          value={formatRupees(summary.collected.total)}
          hint={`${summary.collected.orders} delivered · cash ${formatRupees(
            summary.collected.cash
          )} · prepaid ${formatRupees(summary.collected.prepaid)}`}
        />
        <Stat
          label="Still to come"
          value={String(summary.upcoming.reduce((n, slot) => n + slot.orders, 0))}
          hint="orders due today"
        />
        <Stat label="Waiting on you" value={String(openTotal)} hint="across all dates" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Still to come, by slot</h2>
        {summary.upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing left to deliver today.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {summary.upcoming.map((slot) => (
              <li key={slot.slotType} className="flex items-center gap-4 p-3">
                <span className="font-medium">{formatSlotType(slot.slotType)}</span>
                <span className="text-muted-foreground">{slot.orders} orders</span>
                {/* Labelled an estimate: weights are settled at the door, so
                    this is not what will be collected. */}
                <span className="ml-auto">~{formatRupees(slot.estimated)} est.</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Waiting on you</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-4">
          <li className="rounded-lg border p-3">
            Unconfirmed <strong className="block text-lg">{action.pendingOtp}</strong>
          </li>
          <li className="rounded-lg border p-3">
            To confirm <strong className="block text-lg">{action.pending}</strong>
          </li>
          <li className="rounded-lg border p-3">
            To pack <strong className="block text-lg">{action.confirmed}</strong>
          </li>
          <li className="rounded-lg border p-3">
            To send out <strong className="block text-lg">{action.packed}</strong>
          </li>
        </ul>
        <a href="/admin/orders" className="mt-2 inline-block text-sm underline">
          Go to orders
        </a>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Low stock</h2>
        {summary.lowStock.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing running low. Items without a tracked count are not listed here.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {summary.lowStock.map((item) => (
              <li
                key={`${item.productName}-${item.variantLabel}`}
                className="flex items-center gap-4 p-3"
              >
                <span>{item.productName}</span>
                <span className="text-muted-foreground">{item.variantLabel}</span>
                <span className="ml-auto font-medium">{item.stockQty} left</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify everything**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`
Expected: clean, and `/admin` listed as dynamic (`ƒ`) in the build output — it was static before, since the stub read nothing.

- [ ] **Step 3: Manual check**

```bash
npm run dev
```

Sign in as the seeded admin and open `/admin`. With no orders it should show zeroes and empty states rather than errors. Place an order, confirm it, and check the alert prints to the server log under `[alert]` while `SMS_DRIVER=console`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/page.tsx"
git commit -m "feat: the admin dashboard

Collected money, what is still to come by slot, what is waiting on the owner,
and what is running low. The slot totals are labelled estimates because weights
are settled at the door and the collected figure will differ.

The empty low-stock state says that untracked items are not listed, since
otherwise an empty list reads as 'nothing is low' when it may mean 'nothing is
counted'."
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §1.1 WhatsApp, Utility template | 2 |
| §1.2 structured alert interface | 2 |
| §1.3 a failed alert never fails an order | 3 |
| §1.4 revenue is settled money on the delivery day | 4 |
| §2.1 `whatsapp-transport.ts` extracted | 1 |
| §2.2 `notify/` driver module | 2 |
| §2.3 the Meta template + env vars | 2 (steps 1, 9) |
| §2.4 `notify-order.ts`, three callers | 3 |
| §2.5 `dashboard-queries.ts` | 4 |
| §3 `@@index([deliveredAt])` | 4 (step 1) |
| §4 the `/admin` page | 5 |
| §5 all five test files | 1–4 |

**Type consistency checked:** `OwnerAlert`'s five fields are defined in Task 2, populated in Task 3, and asserted in both. `sendOwnerAlert` is the exported function in Task 2 and the mocked import in Task 3. `getDashboard(date: string)` returns `DashboardSummary` in Task 4 and is consumed with those exact property names in Task 5 — `collected.total`, `upcoming[].estimated`, `needsAction.pendingOtp`, `lowStock[].stockQty`.

**Ordering note:** Task 4's mock returns `db.order.findMany` twice via `mockResolvedValueOnce`, so the implementation must issue the delivered query before the upcoming one. That order is fixed in Task 4 Step 4 and the test depends on it.
