import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { getSession } from '@/lib/auth';
import { addressSchema } from '@/lib/validation/address';
import { isServiceable, serviceabilityMessage } from '@/lib/serviceability';

export const dynamic = 'force-dynamic';

/**
 * Loads an address only if it belongs to the caller.
 *
 * The ownership predicate is part of the query, not a check after the fetch.
 * Address ids are guessable enough to try, and a `findUnique` followed by an
 * `if` is one early return away from leaking somebody's home address.
 */
async function findOwned(id: string, userId: string) {
  return withDbRetry(() => db.address.findFirst({ where: { id, userId } }));
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await context.params;
  const existing = await findOwned(id, session.userId);
  // 404 rather than 403: confirming that an id exists but belongs to somebody
  // else is itself information not worth giving away.
  if (!existing) return NextResponse.json({ error: 'Address not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please check the address', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const input = parsed.data;

  const check = await isServiceable({ pincode: input.pincode, lat: input.lat, lng: input.lng });
  if (!check.serviceable) {
    return NextResponse.json(
      {
        error: serviceabilityMessage(check, input.pincode),
        code: check.reason,
        fieldErrors: { pincode: ['Outside our delivery area'] },
      },
      { status: 400 }
    );
  }

  const address = await withDbRetry(() =>
    db.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.address.updateMany({
          where: { userId: session.userId },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id },
        data: {
          label: input.label ?? null,
          recipientName: input.recipientName ?? null,
          line1: input.line1,
          line2: input.line2 ?? null,
          landmark: input.landmark ?? null,
          city: input.city,
          pincode: input.pincode,
          // `?? null` rather than leaving it out: clearing a pin has to be
          // possible, and an omitted key would silently keep the old one.
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          // Never demote the last remaining default to nothing — checkout would
          // then have no address preselected.
          isDefault: input.isDefault || existing.isDefault,
        },
      });
    })
  );

  return NextResponse.json({ address });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await context.params;
  const existing = await findOwned(id, session.userId);
  if (!existing) return NextResponse.json({ error: 'Address not found' }, { status: 404 });

  await withDbRetry(() =>
    db.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });

      // Promote another address so the account is never left without a default.
      if (existing.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId: session.userId },
          orderBy: { id: 'asc' },
        });
        if (next) {
          await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    })
  );

  return NextResponse.json({ ok: true });
}
