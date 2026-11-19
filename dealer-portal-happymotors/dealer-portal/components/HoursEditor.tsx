'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Input, cx } from './ui';

export type Hours = Record<string, { s: 'open' | 'closed'; o: string; c: string }>;

type Preset = 'mon-fri' | 'mon-sat' | 'mon-sun';

export function HoursEditor({ value, onChange }: { value: Hours; onChange: (h: Hours) => void }) {
  const detectPreset = (v: Hours): Preset => {
    if (v?.sun?.s === 'open') return 'mon-sun';
    if (v?.sat?.s === 'open') return 'mon-sat';
    return 'mon-fri';
  };

  const [preset, setPreset] = useState<Preset>(() => detectPreset(value || {}));
  const [openTime, setOpenTime] = useState(() => value?.mon?.o || '09:00');
  const [closeTime, setCloseTime] = useState(() => value?.mon?.c || '18:00');
  const [customSat, setCustomSat] = useState(() => value?.sat?.s === 'open' && value?.sat?.o !== value?.mon?.o);
  const [satOpen, setSatOpen] = useState(() => value?.sat?.o || '10:00');
  const [satClose, setSatClose] = useState(() => value?.sat?.c || '16:00');

  const updateHours = (p: Preset, o: string, c: string, satDiff = customSat, so = satOpen, sc = satClose) => {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri'];
    const next: Hours = {};
    for (const d of days) {
      next[d] = { s: 'open', o, c };
    }

    if (p === 'mon-sun') {
      next['sat'] = { s: 'open', o, c };
      next['sun'] = { s: 'open', o, c };
    } else if (p === 'mon-sat') {
      next['sat'] = satDiff ? { s: 'open', o: so, c: sc } : { s: 'open', o, c };
      next['sun'] = { s: 'closed', o: '09:00', c: '18:00' };
    } else {
      next['sat'] = satDiff ? { s: 'open', o: so, c: sc } : { s: 'closed', o: '09:00', c: '18:00' };
      next['sun'] = { s: 'closed', o: '09:00', c: '18:00' };
    }
    onChange(next);
  };

  const handlePreset = (p: Preset) => {
    setPreset(p);
    updateHours(p, openTime, closeTime);
  };

  const handleTimeChange = (o: string, c: string) => {
    setOpenTime(o);
    setCloseTime(c);
    updateHours(preset, o, c);
  };

  const formatTime = (t: string) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${ampm}`;
  };

  const summary = (() => {
    const hoursStr = `${formatTime(openTime)} – ${formatTime(closeTime)}`;
    if (preset === 'mon-sun') return `Mon – Sun: ${hoursStr}`;
    if (preset === 'mon-sat') return `Mon – Sat: ${hoursStr} · Sun: Closed`;
    if (preset === 'mon-fri' && customSat) return `Mon – Fri: ${hoursStr} · Sat: ${formatTime(satOpen)} – ${formatTime(satClose)} · Sun: Closed`;
    return `Mon – Fri: ${hoursStr} · Sat – Sun: Closed`;
  })();

  return (
    <div className="space-y-3">
      {/* Preset selector */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Working days schedule</label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: 'mon-fri', label: 'Mon – Fri', sub: 'Weekdays' },
              { id: 'mon-sat', label: 'Mon – Sat', sub: '6 Days' },
              { id: 'mon-sun', label: 'Mon – Sun', sub: 'Everyday' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handlePreset(item.id)}
              className={cx(
                'flex flex-col items-center justify-center rounded-xl border py-2 px-2 text-center transition cursor-pointer',
                preset === item.id
                  ? 'border-blue-600 bg-blue-50/70 font-semibold text-blue-700 ring-2 ring-blue-600/20'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <span className="text-xs sm:text-sm font-bold">{item.label}</span>
              <span className="text-[10px] sm:text-[11px] text-slate-500">{item.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Single Time Row */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-blue-600" />
            <span className="text-xs font-semibold text-slate-800">
              {preset === 'mon-sun' ? 'Everyday hours:' : preset === 'mon-sat' ? 'Mon – Sat hours:' : 'Mon – Fri hours:'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="time"
              value={openTime}
              onChange={(e) => handleTimeChange(e.target.value, closeTime)}
              className="h-8 w-24 sm:w-28 bg-white text-center text-xs font-semibold"
            />
            <span className="text-xs text-slate-400">to</span>
            <Input
              type="time"
              value={closeTime}
              onChange={(e) => handleTimeChange(openTime, e.target.value)}
              className="h-8 w-24 sm:w-28 bg-white text-center text-xs font-semibold"
            />
          </div>
        </div>

        {/* Optional Saturday customization if Mon-Fri is selected */}
        {preset === 'mon-fri' && (
          <div className="mt-2.5 border-t border-slate-200 pt-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={customSat}
                  onChange={(e) => {
                    setCustomSat(e.target.checked);
                    updateHours(preset, openTime, closeTime, e.target.checked);
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Open on Saturday with separate hours
              </label>
              {customSat && (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={satOpen}
                    onChange={(e) => {
                      setSatOpen(e.target.value);
                      updateHours(preset, openTime, closeTime, true, e.target.value, satClose);
                    }}
                    className="h-8 w-24 bg-white text-center text-xs font-semibold"
                  />
                  <span className="text-xs text-slate-400">to</span>
                  <Input
                    type="time"
                    value={satClose}
                    onChange={(e) => {
                      setSatClose(e.target.value);
                      updateHours(preset, openTime, closeTime, true, satOpen, e.target.value);
                    }}
                    className="h-8 w-24 bg-white text-center text-xs font-semibold"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Result badge */}
      <div className="flex items-center gap-2 text-xs text-slate-600 bg-emerald-50/60 border border-emerald-200/60 rounded-lg px-2.5 py-1.5">
        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        <span className="font-medium text-emerald-900">{summary}</span>
      </div>
    </div>
  );
}
