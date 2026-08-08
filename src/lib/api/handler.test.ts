import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, handleRoute } from './handler';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** A wrapped no-argument route that always throws the given error. */
function route(error: unknown) {
  return handleRoute(async () => {
    throw error;
  });
}

function connectionError() {
  return new Prisma.PrismaClientInitializationError(
    "Can't reach database server at ep-steep-grass.aws.neon.tech:5432",
    '6.19.3'
  );
}

describe('handleRoute', () => {
  it('passes a successful response straight through', async () => {
    const handler = handleRoute(async () => NextResponse.json({ ok: true }));
    const res = await handler();
    expect(res.status).toBe(200);
  });

  it('maps a Zod error to 400 without leaking field internals', async () => {
    const res = await route(new z.ZodError([]))();
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid request' });
  });

  it('maps an AppError to its own status and message', async () => {
    const res = await route(new AppError('Too many requests, try again later', 429))();
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Too many requests, try again later',
    });
  });

  it('maps a database connection failure to 503', async () => {
    const res = await route(connectionError())();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Service is starting up, please try again',
    });
  });

  it('never leaks the database hostname to the client', async () => {
    const res = await route(connectionError())();
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('neon.tech');
    expect(body).not.toContain('Can\'t reach');
  });

  it('maps an unknown error to a generic 500', async () => {
    const res = await route(new Error('inner detail'))();
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('Something went wrong');
    expect(body).not.toContain('inner detail');
  });

  it('returns a request id the server also logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await route(new Error('boom'))();
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(spy.mock.calls.flat().join(' ')).toContain(body.requestId);
  });
});
