'use client';

import { Input, cx } from './ui';

export type Hours = Record<string, { s: 'open' | 'closed'; o: string; c: string }>;
const DAYS: [string, string][] = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
];

export function HoursEditor({ value, onChange }: { value: Hours; onChange: (h: Hours) => void }) {
  const get = (d: string) => value[d] || { s: d === 'sun' ? 'closed' : 'open', o: '09:00', c: d === 'sat' ? '16:00' : '18:00' };
  const set = (d: string, patch: Partial<Hours[string]>) => onChange({ ...Object.fromEntries(DAYS.map(([k]) => [k, get(k)])), [d]: { ...get(d), ...patch } });
  return (
    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
      {DAYS.map(([d, label]) => {
        const h = get(d);
        return (
          <div key={d} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className="w-24 text-sm font-medium text-slate-700">{label}</span>
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
              {(['open', 'closed'] as const).map((s) => (
                <button key={s} type="button" onClick={() => set(d, { s })} className={cx('rounded-md px-3 py-1 capitalize', h.s === s ? 'bg-white shadow' : 'text-slate-500')}>
                  {s}
                </button>
              ))}
            </div>
            {h.s === 'open' && (
              <div className="flex items-center gap-2">
                <Input type="time" value={h.o} onChange={(e) => set(d, { o: e.target.value })} className="w-32" />
                <span className="text-slate-400">–</span>
                <Input type="time" value={h.c} onChange={(e) => set(d, { c: e.target.value })} className="w-32" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
