'use client';

/**
 * "Please verify the decoded details" — shown on the Add Vehicle page when a VIN decode (typed or scanned), the AI
 * photo reading or the walkaround video reading finishes. Cancel, Understood, a tap outside the card and Escape all
 * close it (the page keeps the filled-in values either way).
 *
 * Drawn outside the page (portal on <body>), so the Add Vehicle page's own stylesheet does not touch it.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** document with a green check, soft blue cloud, yellow / blue sparkles */
function DocCheckArt() {
  return (
    <svg width="148" height="104" viewBox="0 0 148 104" fill="none" aria-hidden="true">
      {/* soft cloud */}
      <g fill="#EAF1FF">
        <circle cx="52" cy="58" r="24" />
        <circle cx="78" cy="44" r="30" />
        <circle cx="106" cy="58" r="24" />
        <rect x="30" y="56" width="98" height="30" rx="15" />
      </g>
      <ellipse cx="78" cy="92" rx="46" ry="6" fill="#DCE7FD" opacity=".7" />
      {/* yellow accents */}
      <path d="M33 22l6 9" stroke="#FACC15" strokeWidth="4" strokeLinecap="round" />
      <path d="M25 33l8 4" stroke="#FACC15" strokeWidth="4" strokeLinecap="round" />
      {/* blue sparkles */}
      <path d="M126 46l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" fill="#BFD3FB" />
      <path d="M41 58l1.5 3.5L46 63l-3.5 1.5L41 68l-1.5-3.5L36 63l3.5-1.5L41 58Z" fill="#BFD3FB" />
      <circle cx="120" cy="24" r="3" fill="#D6E3FC" />
      <circle cx="47" cy="80" r="3" fill="#93B4F6" />
      {/* document */}
      <g transform="rotate(-6 75 52)">
        <path d="M54 22a6 6 0 0 1 6-6h28l14 14v44a6 6 0 0 1-6 6H60a6 6 0 0 1-6-6V22Z" fill="#fff" stroke="#1D63ED" strokeWidth="4" strokeLinejoin="round" />
        <path d="M88 16v10a4 4 0 0 0 4 4h10" fill="#7FA7F5" stroke="#1D63ED" strokeWidth="4" strokeLinejoin="round" />
        <path d="M64 38h24M64 47h28M64 56h22M64 65h14" stroke="#9DBBF7" strokeWidth="4" strokeLinecap="round" />
      </g>
      {/* green check */}
      <circle cx="104" cy="72" r="17" fill="#22C55E" stroke="#fff" strokeWidth="4" />
      <path d="M96 72l6 6 10-11" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function VerifyDecodedModal({
  open,
  kind,
  onCancel,
  onUnderstood,
}: {
  open: boolean;
  /** what finished: a VIN decode, or AI reading the photos / the video */
  kind: 'vin' | 'photos' | 'video' | null;
  onCancel: () => void;
  onUnderstood: () => void;
}) {
  const ok = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    ok.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-5" role="alertdialog" aria-modal="true" aria-labelledby="verify-decoded-title">
      <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-[3px]" onClick={onCancel} />
      <div className="relative w-full max-w-[400px] overflow-hidden rounded-3xl bg-white shadow-[0_24px_64px_rgba(15,23,42,0.28)]">
        <div className="flex flex-col items-center px-7 pb-7 pt-7 text-center sm:px-8">
          <DocCheckArt />
          <h2 id="verify-decoded-title" className="mt-4 text-[26px] font-extrabold leading-[1.18] tracking-[-0.01em] text-[#0B1220]">
            Please verify the
            <br />
            {kind === 'photos' || kind === 'video' ? 'auto-filled details' : 'decoded details'}
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-[#E8ECF3] px-5 py-5 sm:gap-4 sm:px-6">
          <button
            type="button"
            onClick={onCancel}
            className="h-14 rounded-full bg-[#F2F4F8] text-[17px] font-bold text-[#111827] transition hover:bg-[#E8EBF2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D63ED]/40"
          >
            Cancel
          </button>
          <button
            ref={ok}
            type="button"
            onClick={onUnderstood}
            className="h-14 rounded-full bg-[#1D63ED] text-[17px] font-bold text-white shadow-[0_6px_16px_rgba(29,99,237,0.28)] transition hover:bg-[#135BEC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D63ED]/50 focus-visible:ring-offset-2"
          >
            Understood
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
