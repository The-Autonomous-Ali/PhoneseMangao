import { describe, it, expect } from 'vitest';
import { OrderStatus } from '@prisma/client';
import { nextStatus, canCancel, advanceLabel } from './order-status';

describe('nextStatus', () => {
  it('walks the delivery pipeline one step at a time', () => {
    expect(nextStatus(OrderStatus.PENDING)).toBe(OrderStatus.CONFIRMED);
    expect(nextStatus(OrderStatus.CONFIRMED)).toBe(OrderStatus.PACKED);
    expect(nextStatus(OrderStatus.PACKED)).toBe(OrderStatus.OUT_FOR_DELIVERY);
    expect(nextStatus(OrderStatus.OUT_FOR_DELIVERY)).toBe(OrderStatus.DELIVERED);
  });

  it('refuses to advance an order still awaiting its OTP', () => {
    // PENDING_OTP is the anti-fraud gate for cash orders. Letting admin skip it
    // would mean a van going out on an order nobody confirmed by phone.
    expect(nextStatus(OrderStatus.PENDING_OTP)).toBeNull();
  });

  it('has no step after a terminal status', () => {
    expect(nextStatus(OrderStatus.DELIVERED)).toBeNull();
    expect(nextStatus(OrderStatus.CANCELLED)).toBeNull();
    expect(nextStatus(OrderStatus.FAILED)).toBeNull();
  });
});

describe('canCancel', () => {
  it('allows cancellation from every non-terminal status', () => {
    expect(canCancel(OrderStatus.PENDING_OTP)).toBe(true);
    expect(canCancel(OrderStatus.PENDING)).toBe(true);
    expect(canCancel(OrderStatus.CONFIRMED)).toBe(true);
    expect(canCancel(OrderStatus.PACKED)).toBe(true);
    expect(canCancel(OrderStatus.OUT_FOR_DELIVERY)).toBe(true);
  });

  it('refuses to cancel a finished order', () => {
    expect(canCancel(OrderStatus.DELIVERED)).toBe(false);
    expect(canCancel(OrderStatus.CANCELLED)).toBe(false);
    expect(canCancel(OrderStatus.FAILED)).toBe(false);
  });
});

describe('advanceLabel', () => {
  it('names the action rather than the destination state', () => {
    expect(advanceLabel(OrderStatus.CONFIRMED)).toBe('Mark packed');
    expect(advanceLabel(OrderStatus.OUT_FOR_DELIVERY)).toBe('Mark delivered');
  });

  it('is null where there is nothing to advance to', () => {
    expect(advanceLabel(OrderStatus.DELIVERED)).toBeNull();
    expect(advanceLabel(OrderStatus.PENDING_OTP)).toBeNull();
  });
});
