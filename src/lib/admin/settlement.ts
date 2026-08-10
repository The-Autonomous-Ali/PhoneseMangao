import { Prisma, UnitType } from '@prisma/client';

/** One order line, as the settlement form receives it. All money is a string. */
export interface SettleableLine {
  id: string;
  productName: string;
  variantLabel: string;
  unitType: UnitType;
  /** Price of one pack, e.g. '160.00' for a 5 kg bag. */
  unitPrice: string;
  /** Pack size in the line's unit, e.g. '5.000'. */
  unitValue: string;
  /** Number of packs ordered. */
  quantity: number;
  lineTotal: string;
}

export interface SettledLine {
  id: string;
  /** Null where nothing was entered, or where the line is not settleable. */
  actualQuantity: string | null;
  adjustedTotal: string | null;
  /** What this line contributes to the final bill: the adjustment, or the original. */
  effectiveTotal: string;
}

/**
 * Only loose produce settles.
 *
 * A "500 g" pack is 500 g because that is what is printed on it; re-weighing it
 * at the door would be re-negotiating a fixed price. A zero pack size is
 * excluded because the per-unit rate divides by it — a bad row should drop out
 * of settlement, not take the delivery down with it.
 */
export function isSettleable(line: SettleableLine): boolean {
  return line.unitType === UnitType.KG && !new Prisma.Decimal(line.unitValue).isZero();
}

/** What the customer ordered, in the line's unit — the input's starting value. */
export function orderedQuantity(line: SettleableLine): string {
  return new Prisma.Decimal(line.unitValue).mul(line.quantity).toFixed(3);
}

/**
 * The rate the adjustment is priced at.
 *
 * The stored price is per pack, so a 5 kg bag at Rs 160 has to become Rs 32/kg
 * before a 4.7 kg delivery can be priced. Treating the pack price as a per-kilo
 * price would bill Rs 752 for that bag.
 */
function pricePerUnit(line: SettleableLine): Prisma.Decimal {
  return new Prisma.Decimal(line.unitPrice).div(line.unitValue);
}

/**
 * Applies the weights the owner entered at the door.
 *
 * A missing entry means "as ordered" and leaves the line untouched — the owner
 * only types into the boxes that changed, and reading a blank box as zero would
 * quietly zero out every line he skipped. An explicit '0' is different, and is
 * honoured: it is how an item that never made it onto the van gets recorded.
 */
export function settleLines(
  lines: SettleableLine[],
  actualByLineId: Record<string, string>
): { lines: SettledLine[]; itemsTotal: string } {
  let itemsTotal = new Prisma.Decimal(0);

  const settled = lines.map((line): SettledLine => {
    const raw = actualByLineId[line.id];
    const entered = raw !== undefined && raw !== '';

    if (!isSettleable(line) || !entered) {
      itemsTotal = itemsTotal.add(line.lineTotal);
      return {
        id: line.id,
        actualQuantity: null,
        adjustedTotal: null,
        effectiveTotal: line.lineTotal,
      };
    }

    const actual = new Prisma.Decimal(raw);
    const adjustedTotal = actual.mul(pricePerUnit(line)).toFixed(2);
    itemsTotal = itemsTotal.add(adjustedTotal);

    return {
      id: line.id,
      actualQuantity: actual.toFixed(3),
      adjustedTotal,
      effectiveTotal: adjustedTotal,
    };
  });

  return { lines: settled, itemsTotal: itemsTotal.toFixed(2) };
}

/**
 * What the driver collects.
 *
 * The delivery fee is the one stored on the order, never a fresh
 * `calculateTotals()` against the adjusted items total. A basket that earned
 * free delivery at Rs 520 keeps it even when the scales bring it to Rs 480:
 * charging for delivery after the fact, because the shop's weighing went the
 * shop's way, is not a bill anyone can defend at a doorstep.
 */
export function finalTotalFor(adjustedItemsTotal: string, storedDeliveryFee: string): string {
  return new Prisma.Decimal(adjustedItemsTotal).add(storedDeliveryFee).toFixed(2);
}
