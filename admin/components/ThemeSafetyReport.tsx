'use client';

import { CircleCheck, CircleX, ShieldCheck, TriangleAlert, Wrench } from 'lucide-react';

/** The backend's Theme Safety Report (backend/src/themes/theme-safety.ts), returned with every theme ZIP install. */
export type ThemeSafety = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  fixes: string[];
  stats?: { files: number; totalMB: number; templates: number; largestModel: { file: string; mb: number } | null; largestImage: { file: string; mb: number } | null };
};

/** pulls the report out of an install answer or an install error (ApiError.data) */
export function safetyOf(x: unknown): ThemeSafety | null {
  const s = (x as { safety?: ThemeSafety } | null)?.safety;
  return s && Array.isArray(s.errors) && Array.isArray(s.warnings) ? s : null;
}

function List({ items, icon, cls }: { items: string[]; icon: React.ReactNode; cls: string }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 grid gap-1.5">
      {items.map((t, i) => (
        <li key={i} className={`flex items-start gap-2 ${cls}`}>
          <span className="mt-0.5 shrink-0">{icon}</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** Theme Safety Report panel: refused (errors), warnings, auto-fixes applied, and the design's size figures. */
export function ThemeSafetyReport({ safety }: { safety: ThemeSafety }) {
  const st = safety.stats;
  return (
    <div className={`mt-4 rounded-lg border p-3 text-sm ${safety.ok ? 'border-emerald-200 bg-white' : 'border-red-200 bg-red-50/40'}`} aria-live="polite">
      <div className="flex items-center gap-2 font-semibold text-slate-800">
        <ShieldCheck className={`h-4 w-4 ${safety.ok ? 'text-emerald-600' : 'text-red-600'}`} />
        Theme Safety Report — {safety.ok ? 'passed' : 'refused'}
      </div>
      {st && (
        <p className="mt-1 text-xs text-slate-500">
          {st.files} files · {st.totalMB} MB unpacked · {st.templates} templates
          {st.largestModel ? ` · largest 3D model ${st.largestModel.mb} MB` : ''}
          {st.largestImage ? ` · largest image ${st.largestImage.mb} MB` : ''}
        </p>
      )}
      <List items={safety.errors} icon={<CircleX className="h-4 w-4 text-red-600" />} cls="text-red-700" />
      <List items={safety.warnings} icon={<TriangleAlert className="h-4 w-4 text-amber-500" />} cls="text-amber-800" />
      <List items={safety.fixes} icon={<Wrench className="h-4 w-4 text-sky-600" />} cls="text-slate-700" />
      {safety.ok && !safety.warnings.length && !safety.fixes.length && (
        <p className="mt-2 flex items-center gap-2 text-emerald-700">
          <CircleCheck className="h-4 w-4" /> No problems found.
        </p>
      )}
    </div>
  );
}
