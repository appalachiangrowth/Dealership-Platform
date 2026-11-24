'use client';

/**
 * Vehicles are added on the Add Vehicle page (/dealer/inventory/ai): Photos & VIN (default, with the full form) or
 * Walkaround Video. Old links to /dealer/inventory/new land there; ?mode=video is kept.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewVehicle() {
  const router = useRouter();
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mode');
    router.replace(`/dealer/inventory/ai${m === 'video' ? '?mode=video' : ''}`);
  }, [router]);
  return null;
}
