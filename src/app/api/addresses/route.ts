import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';
import { addressSchema } from '@/lib/validation/address';
import { isServiceable } from '@/lib/serviceability';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const addresses = await withDbRetry(() =>
    db.address.findMany({
      where: { userId: session.userId },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    })
  );

  return NextResponse.json({ addresses });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please check the address', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const input = parsed.data;

  // Checked at save time as well as at checkout. Letting somebody store an
  // address the shop cannot reach only to reject it at the last step wastes
  // their typing and reads as a bug.
  const { serviceable } = await isServiceable({ pincode: input.pincode });
  if (!serviceable) {
    return NextResponse.json(
      {
        error: `We do not deliver to ${input.pincode} yet.`,
        fieldErrors: { pincode: ['Outside our delivery area'] },
      },
      { status: 400 }
    );
  }

  const address = await withDbRetry(() =>
    db.$transaction(async (tx) => {
      const existing = await tx.address.count({ where: { userId: session.userId } });

      // The first address is the default whether or not they ticked the box —
      // otherwise checkout has nothing preselected and every order starts with
      // an unnecessary choice.
      const isDefault = input.isDefault || existing === 0;

      if (isDefault) {
        await tx.address.updateMany({
          where: { userId: session.userId },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          userId: session.userId,
          label: input.label,
          line1: input.line1,
          line2: input.line2,
          landmark: input.landmark,
          city: input.city,
          pincode: input.pincode,
          isDefault,
        },
      });
    })
  );

  return NextResponse.json({ address }, { status: 201 });
}
