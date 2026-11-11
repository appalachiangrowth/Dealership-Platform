import type { NextConfig } from 'next';
import path from 'path';

const backendUrl = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://5.183.35.10:4000').replace(/\/+$/, '');

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
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backendUrl}/uploads/:path*`,
      },
      {
        source: '/themes/:path*',
        destination: `${backendUrl}/themes/:path*`,
      },
    ];
  },
};

export default nextConfig;
