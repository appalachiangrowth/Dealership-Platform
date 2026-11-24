'use client';

/**
 * Every "Add vehicle" link in the portal (links to /dealer/inventory/new, and openAddVehicleChooser()) opens the Add
 * Vehicle page straight away: there the dealer picks Photos & VIN (default, with the full form) or Walkaround Video.
 * Nothing is asked first any more; the component and openAddVehicleChooser() stay so existing pages keep working.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const ADD_URL = '/dealer/inventory/ai';

export const openAddVehicleChooser = () => window.dispatchEvent(new Event('add-vehicle-choose'));

export function AddVehicleChooser() {
  const router = useRouter();

  useEffect(() => {
    const go = () => router.push(ADD_URL);
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank') return;
      let u: URL;
      try {
        u = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (u.origin !== window.location.origin || !/\/dealer\/inventory\/new\/?$/.test(u.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      router.push(u.searchParams.get('mode') === 'video' ? `${ADD_URL}?mode=video` : ADD_URL);
    };
    window.addEventListener('add-vehicle-choose', go);
    document.addEventListener('click', click, true); // before the link itself navigates
    return () => {
      window.removeEventListener('add-vehicle-choose', go);
      document.removeEventListener('click', click, true);
    };
  }, [router]);

  return null;
}
