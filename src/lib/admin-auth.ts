import { getSession, type SessionPayload } from '@/lib/auth';

/** Thrown by `requireAdmin`. Actions turn it into a result, never a stack trace. */
export class NotAdminError extends Error {
  constructor() {
    super('Admin access required');
    this.name = 'NotAdminError';
  }
}

/**
 * The authorization check for every admin Server Action.
 *
 * Server Actions are NOT covered by the `/api/admin` matcher in middleware.
 * They POST to whatever route rendered them, and their action id is embedded in
 * the page's JavaScript rather than being a secret. Path-based middleware is
 * therefore the wrong layer for this, and the check has to live inside the
 * action itself — which is why this is a one-line call that is easy to put at
 * the top of each one, and why each action has its own test proving it is there.
 */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') throw new NotAdminError();
  return session;
}
