'use client';

/**
 * /dealer/inventory/new = Add Manually: VIN + Decode VIN, photos and the full form (/dealer/inventory/ai?mode=manual).
 * ?mode=photos / ?mode=video open Add with AI in that way instead.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewVehicle() {
  const router = useRouter();
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mode');
    router.replace(m === 'video' ? '/dealer/inventory/ai?mode=video' : m === 'photos' ? '/dealer/inventory/ai' : '/dealer/inventory/ai?mode=manual');
  }, [router]);
  return null;
}
