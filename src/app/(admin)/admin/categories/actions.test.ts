import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = {
  category: { create: vi.fn(), update: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  db: {
    category: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock('@/lib/services/images', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/services/images')>('@/lib/services/images');
  return { ...actual, uploadImage: vi.fn() };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin, NotAdminError } from '@/lib/admin-auth';
import { uploadImage } from '@/lib/services/images';
import { createCategory, updateCategory, setCategoryActive } from './actions';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function slugConflict() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { target: ['slug'] },
  });
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ userId: 'admin_1', role: 'ADMIN' });
  vi.mocked(db.category.create).mockReset().mockResolvedValue({} as never);
  vi.mocked(db.category.update).mockReset().mockResolvedValue({} as never);
  vi.mocked(uploadImage).mockReset().mockResolvedValue('https://res.cloudinary.com/x.jpg');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/**
 * The reason these exist at all.
 *
 * A Server Action is not covered by the `/admin` matcher in middleware: it
 * POSTs to whatever page rendered it, and its id is embedded in that page's
 * JavaScript rather than being a secret. The authorization check therefore has
 * to live inside the action, and a check with no test is one edit away from
 * being gone without anybody noticing.
 */
describe('every category action refuses a non-admin', () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());
  });

  it('createCategory', async () => {
    const result = await createCategory(null, form({ name: 'Fruits' }));

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(db.category.create).not.toHaveBeenCalled();
  });

  it('updateCategory', async () => {
    const result = await updateCategory('cat_1', null, form({ name: 'Fruits' }));

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(db.category.update).not.toHaveBeenCalled();
  });

  it('setCategoryActive', async () => {
    const result = await setCategoryActive('cat_1', false);

    expect(result).toEqual({ ok: false, error: 'Admin access required' });
    expect(db.category.update).not.toHaveBeenCalled();
  });
});

describe('createCategory', () => {
  it('creates a category with a slug derived from its name', async () => {
    const result = await createCategory(null, form({ name: 'Fresh Fruits', sortOrder: '2' }));

    expect(result.ok).toBe(true);
    expect(db.category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Fresh Fruits', slug: 'fresh-fruits', sortOrder: 2 }),
    });
  });

  it('tries another slug when the first is taken', async () => {
    // Two categories can legitimately be named similarly; the second should get
    // a usable URL rather than an error the owner cannot act on.
    vi.mocked(db.category.create).mockRejectedValueOnce(slugConflict()).mockResolvedValue({} as never);

    const result = await createCategory(null, form({ name: 'Fruits' }));

    expect(result.ok).toBe(true);
    expect(db.category.create).toHaveBeenCalledTimes(2);
    const slugs = vi.mocked(db.category.create).mock.calls.map((c) => c[0].data.slug);
    expect(slugs[1]).not.toBe(slugs[0]);
  });

  it('gives up rather than looping forever on a repeated conflict', async () => {
    vi.mocked(db.category.create).mockRejectedValue(slugConflict());

    const result = await createCategory(null, form({ name: 'Fruits' }));

    expect(result.ok).toBe(false);
    expect(db.category.create).toHaveBeenCalledTimes(5);
  });

  it('rejects an empty name without touching the database', async () => {
    const result = await createCategory(null, form({ name: '   ' }));

    expect(result.ok).toBe(false);
    expect(db.category.create).not.toHaveBeenCalled();
  });
});

describe('updateCategory', () => {
  it('does not regenerate the slug on rename', async () => {
    // The slug is already in shared links and search results. Renaming "Veg" to
    // "Vegetables" must not break every URL a customer saved.
    await updateCategory('cat_1', null, form({ name: 'Vegetables' }));

    const { data } = vi.mocked(db.category.update).mock.calls[0][0];
    expect(data).not.toHaveProperty('slug');
  });

  it('leaves the image alone when none was chosen', async () => {
    await updateCategory('cat_1', null, form({ name: 'Vegetables' }));

    const { data } = vi.mocked(db.category.update).mock.calls[0][0];
    expect(data).not.toHaveProperty('imageUrl');
    expect(uploadImage).not.toHaveBeenCalled();
  });
});

describe('setCategoryActive', () => {
  it('hides a whole aisle without touching its products', async () => {
    // The storefront filters on the category's own flag, so switching it back
    // on restores the section exactly as it was — no bulk update to half-finish.
    const result = await setCategoryActive('cat_1', false);

    expect(result.ok).toBe(true);
    expect(db.category.update).toHaveBeenCalledWith({
      where: { id: 'cat_1' },
      data: { isActive: false },
    });
  });
});
