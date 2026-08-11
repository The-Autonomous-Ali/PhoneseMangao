import type { SlotPickingList } from '@/lib/admin/order-queries';
import { formatRupees, formatSlotDate, formatSlotType, recipientName } from '@/lib/format';

/**
 * One print job in two parts.
 *
 * The first sheet is what to pull from stock, totalled across every order in
 * the slot — that is the sourcing job. What follows is one slip per order, each
 * starting a fresh sheet of paper, which is the packing job. They are different
 * tasks and the packer should not need a screen for the second.
 */
export function PickingSheet({ list }: { list: SlotPickingList }) {
  return (
    <div className="text-sm">
      <header className="mb-4 border-b pb-2">
        <h1 className="text-lg font-semibold">
          {formatSlotType(list.slotType)} · {formatSlotDate(list.date)}
        </h1>
        <p className="text-muted-foreground">
          {list.orderCount} order{list.orderCount === 1 ? '' : 's'}
        </p>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold tracking-wide uppercase">Pull from stock</h2>
        <table className="w-full">
          <tbody>
            {list.aggregate.map((line) => (
              <tr key={`${line.productName}-${line.variantLabel}`} className="border-b">
                <td className="py-1">{line.productName}</td>
                <td className="py-1 text-muted-foreground">{line.variantLabel}</td>
                <td className="py-1 text-right font-medium">× {line.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {list.orders.map((slip) => (
        <section key={slip.orderNumber} className="mb-6 border-t pt-3 break-before-page">
          <h2 className="font-semibold">
            {slip.orderNumber} · {recipientName(slip.address.name)} · {slip.address.phone}
          </h2>

          <ul className="my-2">
            {slip.items.map((item) => (
              <li key={`${item.productName}-${item.variantLabel}`} className="py-0.5">
                ☐ {item.productName} · {item.variantLabel} × {item.quantity}
              </li>
            ))}
          </ul>

          <p>
            {slip.address.line1}
            {slip.address.line2 ? `, ${slip.address.line2}` : ''}
            {slip.address.landmark ? ` (near ${slip.address.landmark})` : ''} · {slip.address.pincode}
          </p>

          <p className="font-medium">
            {slip.amountToCollect
              ? `${slip.paymentMethod} — collect ${formatRupees(slip.amountToCollect)}`
              : 'Paid online — collect nothing'}
          </p>

          {slip.customerNote && <p className="italic">“{slip.customerNote}”</p>}
        </section>
      ))}
    </div>
  );
}
