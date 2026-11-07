import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }, { protocol: 'http', hostname: '**' }] },
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname);
    return config;
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://5.183.35.10:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl.replace(/\/+$/, '')}/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backendUrl.replace(/\/+$/, '')}/uploads/:path*`,
      },
      {
        source: '/themes/:path*',
        destination: `${backendUrl.replace(/\/+$/, '')}/themes/:path*`,
      },
    ];
  },
};

export default nextConfig;
