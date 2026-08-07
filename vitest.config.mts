import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolves the `@/*` -> `src/*` alias from tsconfig.json. Replaces the
    // vite-tsconfig-paths plugin, which Vite now supersedes natively.
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
