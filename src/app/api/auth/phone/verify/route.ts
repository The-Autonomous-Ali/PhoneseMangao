import { NextRequest, NextResponse } from 'next/server';
import type { Role, User } from '@prisma/client';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db-retry';
import { getSession, signSession, setSessionCookie } from '@/lib/auth';
import { consumeOtp } from '@/lib/otp';
import { otpVerifySchema } from '@/lib/validation/auth';

/**
 * Merging must not demote the shop owner. Reaching this code takes control of
 * both the Google account and the phone, so the person merging already holds
 * whichever identity carried the role — keeping the higher one grants nothing
 * they could not already reach.
 */
function higherRole(a: Role, b: Role): Role {
  return a === 'ADMIN' || b === 'ADMIN' ? 'ADMIN' : 'CUSTOMER';
}

/**
 * Folds two rows for the same person into one and returns the survivor.
 *
 * The older row wins because it is the one carrying order history that the
 * customer and the shop both refer to. Its addresses and orders are reassigned
 * before the duplicate is deleted — Order.userId is a required relation, so a
 * delete-first order would be refused by the foreign key.
 */
async function mergeUsers(older: User, newer: User, phone: string): Promise<User> {
  return db.$transaction(async (tx) => {
    await tx.address.updateMany({ where: { userId: newer.id }, data: { userId: older.id } });
    await tx.order.updateMany({ where: { userId: newer.id }, data: { userId: older.id } });

    // Delete before writing the survivor: email and googleId are unique, so
    // copying them across while both rows exist would hit the index.
    await tx.user.delete({ where: { id: newer.id } });

    return tx.user.update({
      where: { id: older.id },
      data: {
        phone,
        phoneVerifiedAt: new Date(),
        email: older.email ?? newer.email,
        googleId: older.googleId ?? newer.googleId,
        name: older.name ?? newer.name,
        imageUrl: older.imageUrl ?? newer.imageUrl,
        role: higherRole(older.role, newer.role),
      },
    });
  });
}

/**
 * Confirms a WhatsApp code and attaches the number to the signed-in account.
 *
 * This is the one place a phone number becomes trusted. Checkout reads
 * `phoneVerifiedAt`, not `phone`, so an unconfirmed number can never reach a
 * delivery the driver has to call about.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = otpVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid phone number or code' }, { status: 400 });
  }

  const { phone, code } = parsed.data;

  const result = await withDbRetry(() => consumeOtp(phone, code, 'PHONE_VERIFY'));
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.reason === 'NOT_FOUND'
            ? 'Code expired or not found, request a new one'
            : 'Incorrect code',
      },
      { status: 400 }
    );
  }

  const [current, existing] = await withDbRetry(() =>
    Promise.all([
      db.user.findUnique({ where: { id: session.userId } }),
      db.user.findUnique({ where: { phone } }),
    ])
  );

  if (!current) {
    // The session outlived its row — a merge that dropped it, or a manual
    // delete. Treat it as signed out rather than resurrecting the id.
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Nobody else holds this number, or it is already ours: nothing to merge.
  if (!existing || existing.id === current.id) {
    const user = await withDbRetry(() =>
      db.user.update({
        where: { id: current.id },
        data: { phone, phoneVerifiedAt: new Date() },
      })
    );
    return NextResponse.json({ ok: true, role: user.role });
  }

  // Two accounts that each completed a Google sign-in are two real people as
  // far as this app can tell. Silently folding them together would hand one
  // person the other's order history, so this needs the shop to sort out.
  if (existing.googleId && current.googleId) {
    return NextResponse.json(
      {
        error:
          'That number is already linked to another account. Please call the shop to sort this out.',
      },
      { status: 409 }
    );
  }

  const [older, newer] =
    existing.createdAt <= current.createdAt ? [existing, current] : [current, existing];
  const survivor = await withDbRetry(() => mergeUsers(older, newer, phone));

  // The survivor may be a different row than the session pointed at, and the
  // merge may have raised the role. Either way the old token is now wrong.
  await setSessionCookie(await signSession({ userId: survivor.id, role: survivor.role }));

  return NextResponse.json({ ok: true, role: survivor.role, merged: true });
}
