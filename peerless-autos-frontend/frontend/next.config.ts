import type { NextConfig } from 'next';
import { frameAncestors } from './lib/origins';

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
    return [
      { source: '/themes/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }] },
      // The Peerless Dealer Portal (https://peerlessautosales1.com/admin) shows this site (https://www.peerlessautosales1.com)
      // in its Design / Content / Pages preview: allow being framed by it. Never send X-Frame-Options (it would block that).
      // The page responses set the same rule themselves (lib/backend.ts securityHeaders); this covers everything else.
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: frameAncestors() }] },
    ];
  },
};

export default nextConfig;
