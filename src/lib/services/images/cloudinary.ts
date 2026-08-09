import { createHash } from 'node:crypto';
import { getEnv } from '@/lib/env';
import type { ImageDriver, UploadedImage } from './types';

/**
 * Signs an authenticated upload.
 *
 * Cloudinary's rule: every parameter except `file`, `api_key` and
 * `resource_type`, sorted by key, joined as `k=v&k=v`, with the API secret
 * appended before hashing. Unsigned uploads would avoid all this but require an
 * upload preset that anyone who reads the page source can post to.
 */
export function signParams(params: Record<string, string>, apiSecret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  // SHA-1 is Cloudinary's specified algorithm here. It is a signature over
  // parameters we generate, not a password hash, so the collision weaknesses
  // that rule SHA-1 out elsewhere do not apply.
  return createHash('sha1').update(`${canonical}${apiSecret}`).digest('hex');
}

export const cloudinaryImageDriver: ImageDriver = {
  name: 'cloudinary',

  async upload(file: File, folder: string): Promise<UploadedImage> {
    const env = getEnv();
    const cloudName = env.CLOUDINARY_CLOUD_NAME;
    const apiKey = env.CLOUDINARY_API_KEY;
    const apiSecret = env.CLOUDINARY_API_SECRET;

    // Validated at boot when IMAGE_DRIVER is 'cloudinary'. Asserted here so the
    // module reads as total rather than depending on that at a distance.
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary driver is selected but its credentials are not configured');
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signParams({ folder, timestamp }, apiSecret);

    const body = new FormData();
    body.set('file', file);
    body.set('api_key', apiKey);
    body.set('timestamp', timestamp);
    body.set('folder', folder);
    body.set('signature', signature);

    let response: Response;
    try {
      response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body,
      });
    } catch (cause) {
      throw new Error('Cloudinary upload failed: could not reach the API', { cause });
    }

    // Status only. Cloudinary's error body echoes the signed parameters, and
    // this message reaches the server log.
    if (!response.ok) {
      throw new Error(`Cloudinary upload failed with status ${response.status}`);
    }

    const { secure_url: secureUrl } = (await response.json()) as { secure_url?: string };
    if (!secureUrl) throw new Error('Cloudinary upload returned no URL');

    return { url: secureUrl };
  },
};
