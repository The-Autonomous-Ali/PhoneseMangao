import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageDriver, UploadedImage } from './types';
import { extensionFor } from './validate';

const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

/**
 * Writes to `public/uploads` and serves the file straight from the app.
 *
 * Development and test only, and `env.ts` refuses to let it be selected in
 * production: the container filesystem is ephemeral and the runtime user cannot
 * write to `public`, so every image would vanish on the next restart. Failing
 * validation at boot is better than discovering that from a customer.
 */
export const localImageDriver: ImageDriver = {
  name: 'local',

  async upload(file: File, folder: string): Promise<UploadedImage> {
    const filename = `${randomUUID()}.${extensionFor(file.type)}`;
    const directory = path.join(UPLOAD_ROOT, folder);

    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), Buffer.from(await file.arrayBuffer()));

    // Forward slashes: this is a URL, not a filesystem path, and path.join
    // would produce backslashes on Windows.
    return { url: `/uploads/${folder}/${filename}` };
  },
};
