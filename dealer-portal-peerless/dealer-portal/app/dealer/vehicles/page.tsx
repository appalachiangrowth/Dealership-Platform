'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';

/** "Vehicles" is called "Inventory" now (like the old portal): /dealer/vehicles → /dealer/inventory */
export default function VehiclesMoved() {
  const router = useRouter();
  useEffect(() => router.replace('/dealer/inventory'), [router]);
  return <Loading />;
}
