import { SHOP_NAME } from '@/lib/constants';

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayInstance {
  open(): void;
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

/**
 * Loads Razorpay's widget script once.
 *
 * Loaded on demand rather than on every page: it is only needed by whoever
 * actually reaches checkout and chooses to pay online, and it is a third-party
 * script on the critical path of every other page otherwise.
 */
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load Razorpay')));
      return;
    }

    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Razorpay'));
    document.body.appendChild(script);
  });
}

export interface PaymentHandoff {
  razorpayKeyId: string;
  razorpayOrderId: string;
  orderNumber: string;
  amountRupees: string;
  customerName?: string | null;
  customerPhone?: string | null;
}

/**
 * Hands the customer to Razorpay and resolves once the window closes.
 *
 * Resolving says only that the widget is done, never that payment succeeded —
 * the callback Razorpay hands back is a UX signal and is trivially forged. The
 * order becomes paid when the signed webhook says so, and nowhere else, so the
 * caller's only job here is to send them somewhere that reflects that.
 */
export async function openRazorpayCheckout(handoff: PaymentHandoff): Promise<void> {
  await loadCheckoutScript();

  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error('Could not load Razorpay');

  await new Promise<void>((resolve) => {
    const instance = new Razorpay({
      key: handoff.razorpayKeyId,
      // The amount is fixed on the server against this order id. It is passed
      // for display only; nothing here can change what is charged.
      order_id: handoff.razorpayOrderId,
      name: SHOP_NAME,
      description: `Order ${handoff.orderNumber}`,
      prefill: {
        name: handoff.customerName ?? undefined,
        contact: handoff.customerPhone ?? undefined,
      },
      retry: { enabled: false },
      handler: () => resolve(),
      modal: { ondismiss: () => resolve() },
    });

    instance.open();
  });
}
