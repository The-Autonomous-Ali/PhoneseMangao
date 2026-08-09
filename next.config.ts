import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Traces the server build down to the files it actually imports and emits a
  // self-contained .next/standalone. That is what keeps the Docker runner stage
  // free of node_modules, and it is also what makes the app portable off the
  // Oracle box later — `node server.js` is the whole run command.
  output: 'standalone',
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
};

export default nextConfig;
