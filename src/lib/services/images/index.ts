import { getEnv } from '@/lib/env';
import { localImageDriver } from './local';
import { cloudinaryImageDriver } from './cloudinary';
import { assertValidImage } from './validate';
import type { ImageDriver } from './types';

export type { ImageDriver, UploadedImage } from './types';
export { ImageValidationError } from './types';
export { MAX_IMAGE_BYTES } from './validate';

export function getImageDriver(): ImageDriver {
  const env = getEnv();

  switch (env.IMAGE_DRIVER) {
    case 'local':
      return localImageDriver;
    case 'cloudinary':
      return cloudinaryImageDriver;
  }
}

/**
 * The one entry point callers use.
 *
 * Validation lives here rather than in each driver so a new driver cannot
 * forget it, and so the check happens before a single byte is sent anywhere.
 */
export async function uploadImage(file: File, folder: string): Promise<string> {
  assertValidImage(file);
  const { url } = await getImageDriver().upload(file, folder);
  return url;
}
