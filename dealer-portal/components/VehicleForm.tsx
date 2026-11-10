'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Copy, Trash2, X } from 'lucide-react';
import { api, mediaUrl, siteUrl } from '@/lib/api';
import { cgIssues, CG_ITEMS } from '@/lib/cargurus';
import { MP_FIELDS, mpMissing } from '@/lib/marketplace';
import { autoDescription } from '@/lib/vehicle-description';
import { FacebookIcon } from '@/lib/facebook';
import { FbPostModal } from './fb/FbPostModal';
import { brandRun } from '@/lib/branding';
import { useToast } from './toast';
import { useTenant } from './DealerShell';
import { ImageUploader } from './ImageUploader';
import { Button, Input, Modal, Select, Textarea, cx } from './ui';
import { money, vehicleName } from '@/lib/format';
import {
  VEHICLE_MAKES,
  VEHICLE_TYPES,
  VEHICLE_CONDITIONS,
  EXTERIOR_COLORS,
  INTERIOR_COLORS,
  CYLINDERS,
  INTERIOR_TYPES,
  TRANSMISSIONS,
  DRIVES,
  FUEL_TYPES,
  getModelsForMake,
} from '@/lib/vehicle-options';

const nameOf = (x: Record<string, any>) => vehicleName(x as { year?: number | null; make?: string; model?: string; trim?: string });

export type Vehicle = Record<string, any> & { id?: string; images: string[]; features: string[]; safetyFeatures: string[] };

/** A new vehicle starts like in the old portal. */
export const EMPTY_VEHICLE: Vehicle = {
  year: new Date().getFullYear() - 3, make: '', model: '', trim: '', vehicleType: 'Car', bodyStyle: 'Sedan', condition: 'Used', certified: false,
  price: '', processingFee: '', msrp: '', mileage: '', stockNumber: '', vin: '', exteriorColor: '', interiorColor: '', engine: '', horsepower: '',
  drivetrain: 'Front-Wheel Drive', transmission: '', fuelType: 'Gasoline', mpg: '', fuelTank: '', doors: '4', seats: '5', owners: '1', accidents: '0',
  dealLabel: '', description: '', features: [], safetyFeatures: [], images: [], status: 'PUBLISHED', featured: false,
  slug: '', title: '', metaTitle: '', metaDescription: '',
};

/** help under each Marketplace check */
const HELP_MP: Record<string, string> = {"year": "4 digits", "make": "e.g. Ford", "model": "e.g. F-150", "price": "more than $0", "images": "at least one photo", "mileage": "more than 0", "bodyStyle": "e.g. Sedan, SUV", "exteriorColor": "e.g. Silver", "interiorColor": "e.g. Black"};

const TYPES = ['Car', 'Truck', 'SUV'];
const BODY = ['SUV', 'Sedan', 'Pickup Truck', 'Hatchback', 'Coupe', 'Convertible', 'Wagon', 'Minivan', 'Van / Passenger Van', 'Cargo Van'];
const DRIVE = ['Front-Wheel Drive', 'Rear-Wheel Drive', 'Four-Wheel Drive', 'All-Wheel Drive'];
const FUEL = ['Gasoline', 'Diesel', 'Biodiesel', 'Hybrid', 'Electric'];
const STATUS_TXT: Record<string, string> = { PUBLISHED: 'for sale', DRAFT: 'draft', SOLD: 'sold' };
const SERVER_ONLY = ['id', 'tenantId', 'createdAt', 'updatedAt', 'soldAt', 'legacyId', 'cargurus'];

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const withOptions = (list: string[], cur: string) => (cur && !list.includes(cur) ? [cur, ...list] : list);

/** A collapsible section of the form (open by default for existing vehicles, like the old editor). */
function Section({ title, hint, open, children, collapsible = true }: { title: string; hint?: string; open?: boolean; children: React.ReactNode; collapsible?: boolean }) {
  const [o, setO] = useState(!!open || !collapsible);
  useEffect(() => {
    if (open) setO(true);
  }, [open]);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        disabled={!collapsible}
        onClick={() => setO(!o)}
        className={cx('flex w-full items-center justify-between gap-3 px-5 py-4 text-left', collapsible && 'cursor-pointer')}
      >
        <span>
          <span className="font-heading text-base font-bold text-slate-900">{title}</span>
          {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
        </span>
        {collapsible && <ChevronDown className={cx('h-4 w-4 text-slate-400 transition', o && 'rotate-180')} />}
      </button>
      {o && <div className="border-t border-slate-100 px-5 pb-5 pt-4">{children}</div>}
    </section>
  );
}

function F({ label, name, hot, children, full }: { label: React.ReactNode; name: string; hot: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div data-f={name} className={cx('rounded-lg transition', full && 'sm:col-span-2 lg:col-span-4', hot === name && 'ring-2 ring-amber-400 ring-offset-4')}>
      <label className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</label>
      {children}
    </div>
  );
}

/** Platform toggle — CarGurus / Marketplace multi-select */
function PlatformToggle({ value, onChange }: { value: ('cargurus' | 'marketplace')[]; onChange: (v: ('cargurus' | 'marketplace')[]) => void }) {
  const toggle = (p: 'cargurus' | 'marketplace') => {
    if (value.includes(p)) {
      const next = value.filter((x) => x !== p);
      if (next.length > 0) onChange(next);
    } else onChange([...value, p]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {(['cargurus', 'marketplace'] as const).map((p) => {
        const active = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            onClick={() => toggle(p)}
            className={cx(
              'flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-semibold transition',
              active ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
            )}
          >
            <span className={cx('inline-flex h-4 w-4 items-center justify-center rounded border-2', active ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white')}>
              {active && (
                <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5.5L4 8L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            {p === 'cargurus' ? 'CarGurus' : 'Marketplace'}
          </button>
        );
      })}
    </div>
  );
}

export function VehicleForm({ initial, focusField }: { initial: Vehicle; focusField?: string }) {
  const isNew = !initial.id;
  const [v, setV] = useState<Vehicle>(initial);
  const [featText, setFeatText] = useState((initial.features || []).join('\n'));
  const [safeText, setSafeText] = useState((initial.safetyFeatures || []).join('\n'));
  // the description writes itself from the details while the dealer has not typed in it (empty description)
  const [descAuto, setDescAuto] = useState(!String(initial.description || '').trim());
  const [saving, setSaving] = useState('');
  const [dirty, setDirty] = useState(false);
  const [del, setDel] = useState(false);
  const [all, setAll] = useState<Vehicle[]>([]);
  const [cgOn, setCgOn] = useState(false);
  const [hot, setHot] = useState('');

  // Platform selection — CarGurus / Marketplace toggles
  const [platforms, setPlatforms] = useState<('cargurus' | 'marketplace')[]>(['cargurus', 'marketplace']);
  // after "Publish vehicle": the Facebook popup for the saved vehicle (closing it goes back to Inventory)
  const [fbVehicle, setFbVehicle] = useState<Vehicle | null>(null);
  const router = useRouter();
  const toast = useToast();
  const { tenant } = useTenant();
  const formRef = useRef<HTMLFormElement>(null);
  const status0: string = initial.status || 'PUBLISHED';

  const set = (k: string, val: unknown) => {
    setDirty(true);
    setV((x) => ({ ...x, [k]: val }));
  };

  useEffect(() => {
    if (!descAuto) return;
    const t = autoDescription(v, lines(featText), lines(safeText));
    if (t !== (v.description || '')) setV((x) => ({ ...x, description: t }));
  }, [descAuto, v, featText, safeText]);

  // the rest of the inventory: "already in your inventory" warning + duplicate VIN / stock checks
  useEffect(() => {
    api('/dealer/vehicles?pageSize=500')
      .then((r) => {
        setAll(r.items);
        setCgOn(!!r.cargurusOn);
      })
      .catch(() => {});
  }, []);

  // Load destination platforms configured in Business details
  useEffect(() => {
    api('/dealer/settings')
      .then((r) => {
        const op = r?.settings?.feedOperation;
        if (op && typeof op === 'string') {
          const list = op.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) as ('cargurus' | 'marketplace')[];
          const valid = list.filter((p) => p === 'cargurus' || p === 'marketplace');
          if (valid.length > 0) setPlatforms(valid);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const current = useMemo(
    () => ({ ...v, id: v.id || '__new__', status: 'PUBLISHED', features: lines(featText), vin: String(v.vin || '').toUpperCase() }),
    [v, featText],
  );
  const issues = useMemo(() => cgIssues(current, all), [current, all]);
  const bad = useMemo(() => {
    const m: Record<string, string> = {};
    for (const i of issues) if (!m[i.f]) m[i.f] = i.m;
    return m;
  }, [issues]);

  const dup = useMemo(() => {
    const others = all.filter((x) => x.id !== v.id);
    const vin = String(v.vin || '').toUpperCase().trim();
    const stock = String(v.stockNumber || '').trim().toLowerCase();
    if (vin.length >= 11) {
      const a = others.find((x) => String(x.vin || '').toUpperCase() === vin);
      if (a) return { v: a, by: `VIN ${vin}`, field: 'vin' };
    }
    if (stock) {
      const a = others.find((x) => String(x.stockNumber || '').trim().toLowerCase() === stock);
      if (a) return { v: a, by: `stock number ${v.stockNumber}`, field: 'stockNumber' };
    }
    return null;
  }, [all, v.id, v.vin, v.stockNumber]);

  /** Scroll to a field and highlight it (CarGurus checklist, "Fix" links). */
  const goField = useCallback((name: string) => {
    const box = formRef.current?.querySelector<HTMLElement>(`[data-f="${name}"]`);
    if (!box) return;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHot(name);
    setTimeout(() => setHot(''), 2600);
    const el = box.querySelector<HTMLElement>('input,textarea,select');
    if (el && name !== 'images') setTimeout(() => el.focus({ preventScroll: true }), 250);
  }, []);

  useEffect(() => {
    if (focusField) setTimeout(() => goField(focusField), 350);
  }, [focusField, goField]);

  function bodyFor(status: string) {
    const b: Record<string, unknown> = { ...v, status, features: lines(featText), safetyFeatures: lines(safeText), vin: String(v.vin || '').toUpperCase().trim() };
    for (const k of SERVER_ONLY) delete b[k];
    if (!String(b.slug || '').trim() || b.slug === initial.slug) delete b.slug;
    return b;
  }

  async function save(status: string, msg: string) {
    if (status === 'PUBLISHED') {
      if (platforms.length === 0) {
        toast.error('Select at least one platform (CarGurus or Marketplace).');
        return;
      }
      if (!canPublish) {
        const issuesList: string[] = [];
        if (cgSelected && !ready) {
          issuesList.push(`CarGurus: ${badCount} required field(s) missing or invalid`);
        }
        if (mpSelected && !mpOk) {
          issuesList.push(`Marketplace: ${mpMiss.size} required field(s) missing`);
        }
        toast.error(`Please complete all required fields for the selected platform(s): ${issuesList.join('; ')}`);
        if (cgSelected && !ready && issues[0]) {
          goField(issues[0].f);
        } else if (mpSelected && !mpOk) {
          const firstMiss = Array.from(mpMiss)[0];
          const f = MP_FIELDS.find(([, l]) => l === firstMiss)?.[0];
          if (f) goField(f);
        }
        return;
      }
    } else if (!String(v.make || '').trim() && !String(v.model || '').trim()) {
      toast.error('Enter at least a make or model.');
      goField('make');
      return;
    }
    if (dup && !window.confirm(`This vehicle is already in your inventory: ${nameOf(dup.v)} has the same ${dup.by}. Save it as a second vehicle anyway? (Better: open the existing one and update it.)`)) return;
    setSaving(status);
    try {
      const body = bodyFor(status);
      const out = isNew ? await api('/dealer/vehicles', { body }) : await api(`/dealer/vehicles/${v.id}`, { method: 'PATCH', body });
      setDirty(false);
      toast.ok(msg);
      void brandRun(); // the main photo gets the dealer's branding bands (when photo branding is on)
      // just published (new, or was a draft / sold): offer to post it on Facebook straight away
      if (status === 'PUBLISHED' && (isNew || status0 !== 'PUBLISHED')) {
        setFbVehicle({ ...v, ...body, ...(out && typeof out === 'object' && out.id ? out : { id: v.id }) } as Vehicle);
        return;
      }
      router.push('/dealer/inventory');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function duplicate() {
    if (dirty && !window.confirm('Duplicate without saving your changes to this vehicle?')) return;
    setSaving('dup');
    try {
      const b = bodyFor('DRAFT');
      b.vin = '';
      b.stockNumber = '';
      b.featured = false;
      delete b.slug;
      const out = await api('/dealer/vehicles', { body: b });
      toast.ok('Copy saved as a draft');
      router.push(`/dealer/inventory/${out.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  const text = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <F label={label} name={k} hot={hot}>
      <Input name={k} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...props} />
      {k === dup?.field && (
        <div className="mt-1.5 text-xs font-semibold text-amber-700">
          Already in your inventory: <b>{nameOf(dup.v)}</b> ·{' '}
          <Link className="underline" href={`/dealer/inventory/${dup.v.id}`}>
            Open it
          </Link>
        </div>
      )}
    </F>
  );
  const pick = (k: string, label: string, opts: string[]) => (
    <F label={label} name={k} hot={hot}>
      <Select name={k} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
        <option value="">Select {label}...</option>
        {withOptions(opts, v[k]).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </Select>
    </F>
  );

  // Datalist input for fields that support typing or picking from extensive options
  const datalistInput = (
    k: string,
    label: string,
    listId: string,
    opts: string[],
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    customOnChange?: (val: string) => void,
  ) => (
    <F label={label} name={k} hot={hot}>
      <Input
        name={k}
        list={listId}
        value={v[k] ?? ''}
        onChange={(e) => {
          if (customOnChange) {
            customOnChange(e.target.value);
          } else {
            set(k, e.target.value);
          }
        }}
        {...props}
      />
      <datalist id={listId}>
        {opts.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {k === dup?.field && (
        <div className="mt-1.5 text-xs font-semibold text-amber-700">
          Already in your inventory: <b>{nameOf(dup.v)}</b> ·{' '}
          <Link className="underline" href={`/dealer/inventory/${dup.v.id}`}>
            Open it
          </Link>
        </div>
      )}
    </F>
  );

  // Dynamic models for current make
  const availableModels = useMemo(() => {
    return getModelsForMake(v.make || '');
  }, [v.make]);
  const grid = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4';
  const ready = issues.length === 0;
  // Facebook Marketplace: the 9 fields a listing needs (lib/marketplace)
  const mpMiss = useMemo(() => new Set(mpMissing({ ...v, images: v.images })), [v]);
  const mpOk = mpMiss.size === 0;
  const badCount = CG_ITEMS.filter(([k]) => bad[k]).length;

  const cgSelected = platforms.includes('cargurus');
  const mpSelected = platforms.includes('marketplace');

  // Fields required depending on active platforms
  const isReq = (k: string) => {
    if (cgSelected && mpSelected) {
      return (
        k === 'vin' || k === 'make' || k === 'model' || k === 'year' || k === 'trim' ||
        k === 'price' || k === 'mileage' || k === 'images' || k === 'exteriorColor' ||
        k === 'description' || k === 'stockNumber' || k === 'transmission' ||
        k === 'bodyStyle' || k === 'interiorColor'
      );
    }
    if (cgSelected) {
      return (
        k === 'vin' || k === 'make' || k === 'model' || k === 'year' || k === 'trim' ||
        k === 'price' || k === 'mileage' || k === 'images' || k === 'exteriorColor' ||
        k === 'description' || k === 'stockNumber' || k === 'transmission'
      );
    }
    if (mpSelected) {
      return (
        k === 'year' || k === 'make' || k === 'model' || k === 'price' ||
        k === 'images' || k === 'mileage' || k === 'bodyStyle' ||
        k === 'exteriorColor' || k === 'interiorColor'
      );
    }
    return false;
  };

  const reqStar = (k: string, label: string) => (isReq(k) ? `${label} *` : label);

  // Validation checks for publishing/adding
  const missingReqFields = useMemo(() => {
    const miss: string[] = [];
    if (cgSelected && !ready) {
      miss.push('CarGurus requirements');
    }
    if (mpSelected && !mpOk) {
      miss.push('Marketplace requirements');
    }
    return miss;
  }, [cgSelected, mpSelected, ready, mpOk]);

  const canPublish = missingReqFields.length === 0 && platforms.length > 0;

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="mx-auto max-w-5xl space-y-5 pb-10" autoComplete="off">
      {/* header with the old buttons */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-[#f4f6fb]/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="min-w-0">
          <Link href="/dealer/inventory" className="mb-0.5 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-3 w-3" /> Inventory
          </Link>
          <h1 className="truncate font-heading text-xl font-extrabold text-slate-900">{isNew ? 'Add vehicle' : nameOf(initial) || 'Untitled vehicle'}</h1>
          <div className="text-xs text-slate-500">
            {isNew ? (
              'Fill in the starred fields and add photos, then publish.'
            ) : (
              <>
                Status: <b>{STATUS_TXT[status0]}</b>
                {status0 === 'PUBLISHED' && tenant && (
                  <>
                    {' · '}
                    <a className="text-blue-700 underline" href={`${siteUrl(tenant)}/index.html#/vehicle/${encodeURIComponent(initial.legacyId || initial.id)}`} target="_blank" rel="noreferrer">
                      View on website
                    </a>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isNew && (
            <>
              <Button type="button" variant="danger" size="sm" onClick={() => setDel(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={duplicate} loading={saving === 'dup'}>
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="secondary"
            loading={saving === 'DRAFT' || saving === 'SOLD'}
            onClick={() => (status0 === 'SOLD' && !isNew ? save('SOLD', 'Saved') : save('DRAFT', 'Saved as draft - hidden from your website'))}
          >
            {!isNew && status0 === 'SOLD' ? 'Keep as sold' : 'Save as draft'}
          </Button>
          <Button
            type="button"
            loading={saving === 'PUBLISHED'}
            disabled={!canPublish}
            onClick={() => save('PUBLISHED', !isNew && status0 === 'PUBLISHED' ? 'Vehicle saved' : 'Published - live on your website')}
            title={!canPublish ? `Please fulfill required fields for ${platforms.join(' & ')} before publishing` : undefined}
          >
            {!isNew && status0 === 'PUBLISHED' ? 'Save changes' : 'Publish vehicle'}
          </Button>
        </div>
      </div>

      {/* already in the inventory */}
      {dup && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 font-bold text-amber-950">!</span>
          <div className="min-w-0 flex-1 text-sm text-amber-950">
            <b className="block">This vehicle is already in your inventory</b>
            Same {dup.by} as <b>{nameOf(dup.v)}</b> ({STATUS_TXT[dup.v.status]}
            {dup.v.price ? ` · ${money(dup.v.price)}` : ''}). Open it to update it instead of adding it twice.
          </div>
          {dup.v.images?.[0] && <img src={mediaUrl(dup.v.images[0])} alt="" className="h-12 w-20 rounded-md object-cover" />}
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (dirty && !window.confirm('Leave this form without saving?')) return;
              setDirty(false);
              router.push(`/dealer/inventory/${dup.v.id}`);
            }}
          >
            Open existing vehicle
          </Button>
        </div>
      )}

      {/* live CarGurus checklist */}
      {cgSelected && (
        <div className={cx('overflow-hidden rounded-2xl border bg-white shadow-sm', ready ? 'border-emerald-200' : 'border-amber-200')}>
          <div className={cx('px-5 py-3', ready ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900')}>
            {ready ? (
              <>
                <b className="block">✓ Ready for CarGurus</b>
                <span className="text-sm">All {CG_ITEMS.length} required details are complete.</span>
              </>
            ) : (
              <>
                <b className="block">
                  CarGurus: {badCount} of {CG_ITEMS.length} required details missing or wrong
                </b>
                <span className="text-sm">The vehicle can go on your website now; it joins CarGurus once these are complete.</span>
              </>
            )}
          </div>
          <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
            {CG_ITEMS.map(([k, label, help]) => {
              const m = bad[k];
              return (
                <button key={k} type="button" onClick={() => goField(k)} className="flex items-start gap-2.5 bg-white px-4 py-2.5 text-left hover:bg-slate-50">
                  <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', m ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600')}>
                    {m ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <b className="block text-sm text-slate-800">{label}</b>
                    <small className={cx('block text-xs', m ? 'text-red-600' : 'text-slate-500')}>{m || help}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* live Facebook Marketplace checklist */}
      {mpSelected && (
        <div className={cx('overflow-hidden rounded-2xl border bg-white shadow-sm', mpOk ? 'border-blue-200' : 'border-slate-200')}>
          <div className={cx('flex items-start gap-2.5 px-5 py-3', mpOk ? 'bg-blue-50 text-blue-900' : 'bg-slate-50 text-slate-800')}>
            <FacebookIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#1877F2]" />
            <span>
              {mpOk ? (
                <>
                  <b className="block">✓ Ready for Facebook Marketplace</b>
                  <span className="text-sm">All {MP_FIELDS.length} Marketplace details are complete. After publishing you can post it to Marketplace in one click.</span>
                </>
              ) : (
                <>
                  <b className="block">
                    Facebook Marketplace: {mpMiss.size} of {MP_FIELDS.length} details missing
                  </b>
                  <span className="text-sm">It can still go on your website and on your Facebook profile; Marketplace needs these too.</span>
                </>
              )}
            </span>
          </div>
          <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
            {MP_FIELDS.map(([k, label]) => {
              const miss = mpMiss.has(label);
              return (
                <button key={k} type="button" onClick={() => goField(k)} className="flex items-start gap-2.5 bg-white px-4 py-2.5 text-left hover:bg-slate-50">
                  <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', miss ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-[#1877F2]')}>
                    {miss ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <b className="block text-sm text-slate-800">{label}</b>
                    <small className={cx('block text-xs', miss ? 'text-red-600' : 'text-slate-500')}>
                      {miss ? (k === 'mileage' && String(v.mileage ?? '').trim() !== '' ? 'Mileage must be more than 0' : `Missing ${label}`) : HELP_MP[k]}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Section title="Photos" hint="The first photo is the cover on your website. JPG, PNG or GIF — other formats are converted to JPG automatically." collapsible={false}>
        <div data-f="images" className={cx('rounded-xl transition', hot === 'images' && 'ring-2 ring-amber-400 ring-offset-4')}>
          <ImageUploader value={v.images} onChange={(imgs) => set('images', imgs)} />
        </div>
      </Section>

      <Section title="The basics" collapsible={false}>
        <div className={grid}>
          {text('year', reqStar('year', 'Year'), { type: 'number', min: 1900 })}
          {datalistInput(
            'make',
            reqStar('make', 'Make'),
            'makes-list',
            VEHICLE_MAKES,
            { placeholder: 'e.g. Honda, Toyota, Ford' },
            (newMake) => {
              setDirty(true);
              setV((prev) => {
                const updated: Vehicle = { ...prev, make: newMake };
                // If model is set but doesn't belong to new make, clear or keep as user wishes
                return updated;
              });
            },
          )}
          {datalistInput(
            'model',
            reqStar('model', 'Model'),
            'models-list',
            availableModels,
            { placeholder: v.make ? `Models for ${v.make}...` : 'Select or type model' },
          )}
          {text('trim', reqStar('trim', 'Trim'), { placeholder: 'XLT SuperCrew' })}
          {datalistInput('vehicleType', 'Vehicle Type', 'vehicle-types-list', VEHICLE_TYPES, { placeholder: 'e.g. Sedan, SUV, Truck' })}
          {pick('bodyStyle', reqStar('bodyStyle', 'Body style'), BODY)}
        </div>
      </Section>

      <Section title="Price & identification" collapsible={false}>
        <div className={grid}>
          {text('price', reqStar('price', 'Price ($)'), { type: 'number', min: 0 })}
          {text('processingFee', 'Processing Fee ($)', { type: 'number', min: 0, placeholder: 'e.g. 499' })}
          {text('mileage', reqStar('mileage', 'Mileage'), { type: 'number', min: 0 })}
          {text('stockNumber', reqStar('stockNumber', 'Stock number'))}
          {text('vin', reqStar('vin', 'VIN'), { placeholder: '17 characters - needed for feeds', maxLength: 17, className: 'font-mono uppercase' })}
          {pick('condition', 'Condition', VEHICLE_CONDITIONS.length ? VEHICLE_CONDITIONS : ['Used', 'New', 'Rebuilt', 'Salvage'])}
          <F label="Certified pre-owned" name="certified" hot={hot}>
            <Select value={v.certified ? 'Yes' : 'No'} onChange={(e) => set('certified', e.target.value === 'Yes')}>
              <option>No</option>
              <option>Yes</option>
            </Select>
          </F>
          {text('msrp', 'MSRP ($)', { type: 'number', min: 0, placeholder: 'Optional' })}
          {text('dealLabel', 'Deal badge', { placeholder: '$1,500 below market' })}
        </div>
      </Section>

      <Section title="Specifications" hint="Engine, colours, drivetrain, history" open={!isNew || cgOn}>
        <div className={grid}>
          {datalistInput('exteriorColor', reqStar('exteriorColor', 'Exterior colour'), 'ext-colors-list', EXTERIOR_COLORS, { placeholder: 'e.g. Black, White, Silver' })}
          {datalistInput('interiorColor', reqStar('interiorColor', 'Interior colour'), 'int-colors-list', INTERIOR_COLORS, { placeholder: 'e.g. Black, Gray, Beige' })}
          {text('engine', 'Engine', { placeholder: '3.5L EcoBoost V6' })}
          {text('horsepower', 'Horsepower')}
          {pick('drivetrain', 'Drivetrain', DRIVES.length ? DRIVES : DRIVE)}
          {datalistInput('transmission', reqStar('transmission', 'Transmission'), 'transmissions-list', TRANSMISSIONS, { placeholder: 'e.g. Automatic, Manual, 10 Speed' })}
          {pick('fuelType', 'Fuel', FUEL_TYPES.length ? FUEL_TYPES : FUEL)}
          {datalistInput('cylinders', 'Cylinders', 'cylinders-list', CYLINDERS, { placeholder: 'e.g. 4, 6, 8' })}
          {pick('interiorType', 'Interior Type', INTERIOR_TYPES)}
          {text('mpg', 'MPG', { placeholder: '18 city / 24 hwy' })}
          {text('fuelTank', 'Tank size')}
          {text('doors', 'Doors', { type: 'number', min: 0 })}
          {text('seats', 'Seats', { type: 'number', min: 0 })}
          {text('owners', 'Previous owners', { type: 'number', min: 0 })}
          {text('accidents', 'Accidents reported', { type: 'number', min: 0 })}
        </div>
      </Section>

      <Section title="Description & installed options" hint="What makes this vehicle worth a visit" open={!isNew || cgOn}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <F
              label={
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {reqStar('description', 'Description')}{' '}
                    <span className="font-normal text-slate-400">
                      {descAuto ? '— written automatically from the details; type in it to change it' : '— your own text'}
                    </span>
                  </span>
                  {!descAuto && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-blue-700 hover:underline"
                      onClick={() => {
                        if (String(v.description || '').trim() && !window.confirm('Replace your description with one written from the vehicle details?')) return;
                        setDirty(true);
                        setDescAuto(true);
                      }}
                    >
                      Write it from the details
                    </button>
                  )}
                </span>
              }
              name="description"
              hot={hot}
            >
              <Textarea
                name="description"
                rows={7}
                value={v.description || ''}
                onChange={(e) => {
                  setDescAuto(false);
                  set('description', e.target.value);
                }}
              />
            </F>
          </div>
          <F label={<>Installed options <span className="font-normal text-slate-400">one per line</span></>} name="features" hot={hot}>
            <Textarea
              rows={6}
              placeholder={'Heated seats\nApple CarPlay'}
              value={featText}
              onChange={(e) => {
                setDirty(true);
                setFeatText(e.target.value);
              }}
            />
          </F>
          <F label={<>Installed options — safety <span className="font-normal text-slate-400">one per line</span></>} name="safetyFeatures" hot={hot}>
            <Textarea
              rows={6}
              placeholder="Blind-spot monitoring"
              value={safeText}
              onChange={(e) => {
                setDirty(true);
                setSafeText(e.target.value);
              }}
            />
          </F>
        </div>
      </Section>

      <Section title="Search engines & page address" hint="Optional">
        <div className={grid}>
          {text('slug', 'Page address', { placeholder: '2021-toyota-camry-se' })}
          {text('title', 'Custom title', { placeholder: 'One-owner Toyota Camry SE' })}
          <div className="sm:col-span-2">{text('metaTitle', 'Google title')}</div>
          <div className="sm:col-span-2 lg:col-span-4">
            <F label="Google description" name="metaDescription" hot={hot}>
              <Textarea rows={2} value={v.metaDescription || ''} onChange={(e) => set('metaDescription', e.target.value)} />
            </F>
          </div>
        </div>
      </Section>

      {!cgOn && issues.some((i) => i.f === 'vin') && (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <AlertTriangle className="h-3.5 w-3.5" /> Vehicles need a 17-character VIN and a photo to appear in your inventory feeds.
        </p>
      )}

      <Modal
        open={del}
        onClose={() => setDel(false)}
        title={`Delete ${nameOf(initial) || 'this vehicle'}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={saving === 'del'}
              onClick={async () => {
                setSaving('del');
                try {
                  await api(`/dealer/vehicles/${v.id}`, { method: 'DELETE' });
                  setDirty(false);
                  toast.ok('Vehicle deleted');
                  router.push('/dealer/inventory');
                } catch (e) {
                  toast.error((e as Error).message);
                  setSaving('');
                }
              }}
            >
              Delete vehicle
            </Button>
          </>
        }
      >
        It disappears from your website, your feeds and CarGurus. This cannot be undone.
      </Modal>

      <FbPostModal
        vehicle={fbVehicle}
        onClose={() => {
          setFbVehicle(null);
          router.push('/dealer/inventory');
        }}
        intro={
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            <Check className="h-4 w-4" /> Published on your website. Post it on Facebook now?
          </div>
        }
      />
    </form>
  );
}
