import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  toPaise,
  createRazorpayOrder,
  verifyWebhookSignature,
  RazorpayNotConfiguredError,
} from './razorpay';
import { resetEnvCache } from '@/lib/env';

const ORIGINAL = { ...process.env };

const CONFIGURED = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  RAZORPAY_KEY_ID: 'rzp_test_abc123',
  RAZORPAY_KEY_SECRET: 'super-secret-key',
  RAZORPAY_WEBHOOK_SECRET: 'webhook-secret',
};

function setEnv(overrides: Record<string, string | undefined> = {}) {
  process.env = { ...ORIGINAL, ...CONFIGURED, ...overrides } as NodeJS.ProcessEnv;
  resetEnvCache();
}

function sign(body: string, secret = 'webhook-secret'): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

beforeEach(() => setEnv());

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('toPaise', () => {
  it('converts whole rupees', () => {
    expect(toPaise('280.00')).toBe(28000);
  });

  it('converts paise without floating-point loss', () => {
    // 280.10 * 100 is 28009.999999999996 as a float, which truncates to the
    // customer being billed a paisa less than the order says.
    expect(toPaise('280.10')).toBe(28010);
  });

  it('handles a large basket', () => {
    expect(toPaise('12345.67')).toBe(1234567);
  });

  it('handles zero', () => {
    expect(toPaise('0.00')).toBe(0);
  });

  it('throws rather than rounding a sub-paisa amount', () => {
    // Razorpay rejects a non-integer amount; guessing here would silently
    // change what the customer is charged.
    expect(() => toPaise('10.001')).toThrow(/whole paise/);
  });
});

describe('createRazorpayOrder', () => {
  function ok(body: unknown = { id: 'order_ABC', amount: 28000, currency: 'INR' }) {
    return new Response(JSON.stringify(body), { status: 200 });
  }

  it('posts the amount in paise with Basic auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    await createRazorpayOrder({ amountRupees: '280.00', receipt: 'PM260809-ABCD' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('rzp_test_abc123:super-secret-key').toString('base64')}`
    );
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ amount: 28000, currency: 'INR', receipt: 'PM260809-ABCD' });
  });

  it('returns the created order id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));

    const order = await createRazorpayOrder({ amountRupees: '280.00', receipt: 'R1' });

    expect(order.id).toBe('order_ABC');
  });

  it('throws a typed error when Razorpay is not configured', async () => {
    setEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, RAZORPAY_WEBHOOK_SECRET: undefined });

    await expect(
      createRazorpayOrder({ amountRupees: '280.00', receipt: 'R1' })
    ).rejects.toBeInstanceOf(RazorpayNotConfiguredError);
  });

  it('throws with the status when Razorpay rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 400 })));

    await expect(createRazorpayOrder({ amountRupees: '1.00', receipt: 'R1' })).rejects.toThrow(/400/);
  });

  it('never puts the key secret in the thrown error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('super-secret-key', { status: 401 }))
    );

    await expect(createRazorpayOrder({ amountRupees: '1.00', receipt: 'R1' })).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('super-secret-key') })
    );
  });

  it('throws when the response carries no order id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ amount: 100 })));

    await expect(createRazorpayOrder({ amountRupees: '1.00', receipt: 'R1' })).rejects.toThrow(
      /no id/
    );
  });

  it('wraps a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    await expect(createRazorpayOrder({ amountRupees: '1.00', receipt: 'R1' })).rejects.toThrow(
      /could not reach/
    );
  });
});

describe('verifyWebhookSignature', () => {
  const body = '{"event":"payment.captured"}';

  it('accepts a correctly signed body', () => {
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyWebhookSignature(body, sign(body, 'not-the-secret'))).toBe(false);
  });

  it('rejects when the body has been altered', () => {
    // This is the whole point: the endpoint marks orders paid, so the bytes
    // that were signed must be the bytes that are acted on.
    const signature = sign(body);
    expect(verifyWebhookSignature('{"event":"payment.failed"}', signature)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyWebhookSignature(body, null)).toBe(false);
  });

  it('rejects a signature of the wrong length instead of throwing', () => {
    // timingSafeEqual throws on a length mismatch, which would turn a forged
    // header into a 500 rather than a clean rejection.
    expect(verifyWebhookSignature(body, 'abcd')).toBe(false);
  });

  it('rejects a non-hex signature instead of throwing', () => {
    expect(verifyWebhookSignature(body, 'zzzz-not-hex')).toBe(false);
  });

  it('trusts nothing when no webhook secret is configured', () => {
    // Refusing a real webhook is recoverable. Accepting a forged one is not.
    setEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, RAZORPAY_WEBHOOK_SECRET: undefined });

    expect(verifyWebhookSignature(body, sign(body))).toBe(false);
  });

  it('is sensitive to whitespace, since the raw bytes are what is signed', () => {
    const signature = sign(body);
    expect(verifyWebhookSignature(` ${body}`, signature)).toBe(false);
  });
});
