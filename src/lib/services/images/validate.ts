import { ImageValidationError } from './types';

/**
 * Formats a browser can decode and Cloudinary can transform. An allowlist
 * rather than a blocklist: an SVG is a script delivery vehicle, and accepting
 * arbitrary types would let one be served from our own origin.
 */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Generous for a phone photo, small enough that a stray video is rejected. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function extensionFor(mimeType: string): string {
  const extension = ALLOWED_TYPES[mimeType];
  if (!extension) throw new ImageValidationError('Unsupported image type');
  return extension;
}

/**
 * Checks the file before any of it is stored.
 *
 * Runs on the server even though the file input also has an `accept`
 * attribute — that attribute is a convenience for the file picker, not a
 * constraint, and a Server Action can be called without ever rendering a form.
 */
export function assertValidImage(file: File): void {
  if (file.size === 0) {
    throw new ImageValidationError('That file is empty');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageValidationError('Image must be 5 MB or smaller');
  }
  if (!ALLOWED_TYPES[file.type]) {
    throw new ImageValidationError('Image must be a JPEG, PNG or WebP');
  }
}
