'use client';

/**
 * Vehicles are added on the Add Vehicle page (/dealer/inventory/ai): Add Manually (VIN decode + full form, the
 * default) or Add with AI (photos / walkaround video). Old links to /dealer/inventory/new land there;
 * ?mode=manual|photos|video is kept.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewVehicle() {
  const router = useRouter();
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mode');
    router.replace(`/dealer/inventory/ai${m === 'manual' || m === 'video' || m === 'photos' ? `?mode=${m}` : ''}`);
  }, [router]);
  return null;
}
