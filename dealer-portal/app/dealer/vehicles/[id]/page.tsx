'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';

/** /dealer/vehicles/<id> → /dealer/inventory/<id> (also /new and /import) */
export default function VehicleMoved() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => router.replace(`/dealer/inventory/${id}${window.location.search}`), [id, router]);
  return <Loading />;
}
