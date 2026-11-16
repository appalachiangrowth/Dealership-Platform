import type { NextConfig } from 'next';
import path from 'path';

// Served under https://peerlessautosales.com/admin — every page, /_next asset, Link and router call gets this prefix.
const basePath = '/admin';

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname);
    return config;
  },
  // /api/*, /uploads/* and /themes/* go to the backend through route handlers with hard time limits
  // (app/api/[...path]/route.ts, lib/backend-proxy.ts) instead of rewrites, which could wait forever and keep a
  // Node worker busy on the web host.
};

export default nextConfig;
