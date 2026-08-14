import { describe, it, expect } from 'vitest';
import {
  whatsappLink,
  cartOrderMessage,
  productEnquiryMessage,
  floatingButtonMessage,
  type OrderLine,
} from './whatsapp-order';

const LINES: OrderLine[] = [
  { productName: 'Onions', variantLabel: '1 kg', quantity: 2, lineTotal: '70.00' },
  { productName: 'Tomatoes', variantLabel: '500 g', quantity: 1, lineTotal: '25.00' },
];

describe('whatsappLink', () => {
  it('builds a wa.me link with the message attached', () => {
    const url = whatsappLink('+91 90000-00000', 'Hello there');

    expect(url).toBe('https://wa.me/919000000000?text=Hello%20there');
  });

  it('strips everything but digits from the number', () => {
    // wa.me rejects a leading '+', and shop owners type numbers with spaces
    // and dashes.
    expect(whatsappLink('+91 98765 43210', 'x')).toContain('/919876543210?');
  });

  it('returns null when the shop has not given a number', () => {
    // The caller hides the button rather than linking somewhere broken. A dead
    // WhatsApp button reads as the shop ignoring you.
    expect(whatsappLink('', 'x')).toBeNull();
    expect(whatsappLink('   ', 'x')).toBeNull();
  });

  it('returns null for a number with no digits in it', () => {
    expect(whatsappLink('call us!', 'x')).toBeNull();
  });

  it('works with no message at all', () => {
    expect(whatsappLink('919000000000')).toBe('https://wa.me/919000000000');
  });

  it('encodes newlines and rupee signs so the link survives', () => {
    const url = whatsappLink('919000000000', 'a\nb ₹5')!;

    expect(url).not.toContain('\n');
    expect(url).toContain('%0A');
    expect(decodeURIComponent(url.split('text=')[1])).toBe('a\nb ₹5');
  });
});

describe('cartOrderMessage', () => {
  it('lists what they picked, with the total', () => {
    const message = cartOrderMessage({
      shopName: 'Phone Se Mangao',
      lines: LINES,
      total: '125.00',
    });

    expect(message).toContain("I'd like to order from Phone Se Mangao");
    expect(message).toContain('Onions 1 kg × 2 — ₹70');
    expect(message).toContain('Tomatoes 500 g × 1 — ₹25');
    expect(message).toContain('Total: ₹125');
  });

  it('includes the delivery area when one is known', () => {
    const message = cartOrderMessage({
      shopName: 'Shop',
      lines: LINES,
      total: '125.00',
      pincode: '400069',
    });

    expect(message).toContain('Deliver to: 400069');
  });

  it('leaves the area out rather than saying "undefined"', () => {
    const message = cartOrderMessage({ shopName: 'Shop', lines: LINES, total: '125.00' });

    expect(message).not.toMatch(/Deliver to/);
    expect(message).not.toMatch(/undefined/);
  });

  it('summarises a very long basket instead of building an unusable link', () => {
    // A URL carries the whole message. Thirty lines of groceries makes a link
    // long enough that some clients truncate it, and a truncated order is
    // worse than a short one — the shop would pack what survived.
    const many: OrderLine[] = Array.from({ length: 40 }, (_, i) => ({
      productName: `Item ${i}`,
      variantLabel: '1 kg',
      quantity: 1,
      lineTotal: '10.00',
    }));

    const message = cartOrderMessage({ shopName: 'Shop', lines: many, total: '400.00' });

    expect(message).toMatch(/and \d+ more items/);
    expect(message.length).toBeLessThan(1500);
    // The total still reflects the whole basket, not just what is listed.
    expect(message).toContain('Total: ₹400');
  });

  it('says so plainly when the basket is empty', () => {
    const message = cartOrderMessage({ shopName: 'Shop', lines: [], total: '0.00' });

    expect(message).toContain("I'd like to order from Shop");
    expect(message).not.toContain('Total:');
  });
});

describe('floatingButtonMessage', () => {
  it('summarises the basket when it has items', () => {
    const message = floatingButtonMessage({
      shopName: 'Phone Se Mangao',
      cart: { lines: LINES, total: '125.00' },
    });

    expect(message).toContain("I'd like to order from Phone Se Mangao");
    expect(message).toContain('Onions 1 kg × 2 — ₹70');
    expect(message).toContain('Total: ₹125');
  });

  it('carries the delivery area through when one is known', () => {
    const message = floatingButtonMessage({
      shopName: 'Shop',
      cart: { lines: LINES, total: '125.00', pincode: '400069' },
    });

    expect(message).toContain('Deliver to: 400069');
  });

  it('falls back to a plain greeting when there is no basket at all', () => {
    // Someone browsing the home page has never added anything — the basket
    // being null, not just empty, is the ordinary state of a first visit.
    const message = floatingButtonMessage({ shopName: 'Shop', cart: null });

    expect(message).toBe('Hi! I have a question about Shop.');
  });

  it('falls back to a plain greeting rather than an empty order list', () => {
    // cartOrderMessage would say "I'd like to order from Shop:" with nothing
    // under it, which reads as a mistake rather than a question.
    const message = floatingButtonMessage({
      shopName: 'Shop',
      cart: { lines: [], total: '0.00' },
    });

    expect(message).toBe('Hi! I have a question about Shop.');
  });
});

describe('productEnquiryMessage', () => {
  it('names the item and its size, so the shop knows before replying', () => {
    const message = productEnquiryMessage({
      shopName: 'Phone Se Mangao',
      productName: 'Onions',
      variantLabel: '1 kg',
      price: '35.00',
    });

    expect(message).toContain('Onions');
    expect(message).toContain('1 kg');
    expect(message).toContain('₹35');
  });
});
