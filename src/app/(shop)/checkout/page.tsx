import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';
import { getShopSettings } from '@/lib/settings';
import { SHOP_NAME } from '@/lib/constants';
import { CheckoutForm } from './checkout-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Checkout — ${SHOP_NAME}`,
  robots: { index: false },
};

export default async function CheckoutPage() {
  const session = await getSession();
  // Guarded here rather than in middleware, which is scoped to admin paths.
  if (!session) redirect('/login?next=/checkout');

  const [user, addresses, settings] = await withDbRetry(() =>
    Promise.all([
      db.user.findUnique({ where: { id: session.userId } }),
      db.address.findMany({
        where: { userId: session.userId },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      }),
      getShopSettings(),
    ])
  );

  if (!user) redirect('/login?next=/checkout');
  // The order route refuses without this anyway; sending them now saves a
  // filled-in form being thrown away at the last step.
  if (!user.phoneVerifiedAt) redirect('/verify-phone?next=/checkout');

  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Checkout</h1>
      <CheckoutForm
        addresses={addresses.map((address) => ({
          id: address.id,
          label: address.label,
          line1: address.line1,
          line2: address.line2,
          landmark: address.landmark,
          city: address.city,
          pincode: address.pincode,
          isDefault: address.isDefault,
        }))}
        minOrderValue={settings.minOrderValue}
        shopOpen={settings.shopOpen}
        paymentsEnabled={settings.paymentsEnabled}
        customerName={user.name}
        customerPhone={user.phone}
      />
    </div>
  );
}
