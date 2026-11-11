import type { NextConfig } from 'next';

const API = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  // The theme templates are read from disk at runtime: include them in the server build.
  outputFileTracingIncludes: { '/[[...path]]': ['./themes/**/*'] },
  async rewrites() {
    return {
      // Vehicle photos and logos are stored by the backend; serve them from the dealer's own domain (uploads/…)
      beforeFiles: [{ source: '/uploads/:path*', destination: `${API}/uploads/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    // theme assets are versioned by folder (themes/<id>/<version>/assets): safe to cache long
    return [{ source: '/themes/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }] }];
  },
};

export default nextConfig;
