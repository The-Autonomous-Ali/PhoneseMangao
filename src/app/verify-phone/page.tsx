import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { VerifyPhoneForm } from './verify-phone-form';

/**
 * Where the Google callback sends a customer who has no confirmed number yet.
 *
 * Guarded on the server: the page is only reachable while it has work to do, so
 * a bookmarked link cannot strand somebody on a form they already completed.
 */
export default async function VerifyPhonePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { phoneVerifiedAt: true },
  });
  if (user?.phoneVerifiedAt) redirect('/');

  return <VerifyPhoneForm shopNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER} />;
}
