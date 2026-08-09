import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tx = {
  product: { create: vi.fn() },
  variant: { create: vi.fn() },
};

vi.mock('@/lib/db', () => ({
  db: {
    product: { update: vi.fn() },
    variant: { create: vi.fn(), update: vi.fn() },
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
import { uploadImage, ImageValidationError } from '@/lib/services/images';
import { revalidatePath } from 'next/cache';
import {
  createProduct,
  updateProduct,
  setProductActive,
  addVariant,
  updateVariant,
  setVariantAvailable,
} from './actions';

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const PRODUCT_FIELDS = {
  name: 'Tomatoes',
  categoryId: 'cat_veg',
  description: 'Local, vine-ripened',
  label: '1 kg',
  unitType: 'KG',
  unitValue: '1',
  price: '45',
  mrp: '55',
};

function uniqueViolation(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { target },
  });
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockResolvedValue({ userId: 'u1', role: 'ADMIN' });
  vi.mocked(uploadImage).mockReset().mockResolvedValue('https://res.cloudinary.com/x.jpg');
  vi.mocked(db.product.update).mockReset().mockResolvedValue({} as never);
  vi.mocked(db.variant.create).mockReset().mockResolvedValue({} as never);
  vi.mocked(db.variant.update).mockReset().mockResolvedValue({} as never);
  vi.mocked(db.$transaction).mockClear();
  vi.mocked(revalidatePath).mockClear();
  tx.product.create.mockReset().mockResolvedValue({ id: 'prod_1' });
  tx.variant.create.mockReset().mockResolvedValue({ id: 'var_1' });
});

afterEach(() => vi.restoreAllMocks());

// Server Actions are not covered by the /api/admin middleware matcher — they
// POST to whatever route rendered them, and their action id is in the page's
// JavaScript rather than being secret. Authorization lives inside each action,
// so each action is checked here rather than trusting one shared test.
describe('every action requires an admin', () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockRejectedValue(new NotAdminError());
  });

  const cases: Array<[string, () => Promise<{ ok: boolean }>]> = [
    ['createProduct', () => createProduct(null, form(PRODUCT_FIELDS))],
    ['updateProduct', () => updateProduct('p1', null, form(PRODUCT_FIELDS))],
    ['setProductActive', () => setProductActive('p1', false)],
    ['addVariant', () => addVariant('p1', null, form(PRODUCT_FIELDS))],
    ['updateVariant', () => updateVariant('v1', null, form(PRODUCT_FIELDS))],
    ['setVariantAvailable', () => setVariantAvailable('v1', false)],
  ];

  it.each(cases)('%s refuses a non-admin caller', async (_name, run) => {
    const result = await run();
    expect(result).toEqual({ ok: false, error: 'Admin access required' });
  });

  it('writes nothing when the caller is not an admin', async () => {
    await createProduct(null, form(PRODUCT_FIELDS));
    await setVariantAvailable('v1', false);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.variant.update).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });
});

describe('createProduct', () => {
  it('writes the product and its first variant in one transaction', async () => {
    // A product with no variants is unsellable but perfectly legal in the
    // schema. Creating both together makes that state unrepresentable.
    const result = await createProduct(null, form(PRODUCT_FIELDS));

    expect(result).toEqual({ ok: true, data: { id: 'prod_1' } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.create).toHaveBeenCalledTimes(1);
    expect(tx.variant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 'prod_1', label: '1 kg' }),
    });
  });

  it('generates a slug from the name', async () => {
    await createProduct(null, form({ ...PRODUCT_FIELDS, name: 'Fresh Green Chillies' }));

    expect(tx.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: 'fresh-green-chillies' }),
    });
  });

  it('retries with a suffixed slug when the name collides', async () => {
    tx.product.create
      .mockRejectedValueOnce(uniqueViolation(['slug']))
      .mockResolvedValueOnce({ id: 'prod_2' });

    const result = await createProduct(null, form(PRODUCT_FIELDS));

    expect(result.ok).toBe(true);
    expect(tx.product.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ slug: 'tomatoes-2' }),
    });
  });

  it('does not retry a conflict that is not about the slug', async () => {
    tx.product.create.mockRejectedValue(uniqueViolation(['sku']));

    const result = await createProduct(null, form(PRODUCT_FIELDS));

    expect(result.ok).toBe(false);
    expect(tx.product.create).toHaveBeenCalledTimes(1);
  });

  it('passes money through as strings so Decimal never sees a float', async () => {
    await createProduct(null, form({ ...PRODUCT_FIELDS, price: '1234.55', mrp: '1400' }));

    expect(tx.variant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ price: '1234.55', mrp: '1400' }),
    });
  });

  it('rejects an MRP below the price with a field error', async () => {
    const result = await createProduct(null, form({ ...PRODUCT_FIELDS, price: '60', mrp: '55' }));

    expect(result).toMatchObject({ ok: false, fieldErrors: { mrp: expect.any(String) } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('uploads the image before opening the transaction', async () => {
    // Holding a transaction open across a network call to Cloudinary keeps a
    // row lock for its duration and risks the transaction timeout.
    const order: string[] = [];
    vi.mocked(uploadImage).mockImplementation(async () => {
      order.push('upload');
      return 'https://res.cloudinary.com/x.jpg';
    });
    vi.mocked(db.$transaction).mockImplementation((async (fn: (c: typeof tx) => unknown) => {
      order.push('transaction');
      return fn(tx);
    }) as never);

    await createProduct(
      null,
      form({ ...PRODUCT_FIELDS, image: new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' }) })
    );

    expect(order).toEqual(['upload', 'transaction']);
  });

  it('skips the upload entirely when no file was chosen', async () => {
    // An untouched file input posts a zero-byte File, not nothing.
    await createProduct(
      null,
      form({ ...PRODUCT_FIELDS, image: new File([], '', { type: 'application/octet-stream' }) })
    );

    expect(uploadImage).not.toHaveBeenCalled();
    expect(tx.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ imageUrl: undefined }),
    });
  });

  it('surfaces an image problem as a field error and writes nothing', async () => {
    vi.mocked(uploadImage).mockRejectedValue(new ImageValidationError('Image must be 5 MB or smaller'));

    const result = await createProduct(
      null,
      form({ ...PRODUCT_FIELDS, image: new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' }) })
    );

    expect(result).toMatchObject({ ok: false, fieldErrors: { image: expect.stringMatching(/5 MB/) } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('refreshes the catalog list', async () => {
    await createProduct(null, form(PRODUCT_FIELDS));
    expect(revalidatePath).toHaveBeenCalledWith('/admin/products');
  });
});

describe('updateProduct', () => {
  it('keeps the existing image when no new file is chosen', async () => {
    // Writing imageUrl: undefined would be a no-op in Prisma, but writing null
    // would silently clear a photo the owner never touched.
    await updateProduct('prod_1', null, form(PRODUCT_FIELDS));

    const { data } = vi.mocked(db.product.update).mock.calls[0][0];
    expect('imageUrl' in data).toBe(false);
  });

  it('replaces the image when a new file is chosen', async () => {
    await updateProduct(
      'prod_1',
      null,
      form({ ...PRODUCT_FIELDS, image: new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' }) })
    );

    const { data } = vi.mocked(db.product.update).mock.calls[0][0];
    expect(data.imageUrl).toBe('https://res.cloudinary.com/x.jpg');
  });

  it('does not regenerate the slug on rename, since it is already in shared links', async () => {
    await updateProduct('prod_1', null, form({ ...PRODUCT_FIELDS, name: 'Roma Tomatoes' }));

    const { data } = vi.mocked(db.product.update).mock.calls[0][0];
    expect('slug' in data).toBe(false);
  });

  it('clears a description the owner emptied', async () => {
    await updateProduct('prod_1', null, form({ ...PRODUCT_FIELDS, description: '' }));

    const { data } = vi.mocked(db.product.update).mock.calls[0][0];
    expect(data.description).toBeNull();
  });
});

describe('deactivation stands in for deletion', () => {
  it('setProductActive(false) updates the flag rather than deleting', async () => {
    const result = await setProductActive('prod_1', false);

    expect(result).toEqual({ ok: true });
    expect(db.product.update).toHaveBeenCalledWith({
      where: { id: 'prod_1' },
      data: { isActive: false },
    });
  });

  it('reactivating is the same call in reverse', async () => {
    await setProductActive('prod_1', true);
    expect(db.product.update).toHaveBeenCalledWith({
      where: { id: 'prod_1' },
      data: { isActive: true },
    });
  });
});

describe('variant actions', () => {
  it('addVariant attaches to the given product', async () => {
    await addVariant('prod_1', null, form(PRODUCT_FIELDS));

    expect(db.variant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 'prod_1', label: '1 kg', price: '45' }),
    });
  });

  it('updateVariant writes the edited fields', async () => {
    await updateVariant('var_1', null, form({ ...PRODUCT_FIELDS, price: '50', mrp: '60' }));

    expect(db.variant.update).toHaveBeenCalledWith({
      where: { id: 'var_1' },
      data: expect.objectContaining({ price: '50', mrp: '60' }),
    });
  });

  it('a blank SKU is stored as null, so blanks do not collide on the unique index', async () => {
    await addVariant('prod_1', null, form({ ...PRODUCT_FIELDS, sku: '' }));

    expect(db.variant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sku: null }),
    });
  });

  it('maps a duplicate SKU to the sku field', async () => {
    vi.mocked(db.variant.create).mockRejectedValue(uniqueViolation(['sku']));

    const result = await addVariant('prod_1', null, form({ ...PRODUCT_FIELDS, sku: 'TOM1K' }));

    expect(result).toMatchObject({ ok: false, fieldErrors: { sku: expect.stringMatching(/SKU/) } });
  });

  it('setVariantAvailable is a single update, the one-tap sell-out control', async () => {
    const result = await setVariantAvailable('var_1', false);

    expect(result).toEqual({ ok: true });
    expect(db.variant.update).toHaveBeenCalledWith({
      where: { id: 'var_1' },
      data: { isAvailable: false },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/products');
  });
});
