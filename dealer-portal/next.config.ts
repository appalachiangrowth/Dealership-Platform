import type { NextConfig } from 'next';
import path from 'path';

const backendUrl = process.env.BACKEND_URL || 'http://5.183.35.10:4000';

const nextConfig: NextConfig = {
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
