import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';
import { PincodeManager } from './pincode-manager';

export const dynamic = 'force-dynamic';

export default async function AdminPincodesPage() {
  const pincodes = await withReadRetry(() =>
    db.servicePincode.findMany({ orderBy: { pincode: 'asc' } })
  );

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Delivery areas</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        A customer can only check out if their PIN code is listed and switched on.
      </p>

      <PincodeManager
        pincodes={pincodes.map((row) => ({
          id: row.id,
          pincode: row.pincode,
          area: row.area,
          isActive: row.isActive,
        }))}
      />
    </div>
  );
}
