'use client';

import { FbProvider } from '@/lib/facebook';
import { FbHeader } from '@/components/fb/FbChrome';

/** FB Poster: profile posts + Marketplace share one Facebook connection. */
export default function FacebookLayout({ children }: { children: React.ReactNode }) {
  return (
    <FbProvider>
      <FbHeader />
      {children}
    </FbProvider>
  );
}
