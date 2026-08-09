import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getEnv } from '@/lib/env';

const RAZORPAY_ORDERS_URL = 'https://api.razorpay.com/v1/orders';

/** Thrown when payments are switched on but not configured. */
export class RazorpayNotConfiguredError extends Error {
  constructor() {
    super('Razorpay is not configured');
    this.name = 'RazorpayNotConfiguredError';
  }
}

function credentials(): { keyId: string; keySecret: string } {
  const env = getEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new RazorpayNotConfiguredError();
  return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET };
}

/**
 * Rupees as a decimal string to the integer paise Razorpay bills in.
 *
 * Razorpay rejects a non-integer amount, and a float multiplication is exactly
 * where one appears: 280.10 * 100 is 28009.999999999996 in binary floating
 * point, which truncates to a customer being charged a paisa less than the
 * order says. Decimal multiplication then an integer check keeps the two in
 * step, and throws rather than guessing if they ever diverge.
 */
export function toPaise(rupees: string): number {
  const paise = new Prisma.Decimal(rupees).mul(100);
  if (!paise.isInteger()) {
    throw new Error(`Amount ${rupees} does not convert to whole paise`);
  }
  return paise.toNumber();
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

/**
 * Opens a payment on Razorpay's side.
 *
 * The amount is sent from our own total, never from anything the browser
 * supplied — the widget is handed an order id and cannot alter what it costs.
 */
export async function createRazorpayOrder(input: {
  amountRupees: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const { keyId, keySecret } = credentials();

  let response: Response;
  try {
    response = await fetch(RAZORPAY_ORDERS_URL, {
      method: 'POST',
      headers: {
        // Razorpay authenticates the orders API with HTTP Basic, not a bearer.
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: toPaise(input.amountRupees),
        currency: 'INR',
        // Our order number, so a payment in their dashboard can be traced back
        // without a lookup table.
        receipt: input.receipt,
        notes: input.notes,
      }),
    });
  } catch (cause) {
    throw new Error('Razorpay order creation failed: could not reach the API', { cause });
  }

  // Status only. Razorpay's error body echoes the request, and this message
  // reaches the server log.
  if (!response.ok) {
    throw new Error(`Razorpay order creation failed with status ${response.status}`);
  }

  const order = (await response.json()) as Partial<RazorpayOrder>;
  if (!order.id) throw new Error('Razorpay order creation returned no id');

  return { id: order.id, amount: order.amount ?? 0, currency: order.currency ?? 'INR' };
}

/**
 * Confirms a webhook really came from Razorpay.
 *
 * This is the only thing standing between the internet and an endpoint that
 * marks orders paid, so it verifies the exact bytes received — a body parsed to
 * JSON and re-serialised will not produce the same HMAC, and the check would
 * fail for every legitimate call.
 *
 * Constant-time comparison: a byte-by-byte `===` leaks how much of a forged
 * signature was right, which is enough to construct a valid one given enough
 * attempts.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const env = getEnv();
  // No configured secret means no way to tell Razorpay from anyone else, so
  // nothing is trusted. Refusing a real webhook is recoverable; accepting a
  // forged one is not.
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;

  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** The publishable key the browser widget needs. Never the secret. */
export function getPublicKeyId(): string {
  return credentials().keyId;
}
