import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { NotAdminError } from '@/lib/admin-auth';
import { ImageValidationError } from '@/lib/services/images';
import { isDbConnectionError } from '@/lib/db-retry';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Reads a text field the way zod expects it.
 *
 * `FormData.get` returns `null` for a field that was never submitted, and a
 * `File` for a file input. A zod `.optional()` accepts `undefined`, not `null`,
 * so passing the raw value through fails validation on the fields that are
 * meant to be skippable — with an error naming the wrong problem.
 */
export function formText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' ? value : undefined;
}

/** First message per field — a form shows one error under each input. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

/** Which input a unique-constraint violation should point at. */
const UNIQUE_FIELD_MESSAGES: Record<string, { field: string; message: string }> = {
  sku: { field: 'sku', message: 'That SKU is already used by another variant' },
  slug: { field: 'name', message: 'A product with a very similar name already exists' },
};

/**
 * Turns any thrown error into a result safe to hand a browser.
 *
 * The same reasoning as `handleRoute` on the API side: a raw Prisma error
 * carries the database host, and a driver error can carry a credential. The
 * detail goes to the log under a request id; the user gets a sentence.
 */
export function toActionError(error: unknown, context: string): ActionResult<never> {
  if (error instanceof NotAdminError) {
    return { ok: false, error: 'Admin access required' };
  }

  if (error instanceof z.ZodError) {
    return { ok: false, error: 'Please check the highlighted fields', fieldErrors: fieldErrorsFrom(error) };
  }

  // Safe to show: it describes the file the user just chose.
  if (error instanceof ImageValidationError) {
    return { ok: false, error: error.message, fieldErrors: { image: error.message } };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = (error.meta?.target as string[] | undefined) ?? [];
    for (const [column, mapped] of Object.entries(UNIQUE_FIELD_MESSAGES)) {
      if (target.some((t) => t.includes(column))) {
        return { ok: false, error: mapped.message, fieldErrors: { [mapped.field]: mapped.message } };
      }
    }
    return { ok: false, error: 'That value is already taken' };
  }

  const requestId = randomUUID();

  if (isDbConnectionError(error)) {
    console.error(`[${requestId}] ${context}: database connection failed`, error);
    return { ok: false, error: 'The database is waking up, please try again' };
  }

  console.error(`[${requestId}] ${context}: unhandled error`, error);
  return { ok: false, error: `Something went wrong (${requestId})` };
}
