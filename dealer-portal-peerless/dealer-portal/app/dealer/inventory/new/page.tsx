'use client';

/**
 * "Manual listing" is gone: a vehicle is added with Photos & VIN or a Walkaround Video (the full form opens there
 * as soon as the VIN is decoded). Old links to /dealer/inventory/new (?mode=photos|video kept) land on that page.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewVehicle() {
  const router = useRouter();
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mode');
    router.replace(`/dealer/inventory/ai${m === 'video' || m === 'photos' ? `?mode=${m}` : ''}`);
  }, [router]);
  return null;
}
