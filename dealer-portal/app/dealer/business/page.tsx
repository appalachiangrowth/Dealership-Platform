'use client';

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Globe,
  Image as ImageIcon,
  Info,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  Send,
  Store,
  Upload,
} from 'lucide-react';
import { useSettings } from '@/lib/useSettings';
import { mediaUrl } from '@/lib/api';
import { useTenant } from '@/components/DealerShell';
import { ErrorBox, Loading, cx } from '@/components/ui';
import { uploadFiles } from '@/components/ImageUploader';
import { MapPicker } from '@/components/MapPicker';
import { useToast } from '@/components/toast';

const KEYS = [
  'name', 'legalName', 'tagline', 'logo', 'phone', 'email', 'siteUrl', 'themeColor',
  'street', 'city', 'state', 'stateName', 'zip', 'country', 'lat', 'lng',
  'hours', 'hoursShort',
  'facebook', 'instagram', 'google', 'googleReviews', 'youtube', 'tiktok', 'messenger',
  'feedOperation',
];

/* ---------- shared look (same tokens as the other redesigned pages) ---------- */
const CARD = 'rounded-[14px] border border-[#E5E9F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]';
const FLD =
  'flex min-h-[42px] items-stretch overflow-hidden rounded-lg border border-[#CBD5E1] bg-white focus-within:border-[#2563EB] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.18)]';
const INP = 'min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-[#0F172A] outline-none placeholder:text-[#7A8599]';
const LBL = 'text-[13px] font-semibold text-[#1E293B]';
const BTN_P =
  'inline-flex min-h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#2563EB] px-[18px] text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#C7D2E3] disabled:text-[#334155]';
const BTN_S =
  'inline-flex min-h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#0F172A] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:text-[#94A3B8] disabled:hover:bg-white';
const SEG = 'inline-flex flex-wrap gap-0.5 rounded-[10px] bg-[#EEF1F6] p-1';
const segBtn = (on: boolean) =>
  cx(
    'inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3.5 text-[13px] font-semibold',
    on ? 'bg-white text-[#1D4ED8] shadow-[0_1px_2px_rgba(15,23,42,0.12)]' : 'text-[#334155] hover:text-[#0F172A]',
  );

const US_STATES =
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

const SOCIALS: [key: string, label: string, ph: string][] = [
  ['facebook', 'Facebook', 'https://facebook.com/yourdealership'],
  ['instagram', 'Instagram', 'https://instagram.com/yourdealership'],
  ['youtube', 'YouTube', 'https://youtube.com/@yourdealership'],
  ['tiktok', 'TikTok', 'https://tiktok.com/@yourdealership'],
  ['messenger', 'Messenger', 'https://m.me/yourdealership'],
  ['google', 'Google Business', 'https://maps.google.com/?cid=…'],
  ['googleReviews', 'Google reviews', 'https://g.page/r/…/review'],
];

/* ---------- small building blocks ---------- */
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`What is ${label}?`}
        className="inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full text-[#64748B] outline-none hover:bg-[#EAF1FF] hover:text-[#1D4ED8] focus-visible:bg-[#EAF1FF] focus-visible:text-[#1D4ED8]"
      >
        <Info className="h-[15px] w-[15px]" />
      </button>
      <span
        role="tooltip"
        className="invisible absolute bottom-[calc(100%+8px)] left-[-10px] z-40 w-[260px] whitespace-normal rounded-lg bg-[#0F172A] px-3 py-2.5 text-left text-[12.5px] font-normal normal-case leading-normal tracking-normal text-[#F1F5F9] shadow-[0_8px_24px_rgba(15,23,42,0.25)] after:absolute after:left-4 after:top-full after:border-[6px] after:border-transparent after:border-t-[#0F172A] after:content-[''] group-focus-within:visible group-hover:visible"
      >
        {children}
      </span>
    </span>
  );
}

function FieldLabel({ htmlFor, label, req, tip, optional }: { htmlFor?: string; label: string; req?: boolean; tip?: React.ReactNode; optional?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      <label htmlFor={htmlFor} className={LBL}>
        {label}
      </label>
      {req && (
        <span className="ml-0.5 font-bold text-[#B91C1C]" aria-hidden="true">
          *
        </span>
      )}
      {tip && <Tip label={label}>{tip}</Tip>}
      {optional && <span className="ml-1.5 text-xs text-[#526077]">Optional</span>}
    </div>
  );
}

function CardHead({ icon, title, sub, tip }: { icon: React.ReactNode; title: string; sub?: string; tip?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E9F0] px-5 py-4">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] bg-[#EAF1FF] text-[#1D4ED8]">{icon}</span>
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-0.5">
          <h2 className="m-0 text-base font-bold text-[#0F172A]">{title}</h2>
          {tip && <Tip label={title}>{tip}</Tip>}
        </div>
        {sub && <span className="text-[13px] text-[#526077]">{sub}</span>}
      </div>
    </div>
  );
}

function Note({ kind, icon, children }: { kind: 'ok' | 'info' | 'warn'; icon: React.ReactNode; children: React.ReactNode }) {
  const tone = {
    ok: 'border-[#BBE5CB] bg-[#E8F7EE] text-[#14532D]',
    info: 'border-[#DBE7FE] bg-[#EFF6FF] text-[#1E3A8A]',
    warn: 'border-[#FDE68A] bg-[#FFFBEB] text-[#78350F]',
  }[kind];
  return (
    <div className={cx('flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px] leading-normal', tone)}>
      <span className="mt-px flex-none">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/* ---------- opening hours ---------- */
type Day = { s: 'open' | 'closed'; o: string; c: string };
type Hours = Record<string, Day>;
type Mode = 'monfri' | 'monsat' | 'all' | 'custom';
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const MODES: [Mode, string, string, string][] = [
  ['monfri', 'Mon – Fri', 'Monday to Friday', 'Sat & Sun closed'],
  ['monsat', 'Mon – Sat', 'Monday to Saturday', 'Sunday closed'],
  ['all', 'Every day', 'Every day', ''],
  ['custom', 'Custom', '', ''],
];
const TIMES = Array.from({ length: 40 }, (_, i) => {
  const m = 5 * 60 + i * 30; // 5:00 AM … 12:30 AM
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});
function t12(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 && h < 24 ? 'PM' : 'AM'}`;
}
const isOpen = (h: Hours, d: string) => h?.[d]?.s === 'open';
function modeOf(h: Hours): Mode {
  if (!h || !Object.keys(h).length) return 'monsat';
  const same = (days: string[]) => days.every((d) => isOpen(h, d) && h[d].o === h.mon?.o && h[d].c === h.mon?.c);
  const wk = DAY_KEYS.slice(0, 5);
  if (same(DAY_KEYS)) return 'all';
  if (same([...wk, 'sat']) && !isOpen(h, 'sun')) return 'monsat';
  if (same(wk) && !isOpen(h, 'sat') && !isOpen(h, 'sun')) return 'monfri';
  return 'custom';
}
function build(mode: Mode, o: string, c: string): Hours {
  const openDays = mode === 'all' ? DAY_KEYS : mode === 'monsat' ? DAY_KEYS.slice(0, 6) : DAY_KEYS.slice(0, 5);
  const out: Hours = {};
  for (const d of DAY_KEYS) out[d] = openDays.includes(d) ? { s: 'open', o, c } : { s: 'closed', o, c };
  return out;
}
function hoursSummary(h: Hours, mode: Mode): string {
  const m = MODES.find((x) => x[0] === mode)!;
  if (mode !== 'custom') return `${m[2]}, ${t12(h?.mon?.o || '09:00')} – ${t12(h?.mon?.c || '18:00')}${m[3] ? ` · ${m[3]}` : ''}`;
  return DAY_KEYS.map((d) => `${DAY_NAMES[d].slice(0, 3)} ${isOpen(h, d) ? `${t12(h[d].o)} – ${t12(h[d].c)}` : 'closed'}`).join(' · ');
}

function TimeSelect({ id, value, onChange, label }: { id?: string; value: string; onChange: (v: string) => void; label?: string }) {
  const opts = TIMES.includes(value) || !value ? TIMES : [value, ...TIMES];
  return (
    <div className={FLD}>
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cx(INP, 'cursor-pointer')}>
        {opts.map((t) => (
          <option key={t} value={t}>
            {t12(t)}
          </option>
        ))}
      </select>
    </div>
  );
}

function HoursSection({ value, onChange }: { value: Hours; onChange: (h: Hours) => void }) {
  const [mode, setMode] = useState<Mode>(() => modeOf(value));
  const o = value?.mon?.o || '09:00';
  const c = value?.mon?.c || '18:00';
  const full: Hours = {};
  for (const d of DAY_KEYS) full[d] = value?.[d] || { s: 'closed', o, c };

  const pick = (m: Mode) => {
    setMode(m);
    if (m !== 'custom') onChange(build(m, o, c));
    else onChange(full);
  };
  const setDay = (d: string, patch: Partial<Day>) => onChange({ ...full, [d]: { ...full[d], ...patch } });

  return (
    <section aria-labelledby="hr-h" className={CARD}>
      <CardHead icon={<Clock className="h-[18px] w-[18px]" />} title="Opening hours" sub="So customers know when to call or visit." />
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <span className={LBL}>Days you’re open</span>
          <div className={SEG} role="group" aria-label="Days open">
            {MODES.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={mode === id} onClick={() => pick(id)} className={segBtn(mode === id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode !== 'custom' ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-[1_1_150px] flex-col gap-1.5">
              <label htmlFor="b-open" className={LBL}>
                Opens
              </label>
              <TimeSelect id="b-open" value={o} onChange={(v) => onChange(build(mode, v, c))} />
            </div>
            <span className="pb-3 text-[#526077]">to</span>
            <div className="flex flex-[1_1_150px] flex-col gap-1.5">
              <label htmlFor="b-close" className={LBL}>
                Closes
              </label>
              <TimeSelect id="b-close" value={c} onChange={(v) => onChange(build(mode, o, v))} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[#EEF1F6] rounded-[10px] border border-[#E5E9F0]">
            {DAY_KEYS.map((d) => {
              const day = full[d];
              const open = day.s === 'open';
              return (
                <div key={d} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                  <span className="w-[96px] text-sm font-semibold text-[#1E293B]">{DAY_NAMES[d]}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={open}
                    aria-label={`${DAY_NAMES[d]} open`}
                    onClick={() => setDay(d, { s: open ? 'closed' : 'open' })}
                    className={cx('relative h-[26px] w-11 flex-none rounded-full', open ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]')}
                  >
                    <span className={cx('absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-[left]', open ? 'left-[21px]' : 'left-[3px]')} />
                  </button>
                  {open ? (
                    <div className="flex flex-[1_1_240px] items-center gap-2">
                      <div className="flex-1">
                        <TimeSelect label={`${DAY_NAMES[d]} opens`} value={day.o} onChange={(v) => setDay(d, { o: v })} />
                      </div>
                      <span className="text-[#526077]">to</span>
                      <div className="flex-1">
                        <TimeSelect label={`${DAY_NAMES[d]} closes`} value={day.c} onChange={(v) => setDay(d, { c: v })} />
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-[#526077]">Closed</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Note kind="info" icon={<Eye className="h-4 w-4" />}>
          <b>Customers will see:</b> {hoursSummary(full, mode)}
        </Note>
      </div>
    </section>
  );
}

/* ---------- address helpers ---------- */
interface OsmItem {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
}
function fromOsm(a: Record<string, string> = {}, display = '') {
  const house = a.house_number ? `${a.house_number} ` : '';
  return {
    street: house + (a.road || a.street || a.pedestrian || a.footway || display.split(',')[0] || ''),
    city: a.city || a.town || a.village || a.municipality || a.county || '',
    state: a['ISO3166-2-lvl4'] ? a['ISO3166-2-lvl4'].split('-')[1] : a.state_code || '',
    stateName: a.state || '',
    zip: a.postcode || '',
    country: a.country || '',
  };
}
/** Map pin from a pasted Google Maps / Business Profile link (…/@37.29,-80.05,17z, …!3d37.29!4d-80.05, ?q=37.29,-80.05). */
function coordsFromGoogle(url: string): { lat: string; lng: string } | null {
  const pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, /[?&](?:q|ll|query|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i];
  for (const p of pats) {
    const m = url.match(p);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
    }
  }
  return null;
}

/* ================================ page ================================ */
export default function BusinessPage() {
  const { form, set, save, saving, dirty, error, reset } = useSettings(KEYS);
  const { tenant, refreshTenant } = useTenant();
  const toast = useToast();

  const [addrMode, setAddrMode] = useState<'manual' | 'google'>('manual');
  const [osmQuery, setOsmQuery] = useState('');
  const [osmSearching, setOsmSearching] = useState(false);
  const [osmResults, setOsmResults] = useState<OsmItem[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [gState, setGState] = useState<'' | 'busy' | 'ok' | 'nopin'>('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [showMap, setShowMap] = useState<boolean | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  if (error) return <ErrorBox error={error} />;
  if (!form) return <Loading />;

  const put = (k: string, v: unknown) => {
    set(k, v);
    setJustSaved(false);
  };
  const applyAddress = (a: Partial<Record<'street' | 'city' | 'state' | 'stateName' | 'zip' | 'country' | 'lat' | 'lng', string>>) => {
    for (const k of ['street', 'city', 'state', 'stateName', 'zip', 'country', 'lat', 'lng'] as const) if (a[k] !== undefined) put(k, a[k]);
  };

  const searchOsm = async (q: string) => {
    if (!q || q.trim().length < 3) {
      setOsmResults([]);
      setShowResults(false);
      return;
    }
    setOsmSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q.trim())}&addressdetails=1&limit=5`, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        setOsmResults((await res.json()) || []);
        setShowResults(true);
      }
    } catch {
      /* offline: typing the address still works */
    } finally {
      setOsmSearching(false);
    }
  };
  const onSearchChange = (v: string) => {
    setOsmQuery(v);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchOsm(v), 400);
  };
  const pickOsm = (it: OsmItem) => {
    applyAddress({ ...fromOsm(it.address, it.display_name), lat: Number(it.lat).toFixed(6), lng: Number(it.lon).toFixed(6) });
    setShowResults(false);
    setOsmQuery(it.display_name);
  };

  const readGoogle = async (url: string) => {
    put('google', url);
    const pin = url.trim() ? coordsFromGoogle(url) : null;
    if (!pin) {
      setGState(url.trim() ? 'nopin' : '');
      return;
    }
    setGState('busy');
    applyAddress(pin);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pin.lat}&lon=${pin.lng}&addressdetails=1`, { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        applyAddress(fromOsm(j.address, j.display_name || ''));
      }
    } catch {
      /* the pin is still saved */
    }
    setGState('ok');
  };

  const uploadLogo = async (files: FileList | null) => {
    if (!files?.length) return;
    setLogoBusy(true);
    try {
      const [u] = await uploadFiles(files, 'site');
      put('logo', u);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLogoBusy(false);
      if (logoRef.current) logoRef.current.value = '';
    }
  };

  // "website" = neither CarGurus nor Facebook Marketplace (vehicles go to the website only)
  const platforms: string[] = String(form.feedOperation || 'cargurus,marketplace')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s === 'cargurus' || s === 'marketplace');
  const togglePlatform = (p: string) => {
    const on = platforms.includes(p);
    const next = on ? platforms.filter((x) => x !== p) : [...platforms, p];
    put('feedOperation', next.length ? next.join(',') : 'website');
  };

  const val = (k: string) => String(form[k] ?? '');
  const required: [string, string][] = [
    ['name', 'Dealership name'],
    ['phone', 'Phone number'],
    ['email', 'Public email'],
    ['street', 'Street address'],
    ['city', 'City'],
    ['state', 'State'],
    ['zip', 'ZIP code'],
    ['siteUrl', 'Main website address'],
  ];
  const missing = required.filter(([k]) => !val(k).trim());
  const pinned = !!(form.lat && form.lng);
  const mapOpen = showMap ?? !pinned;
  const addressLine = [val('street'), val('city'), [val('state'), val('zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const states = val('state') && !US_STATES.includes(val('state').toUpperCase()) ? [val('state'), ...US_STATES] : US_STATES;

  const changes = dirty;
  const onSave = async () => {
    if (await save()) {
      refreshTenant();
      setJustSaved(true);
    }
  };
  const onDiscard = () => {
    reset();
    setResetKey((k) => k + 1);
    setGState('');
    setOsmQuery('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !saving) void onSave();
      }}
      className="-mb-6 flex flex-col sm:-mb-7"
      autoComplete="off"
    >
      {/* ===== header ===== */}
      <header className="-mx-4 -mt-6 border-b border-[#E5E9F0] bg-white px-4 py-5 sm:-mx-7 sm:-mt-7 sm:px-7">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-[280px] flex-[1_1_360px] flex-col gap-1">
            <span className="text-[13px] font-medium text-[#526077]">
              Your website / <span className="text-[#0F172A]">Business details</span>
            </span>
            <h1 className="m-0 text-[26px] font-bold tracking-[-0.02em] text-[#0F172A]">Business details</h1>
            <p className="m-0 text-sm text-[#526077]">
              Your dealership’s name, contact details, address and hours. They appear on every page of your website and in your feeds.
            </p>
          </div>
          {missing.length ? (
            <span
              title={missing.map((m) => m[1]).join(', ')}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#FEF3C7] px-3 py-1.5 text-[13px] font-semibold text-[#92400E]"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {missing.length === 1 ? `1 required detail missing` : `${missing.length} required details missing`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#E8F7EE] px-3 py-1.5 text-[13px] font-semibold text-[#15803D]">
              <CheckCircle2 className="h-3.5 w-3.5" /> Required details complete
            </span>
          )}
        </div>
      </header>

      {/* ===== body ===== */}
      <div className="flex w-full flex-wrap items-start gap-5 py-6">
        {/* LEFT */}
        <div className="flex min-w-0 flex-[1.3_1_480px] flex-col gap-5">
          {/* Dealership details */}
          <section aria-labelledby="dd-h" className={CARD}>
            <CardHead icon={<Store className="h-[18px] w-[18px]" />} title="Dealership details" sub="How customers know and reach you." />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-[18px] p-5">
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="b-name" label="Dealership name" req tip="Your business name as customers know it. Shown in your website header, page titles and emails to customers." />
                <div className={FLD}>
                  <input id="b-name" className={INP} value={val('name')} onChange={(e) => put('name', e.target.value)} placeholder="e.g. Blue Motors" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="b-phone" label="Phone number" req tip="The number customers call. It appears on every page and as a tap-to-call button on phones." />
                <div className={FLD}>
                  <span className="flex items-center pl-3 text-[#64748B]">
                    <Phone className="h-4 w-4" />
                  </span>
                  <input id="b-phone" type="tel" className={INP} value={val('phone')} onChange={(e) => put('phone', e.target.value)} placeholder="(555) 234-5678" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel
                  htmlFor="b-email"
                  label="Public email"
                  req
                  tip="The email address shown on your website for customers. It can be different from the address that receives inquiry notifications."
                />
                <div className={FLD}>
                  <span className="flex items-center pl-3 text-[#64748B]">
                    <Mail className="h-4 w-4" />
                  </span>
                  <input id="b-email" type="email" className={INP} value={val('email')} onChange={(e) => put('email', e.target.value)} placeholder="sales@yourdealership.com" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel
                  htmlFor="b-tag"
                  label="Tagline"
                  optional
                  tip="One short line describing your dealership, for example “Quality pre-owned vehicles in Salem, VA”. Some designs show it in the header."
                />
                <div className={FLD}>
                  <input id="b-tag" className={INP} value={val('tagline')} onChange={(e) => put('tagline', e.target.value)} placeholder="e.g. Quality pre-owned vehicles in Salem, VA" />
                </div>
              </div>
            </div>
          </section>

          {/* Address */}
          <section aria-labelledby="ad-h" className={CARD}>
            <CardHead icon={<MapPin className="h-[18px] w-[18px]" />} title="Address" sub="Used for your map, directions and Google listing." />
            <div className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <div className={SEG} role="group" aria-label="How to add your address">
                  {(
                    [
                      ['manual', 'Type my address'],
                      ['google', 'Use Google Business link'],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={addrMode === id} onClick={() => setAddrMode(id)} className={segBtn(addrMode === id)}>
                      {label}
                    </button>
                  ))}
                </div>
                <Tip label="Address options">Type your street address, or paste the link to your Google Business Profile and we read the address and map pin from it.</Tip>
              </div>

              {addrMode === 'manual' ? (
                <>
                  <div className="relative flex flex-col gap-1.5">
                    <FieldLabel htmlFor="b-find" label="Find your address" optional />
                    <div className={FLD}>
                      <span className="flex items-center pl-3 text-[#64748B]">
                        <Search className="h-4 w-4" />
                      </span>
                      <input
                        id="b-find"
                        className={INP}
                        value={osmQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        onFocus={() => osmResults.length > 0 && setShowResults(true)}
                        onBlur={() => setTimeout(() => setShowResults(false), 150)}
                        placeholder="Start typing and pick your address — we fill the boxes below"
                      />
                      {osmSearching && (
                        <span className="flex items-center pr-3 text-[#2563EB]">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </span>
                      )}
                    </div>
                    {showResults && osmResults.length > 0 && (
                      <div className="absolute top-full z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-[10px] border border-[#E5E9F0] bg-white p-1 shadow-lg">
                        {osmResults.map((it) => (
                          <button
                            key={it.place_id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickOsm(it)}
                            className="flex w-full items-start gap-2.5 rounded-lg p-2 text-left text-[13px] text-[#334155] hover:bg-[#EFF6FF]"
                          >
                            <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none text-[#2563EB]" />
                            <span className="truncate">{it.display_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                    <div className="col-span-full flex flex-col gap-1.5">
                      <FieldLabel htmlFor="b-st" label="Street address" req />
                      <div className={FLD}>
                        <input id="b-st" className={INP} value={val('street')} onChange={(e) => put('street', e.target.value)} placeholder="e.g. 1204 W Main St" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor="b-city" label="City" req />
                      <div className={FLD}>
                        <input id="b-city" className={INP} value={val('city')} onChange={(e) => put('city', e.target.value)} placeholder="Salem" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor="b-state" label="State" req />
                      <div className={FLD}>
                        <select id="b-state" className={cx(INP, 'cursor-pointer')} value={val('state').toUpperCase()} onChange={(e) => put('state', e.target.value)}>
                          <option value="">Choose…</option>
                          {states.map((s) => (
                            <option key={s} value={s.toUpperCase()}>
                              {s.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor="b-zip" label="ZIP code" req />
                      <div className={FLD}>
                        <input id="b-zip" inputMode="numeric" className={INP} value={val('zip')} onChange={(e) => put('zip', e.target.value)} placeholder="24153" />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor="b-gbp" label="Google Business Profile link" tip="Open your business on Google Maps, press Share, copy the link and paste it here." />
                  <div className={FLD}>
                    <span className="flex items-center pl-3 text-[#64748B]">
                      <Link2 className="h-4 w-4" />
                    </span>
                    <input id="b-gbp" type="url" className={INP} value={val('google')} onChange={(e) => void readGoogle(e.target.value)} placeholder="https://maps.google.com/?cid=…" />
                    {gState === 'busy' && (
                      <span className="flex items-center pr-3 text-[#2563EB]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </span>
                    )}
                  </div>
                  {gState === 'nopin' && (
                    <span className="text-xs text-[#92400E]">
                      This link has no map position in it (short “maps.app.goo.gl” links don’t). Open it in your browser, copy the long address from the address bar and paste that instead — or
                      drop the pin on the map below.
                    </span>
                  )}
                  {gState === 'ok' && <span className="text-xs text-[#15803D]">Address and map pin read from your link. Check them below.</span>}
                  {addressLine && (
                    <span className="text-xs text-[#526077]">
                      Current address: <b className="text-[#0F172A]">{addressLine}</b>{' '}
                      <button type="button" className="font-semibold text-[#1D4ED8] hover:underline" onClick={() => setAddrMode('manual')}>
                        Edit
                      </button>
                    </span>
                  )}
                </div>
              )}

              {pinned ? (
                <Note kind="ok" icon={<CheckCircle2 className="h-4 w-4" />}>
                  <b>Map pin found:</b> {addressLine || `${form.lat}, ${form.lng}`}. Customers get directions to this spot.
                </Note>
              ) : (
                <Note kind="warn" icon={<AlertTriangle className="h-4 w-4" />}>
                  <b>No map pin yet.</b> Pick your address from the search, paste a Google link, or click your lot on the map below.
                </Note>
              )}

              <div className="rounded-[10px] border border-[#E5E9F0]">
                <button
                  type="button"
                  aria-expanded={mapOpen}
                  onClick={() => setShowMap(!mapOpen)}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] font-semibold text-[#1D4ED8] hover:bg-[#F8FAFC]"
                >
                  <MapPin className="h-4 w-4" />
                  {mapOpen ? 'Hide the map' : 'Show the map and move the pin'}
                </button>
                {mapOpen && (
                  <div className="border-t border-[#E5E9F0] p-3">
                    <MapPicker
                      key={resetKey}
                      lat={form.lat}
                      lng={form.lng}
                      onLocationSelect={(loc) => {
                        applyAddress(loc);
                        if (loc.displayName) setOsmQuery(loc.displayName);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>

          <HoursSection key={resetKey} value={(form.hours || {}) as Hours} onChange={(h) => put('hours', h)} />
        </div>

        {/* RIGHT */}
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          {/* Website address */}
          <section aria-labelledby="ws-h" className={CARD}>
            <CardHead icon={<Globe className="h-[18px] w-[18px]" />} title="Website address" />
            <div className="flex flex-col gap-3 p-5">
              <div className="flex flex-col gap-1.5">
                <FieldLabel
                  htmlFor="b-web"
                  label="Main website address"
                  req
                  tip="The web address customers type to reach your site. Every vehicle link, your CarGurus feed and Facebook posts use it, so only change it if your domain changes."
                />
                <div className={FLD}>
                  <span className="flex items-center pl-3 text-[#64748B]">
                    <Link2 className="h-4 w-4" />
                  </span>
                  <input id="b-web" type="url" className={INP} value={val('siteUrl')} onChange={(e) => put('siteUrl', e.target.value)} placeholder="https://www.yourdealership.com" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5 rounded-[10px] border border-[#E5E9F0] bg-[#F8FAFC] p-3 text-[13px]">
                <span className="flex justify-between gap-2">
                  <span className="inline-flex items-center text-[#526077]">
                    Dealer ID <Tip label="Dealer ID">Your account number on our platform. Quote it when you contact support.</Tip>
                  </span>
                  <b className="text-[#0F172A]">{tenant?.dealerCode || '—'}</b>
                </span>
                <span className="flex justify-between gap-2">
                  <span className="text-[#526077]">{(tenant?.domains?.length || 0) > 1 ? 'Connected domains' : 'Connected domain'}</span>
                  <b className="min-w-0 break-all text-right text-[#0F172A]">{tenant?.domains?.length ? tenant.domains.join(', ') : 'None yet'}</b>
                </span>
              </div>
            </div>
          </section>

          {/* Logo */}
          <section aria-labelledby="lg-h" className={CARD}>
            <CardHead icon={<ImageIcon className="h-[18px] w-[18px]" />} title="Logo" sub="Shown in your website header and footer." />
            <div className="flex flex-wrap items-center gap-4 p-5">
              <span className="flex h-[72px] w-[120px] items-center justify-center overflow-hidden rounded-[10px] border border-[#E5E9F0] bg-[#F8FAFC] text-xs font-semibold text-[#64748B]">
                {logoBusy ? (
                  <Loader2 className="h-5 w-5 animate-spin text-[#2563EB]" />
                ) : form.logo ? (
                  <img src={mediaUrl(form.logo)} alt="Your logo" className="h-full w-full object-contain p-1.5" />
                ) : (
                  'Your logo'
                )}
              </span>
              <div className="flex flex-[1_1_160px] flex-col gap-2">
                <div className="flex gap-2">
                  <button type="button" className={cx(BTN_S, 'min-h-[38px]')} disabled={logoBusy} onClick={() => logoRef.current?.click()}>
                    <Upload className="h-4 w-4" />
                    {form.logo ? 'Replace' : 'Upload'}
                  </button>
                  {form.logo && (
                    <button
                      type="button"
                      className="inline-flex min-h-[36px] items-center justify-center rounded-lg px-2.5 text-[13px] font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]"
                      onClick={() => put('logo', '')}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <span className="text-xs text-[#526077]">Best: a PNG with a transparent background, at least 400 px wide.</span>
                <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => void uploadLogo(e.target.files)} />
              </div>
            </div>
          </section>

          {/* Social links */}
          <section aria-labelledby="sc-h" className={CARD}>
            <CardHead icon={<Link2 className="h-[18px] w-[18px]" />} title="Social links" sub="Optional. Icons appear in your website footer." />
            <div className="flex flex-col gap-2.5 px-5 pb-5 pt-3">
              {SOCIALS.map(([k, label, ph]) => (
                <div key={k} className="flex items-center gap-2.5">
                  <label htmlFor={`soc-${k}`} className="w-[130px] flex-none text-[13px] font-semibold text-[#1E293B]">
                    {label}
                  </label>
                  <div className={cx(FLD, 'min-h-[38px] flex-1')}>
                    <input id={`soc-${k}`} type="url" className={INP} value={val(k)} onChange={(e) => put(k, e.target.value)} placeholder={ph} />
                  </div>
                </div>
              ))}
              <span className="text-xs text-[#526077]">Leave a box empty to hide that icon.</span>
            </div>
          </section>

          {/* Destinations */}
          <section aria-labelledby="ds-h" className={CARD}>
            <CardHead
              icon={<Send className="h-[18px] w-[18px]" />}
              title="Where your vehicles are sent"
              sub="We make sure every vehicle has what these need."
              tip="Choose the outside platforms you list vehicles on. The Add vehicle form then asks for the details those platforms need."
            />
            <div className="flex flex-col gap-2.5 px-5 pb-5 pt-4">
              {(
                [
                  ['cargurus', 'CarGurus', 'Vehicles are added to your CarGurus feed when published.'],
                  ['marketplace', 'Facebook Marketplace', 'List your vehicles on Facebook Marketplace using FB Poster.'],
                ] as const
              ).map(([id, label, desc]) => {
                const on = platforms.includes(id);
                return (
                  <label
                    key={id}
                    className={cx(
                      'flex cursor-pointer items-start gap-3 rounded-[10px] border px-3.5 py-3',
                      on ? 'border-[#93B4F5] bg-[#F5F8FF]' : 'border-[#E5E9F0] bg-white hover:bg-[#F8FAFC]',
                    )}
                  >
                    <input type="checkbox" className="m-0 mt-0.5 h-[18px] w-[18px] flex-none cursor-pointer accent-[#2563EB]" checked={on} onChange={() => togglePlatform(id)} />
                    <span className="flex flex-1 flex-col">
                      <span className="text-sm font-semibold text-[#0F172A]">{label}</span>
                      <span className="text-[12.5px] text-[#526077]">{desc}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* ===== save bar ===== */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-auto flex flex-wrap items-center gap-3 border-t border-[#E5E9F0] bg-white px-4 py-3.5 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] sm:-mx-7 sm:px-7">
        <div className="flex flex-[1_1_300px] items-center gap-2.5" role="status">
          <span className={cx('h-2.5 w-2.5 flex-none rounded-full', changes ? 'bg-[#F59E0B]' : 'bg-[#16A34A]')} />
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-[#0F172A]">{changes ? 'You have unsaved changes' : justSaved ? 'Changes saved' : 'All changes saved'}</span>
            <span className="text-xs text-[#526077]">{changes ? 'Save to update your website, feeds and emails.' : 'Your website shows these details.'}</span>
          </span>
        </div>
        <button type="button" className={BTN_S} disabled={!dirty || saving} onClick={onDiscard}>
          Discard changes
        </button>
        <button type="submit" className={BTN_P} disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.4} />}
          Save changes
        </button>
      </div>
    </form>
  );
}
