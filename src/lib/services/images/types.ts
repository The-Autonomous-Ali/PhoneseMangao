export interface UploadedImage {
  /** Public URL the storefront and admin render. */
  url: string;
}

export interface ImageDriver {
  /** Stable identifier, used in logs and tests. */
  readonly name: string;
  /**
   * Stores one image and returns where to find it. `folder` groups uploads by
   * kind ('products', 'categories') so the remote bucket stays navigable.
   * Throws if storage fails.
   */
  upload(file: File, folder: string): Promise<UploadedImage>;
}

/**
 * A problem with the file the user chose, not with storage.
 *
 * Separate from a generic failure because the two need opposite handling: this
 * one is the user's to fix and its message is safe to show them, while an
 * upload failure is ours and its detail belongs only in the log.
 */
export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}
