'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';

/** "Feeds & CarGurus" is now the read-only "CarGurus feed" page (like the old portal). */
export default function FeedsMoved() {
  const router = useRouter();
  useEffect(() => router.replace('/dealer/cargurus'), [router]);
  return <Loading />;
}
