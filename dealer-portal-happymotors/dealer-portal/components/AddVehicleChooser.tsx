'use client';

/**
 * Every "Add vehicle" link in the portal asks first: with AI, or by hand?
 * (Clicks on links to /dealer/inventory/new are caught here; ?manual=1 goes straight to the form.)
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Camera, PenLine, Sparkles, Video, X } from 'lucide-react';

export const openAddVehicleChooser = () => window.dispatchEvent(new Event('add-vehicle-choose'));

export function AddVehicleChooser() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
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
      if (u.origin !== window.location.origin || !/\/dealer\/inventory\/new\/?$/.test(u.pathname) || u.searchParams.has('manual')) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };
    window.addEventListener('add-vehicle-choose', show);
    document.addEventListener('click', click, true); // before the link itself navigates
    return () => {
      window.removeEventListener('add-vehicle-choose', show);
      document.removeEventListener('click', click, true);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  if (!open) return null;
  const go = (url: string) => {
    setOpen(false);
    router.push(url);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="avc-h">
      <div className="absolute inset-0 bg-[#0F172A]/50" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-[640px] rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.3)]">
        <div className="flex items-start gap-3 border-b border-[#E5E9F0] px-6 py-5">
          <div className="flex-1">
            <h2 id="avc-h" className="m-0 text-xl font-bold text-[#0F172A]">
              Add a vehicle
            </h2>
            <p className="m-0 mt-1 text-sm text-[#526077]">How would you like to add it?</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid gap-3 p-6 sm:grid-cols-2">
          <button
            type="button"
            autoFocus
            onClick={() => go('/dealer/inventory/ai')}
            className="group flex flex-col gap-3 rounded-xl border-2 border-[#C4B5FD] bg-[#F7F5FF] p-5 text-left transition hover:border-[#7C3AED] hover:shadow-md focus-visible:border-[#7C3AED] focus-visible:outline-none"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#7C3AED] text-white">
                <Sparkles className="h-5 w-5" />
              </span>
              <span className="rounded-full bg-[#EDE9FE] px-2.5 py-0.5 text-xs font-bold text-[#5B3FD6]">Fastest</span>
            </span>
            <span className="text-base font-bold text-[#0F172A]">With AI</span>
            <span className="text-[13px] leading-relaxed text-[#475569]">
              Enter the VIN and add photos, or film one walkaround video. AI fills in the details, colours, mileage and description for you to check.
            </span>
            <span className="flex items-center gap-3 text-xs font-semibold text-[#5B3FD6]">
              <span className="inline-flex items-center gap-1">
                <Camera className="h-3.5 w-3.5" /> Photos
              </span>
              <span className="inline-flex items-center gap-1">
                <Video className="h-3.5 w-3.5" /> Video
              </span>
              <ArrowRight className="ml-auto h-4 w-4 transition group-hover:translate-x-0.5" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => go('/dealer/inventory/new?manual=1')}
            className="group flex flex-col gap-3 rounded-xl border-2 border-[#E5E9F0] bg-white p-5 text-left transition hover:border-[#2563EB] hover:shadow-md focus-visible:border-[#2563EB] focus-visible:outline-none"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF1FF] text-[#1D4ED8]">
              <PenLine className="h-5 w-5" />
            </span>
            <span className="text-base font-bold text-[#0F172A]">Manually</span>
            <span className="text-[13px] leading-relaxed text-[#475569]">Fill in the full Add vehicle form yourself, field by field.</span>
            <span className="mt-auto flex items-center text-xs font-semibold text-[#1D4ED8]">
              Open the form
              <ArrowRight className="ml-auto h-4 w-4 transition group-hover:translate-x-0.5" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
