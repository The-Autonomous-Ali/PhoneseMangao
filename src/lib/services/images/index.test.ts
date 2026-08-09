import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getImageDriver, uploadImage, ImageValidationError, MAX_IMAGE_BYTES } from './index';
import { signParams } from './cloudinary';
import { resetEnvCache } from '@/lib/env';

const ORIGINAL = { ...process.env };

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

const CLOUDINARY = {
  IMAGE_DRIVER: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'shopcloud',
  CLOUDINARY_API_KEY: '123456789',
  CLOUDINARY_API_SECRET: 'super-secret',
};

function setEnv(overrides: Record<string, string | undefined> = {}) {
  process.env = { ...ORIGINAL, ...BASE, ...overrides } as NodeJS.ProcessEnv;
  resetEnvCache();
}

function imageFile(
  { type = 'image/jpeg', size = 1024, name = 'tomato.jpg' } = {}
): File {
  return new File([new Uint8Array(size)], name, { type });
}

beforeEach(() => setEnv());

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('getImageDriver', () => {
  it('defaults to the local driver in development', () => {
    expect(getImageDriver().name).toBe('local');
  });

  it('selects cloudinary when configured for it', () => {
    setEnv(CLOUDINARY);
    expect(getImageDriver().name).toBe('cloudinary');
  });
});

describe('uploadImage — validation', () => {
  // Every check runs before a byte leaves the process. The file input's
  // `accept` attribute is a file-picker convenience, not a constraint, and a
  // Server Action can be called without a form ever being rendered.
  it('rejects a type that is not an allowed image', async () => {
    await expect(uploadImage(imageFile({ type: 'image/svg+xml' }), 'products')).rejects.toBeInstanceOf(
      ImageValidationError
    );
  });

  it('rejects a file larger than the size cap', async () => {
    const tooBig = imageFile({ size: MAX_IMAGE_BYTES + 1 });
    await expect(uploadImage(tooBig, 'products')).rejects.toThrow(/5 MB/);
  });

  it('rejects an empty file', async () => {
    await expect(uploadImage(imageFile({ size: 0 }), 'products')).rejects.toThrow(/empty/);
  });

  it('does not call the driver when validation fails', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setEnv(CLOUDINARY);

    await expect(uploadImage(imageFile({ type: 'text/plain' }), 'products')).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', async (type) => {
    setEnv(CLOUDINARY);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/x.jpg' }))
      )
    );

    await expect(uploadImage(imageFile({ type }), 'products')).resolves.toContain('cloudinary');
  });
});

describe('cloudinary driver', () => {
  beforeEach(() => setEnv(CLOUDINARY));

  it('posts a signed multipart upload and returns the secure URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/shopcloud/a.jpg' }))
    );
    vi.stubGlobal('fetch', fetchMock);

    const url = await uploadImage(imageFile(), 'products');

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe('https://api.cloudinary.com/v1_1/shopcloud/image/upload');
    const body = init.body as FormData;
    expect(body.get('api_key')).toBe('123456789');
    expect(body.get('folder')).toBe('products');
    expect(body.get('signature')).toEqual(expect.any(String));
    expect(url).toBe('https://res.cloudinary.com/shopcloud/a.jpg');
  });

  it('never sends the API secret in the request body', async () => {
    // The signature proves possession of the secret; the secret itself must
    // never leave the server.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/a.jpg' }))
    );
    vi.stubGlobal('fetch', fetchMock);

    await uploadImage(imageFile(), 'products');

    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect([...body.keys()]).not.toContain('api_secret');
    expect(body.get('signature')).not.toBe('super-secret');
  });

  it('throws with the status when Cloudinary rejects the upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    await expect(uploadImage(imageFile(), 'products')).rejects.toThrow(/401/);
  });

  it('never puts the API secret in the thrown error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('super-secret', { status: 400 })));
    await expect(uploadImage(imageFile(), 'products')).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('super-secret') })
    );
  });

  it('throws when the response carries no URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }))));
    await expect(uploadImage(imageFile(), 'products')).rejects.toThrow(/no URL/);
  });

  it('wraps a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(uploadImage(imageFile(), 'products')).rejects.toThrow(/could not reach/);
  });
});

describe('signParams', () => {
  it('sorts parameters by key before hashing, as Cloudinary specifies', () => {
    // Same parameters in a different insertion order must sign identically, or
    // uploads fail intermittently depending on object construction.
    const a = signParams({ timestamp: '1700000000', folder: 'products' }, 'secret');
    const b = signParams({ folder: 'products', timestamp: '1700000000' }, 'secret');
    expect(a).toBe(b);
  });

  it('produces a different signature for a different secret', () => {
    const params = { folder: 'products', timestamp: '1700000000' };
    expect(signParams(params, 'secret-a')).not.toBe(signParams(params, 'secret-b'));
  });

  it('returns a hex SHA-1 digest', () => {
    expect(signParams({ timestamp: '1' }, 's')).toMatch(/^[0-9a-f]{40}$/);
  });
});
