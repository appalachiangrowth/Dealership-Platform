'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';

/** Moved: /dealer/vehicles/new → /dealer/inventory/new */
export default function Moved() {
  const router = useRouter();
  useEffect(() => router.replace('/dealer/inventory/new'), [router]);
  return <Loading />;
}
