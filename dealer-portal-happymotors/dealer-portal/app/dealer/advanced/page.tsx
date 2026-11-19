'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';

export default function AdvancedPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dealer/business');
  }, [router]);

  return <Loading />;
}
