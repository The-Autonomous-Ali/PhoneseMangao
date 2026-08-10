import { OrderStatus } from '@prisma/client';

/**
 * The one path an order takes through the shop.
 *
 * Forward, one step, no undo. The owner corrects a mis-click by phone, which is
 * rare, and in exchange the OrderEvent trail stays a record of what happened
 * rather than of what was clicked. A dropdown offering any status would let an
 * order jump from PENDING to DELIVERED, skipping the settlement step that
 * decides what the driver collects.
 *
 * PENDING_OTP is deliberately absent. It is the anti-fraud gate for cash
 * orders — a stranger ordering forty kilos to someone else's address has to
 * hold the phone the code was sent to. An admin advance out of it would make
 * that gate optional, which is the same as not having it.
 */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  [OrderStatus.PENDING]: OrderStatus.CONFIRMED,
  [OrderStatus.CONFIRMED]: OrderStatus.PACKED,
  [OrderStatus.PACKED]: OrderStatus.OUT_FOR_DELIVERY,
  [OrderStatus.OUT_FOR_DELIVERY]: OrderStatus.DELIVERED,
};

/** Nothing moves out of these, in either direction. */
const TERMINAL = new Set<OrderStatus>([
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
]);

/** Buttons are named for the act, not the destination: "Mark packed", not "PACKED". */
const ADVANCE_LABELS: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING]: 'Confirm order',
  [OrderStatus.CONFIRMED]: 'Mark packed',
  [OrderStatus.PACKED]: 'Mark out for delivery',
  [OrderStatus.OUT_FOR_DELIVERY]: 'Mark delivered',
};

export function nextStatus(current: OrderStatus): OrderStatus | null {
  return NEXT_STATUS[current] ?? null;
}

export function canCancel(current: OrderStatus): boolean {
  return !TERMINAL.has(current);
}

export function advanceLabel(current: OrderStatus): string | null {
  return ADVANCE_LABELS[current] ?? null;
}
