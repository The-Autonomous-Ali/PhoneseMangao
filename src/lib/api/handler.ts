import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isDbConnectionError } from '@/lib/db-retry';

/** Thrown deliberately by a route when it wants a specific status and message. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Variadic, so one wrapper serves both `GET()` (no arguments) and
// `POST(request)`. A fixed two-parameter signature would force every no-arg
// route to invent parameters it never uses.
type RouteHandler<Args extends unknown[]> = (...args: Args) => Promise<Response>;

/**
 * Wraps a route handler so no failure ever reaches the user raw.
 *
 * The client gets a safe message plus a request id; the server log gets the
 * full error under that same id. Prisma connection errors embed the database
 * hostname in their message, so they are never forwarded verbatim.
 */
export function handleRoute<Args extends unknown[]>(
  handler: RouteHandler<Args>
): RouteHandler<Args> {
  return async (...args: Args): Promise<Response> => {
    const requestId = randomUUID();

    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error(`[${requestId}] validation failed`, error.issues);
        return NextResponse.json({ error: 'Invalid request', requestId }, { status: 400 });
      }

      if (error instanceof AppError) {
        console.error(`[${requestId}] ${error.status}: ${error.message}`);
        return NextResponse.json({ error: error.message, requestId }, { status: error.status });
      }

      if (isDbConnectionError(error)) {
        console.error(`[${requestId}] database connection failed`, error);
        return NextResponse.json(
          { error: 'Service is starting up, please try again', requestId },
          { status: 503 }
        );
      }

      console.error(`[${requestId}] unhandled error`, error);
      return NextResponse.json({ error: 'Something went wrong', requestId }, { status: 500 });
    }
  };
}
