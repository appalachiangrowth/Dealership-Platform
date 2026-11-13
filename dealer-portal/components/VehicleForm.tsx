'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, CheckCircle2, Copy, Globe, Info, Rss, Sparkles, Trash2 } from 'lucide-react';
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
import { Button, Modal, cx } from './ui';
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

const TYPES = ['Car', 'Truck', 'SUV'];
const BODY = ['SUV', 'Sedan', 'Pickup Truck', 'Hatchback', 'Coupe', 'Convertible', 'Wagon', 'Minivan', 'Van / Passenger Van', 'Cargo Van'];
const DRIVE = ['Front-Wheel Drive', 'Rear-Wheel Drive', 'Four-Wheel Drive', 'All-Wheel Drive'];
const FUEL = ['Gasoline', 'Diesel', 'Biodiesel', 'Hybrid', 'Electric'];
const STATUS_TXT: Record<string, string> = { PUBLISHED: 'for sale', DRAFT: 'draft', SOLD: 'sold' };
const SERVER_ONLY = ['id', 'tenantId', 'createdAt', 'updatedAt', 'soldAt', 'legacyId', 'cargurus'];

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const withOptions = (list: string[], cur: string) => (cur && !list.includes(cur) ? [cur, ...list] : list);

/* ───────────── look of the new design ───────────── */
const CARD = 'rounded-[14px] border border-[#E5E9F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]';
const BOX =
  'flex min-h-[42px] items-stretch overflow-hidden rounded-lg border bg-white transition focus-within:border-[#2563EB] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.18)]';
const CTRL = 'min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-[#0F172A] outline-none placeholder:text-[#7A8599]';
const BTN_S =
  'inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#0F172A] transition hover:bg-[#F8FAFC] disabled:opacity-60';
const BTN_P =
  'inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-[18px] text-sm font-semibold text-white transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#C7D2E3] disabled:text-[#334155]';

/** "What is this?" text shown when hovering the ⓘ next to a field */
const TIPS: Record<string, string> = {
  images: 'Add at least one photo. The first photo is the cover shown on your website, CarGurus and Facebook. Clear daylight shots of the front, sides, interior and dashboard work best.',
  year: 'The model year shown on the title or registration, as 4 digits (for example 2021).',
  make: 'The manufacturer of the vehicle, for example Toyota, Honda or Ford.',
  model: 'The model name, for example Corolla, Civic or F-150.',
  trim: 'The version of the model, for example LE, EX-L or XLT. It is usually badged on the back of the car or shown in the VIN report. Buyers often filter by trim.',
  vehicleType: 'The general category of vehicle. It decides which section of your website the vehicle is listed in.',
  bodyStyle: 'The shape of the vehicle: sedan, SUV, pickup, coupe and so on. Facebook Marketplace needs this to list the vehicle.',
  price: 'The selling price buyers see, in US dollars. It must be more than $0.',
  processingFee: 'Any documentation or processing fee added at the time of sale. It is added to the price CarGurus shows. Leave empty if you do not charge one.',
  msrp: 'The manufacturer’s suggested retail price when the vehicle was new. Optional; shown to buyers as a comparison.',
  mileage: 'The current odometer reading, in miles. Facebook Marketplace needs more than 0.',
  vin: 'The 17-character Vehicle Identification Number. You will find it on the dashboard at the bottom of the windshield, or on the driver’s door frame. It never contains the letters I, O or Q.',
  stockNumber: 'Your own reference number for this vehicle, so your team can find it quickly. Letters, numbers and - _ . / # only.',
  condition: 'Whether the vehicle is new or used. This controls which search filter it appears under.',
  certified: 'Choose Yes only if the vehicle has passed a manufacturer’s certified pre-owned inspection programme.',
  dealLabel: 'A short highlight shown on the listing, such as “One owner” or “$1,500 below market”. Keep it under 30 characters.',
  exteriorColor: 'The main paint colour, for example Black, White or Silver. Use the everyday name buyers would search for.',
  interiorColor: 'The main colour of the seats and cabin, for example Black, Grey or Beige.',
  transmission: 'How the vehicle changes gear. Automatic and CVT need no clutch pedal; Manual has a clutch pedal and gear stick.',
  drivetrain: 'Which wheels the engine powers. All-wheel and four-wheel drive give better grip in snow and off-road.',
  fuelType: 'What the vehicle runs on.',
  engine: 'The engine size and layout, for example 2.0L 4-cylinder Turbo or 3.5L V6.',
  horsepower: 'The engine’s power output. You can find it in the owner’s manual or the manufacturer’s spec sheet.',
  cylinders: 'The number of engine cylinders, usually 3, 4, 6 or 8. Leave empty for electric vehicles.',
  interiorType: 'What the seats are made of.',
  mpg: 'Miles per gallon in city and highway driving, as listed by the EPA for this model.',
  fuelTank: 'How much fuel the tank holds, in US gallons.',
  doors: 'The number of passenger doors. Do not count the trunk or tailgate.',
  seats: 'How many people the vehicle can carry, including the driver.',
  owners: 'How many people have owned the vehicle before. Check the vehicle history report.',
  accidents: 'The number of accidents shown on the vehicle history report. Being honest here builds buyer trust.',
  description: 'The main text buyers read on your website, CarGurus and Facebook. It is written automatically from the details you enter; type in it to use your own words.',
  features: 'Options the vehicle has, one per line, for example Heated seats or Apple CarPlay. CarGurus shows them as “Installed options”.',
  safetyFeatures: 'Safety equipment, one per line, for example Blind-spot monitoring or Backup camera.',
  title: 'A custom headline for the listing on your website, for example “One-owner Toyota Camry SE”. Leave empty to use year, make, model and trim.',
  slug: 'The last part of this vehicle’s web address on your website. It is created automatically; change it only if you need to.',
  metaTitle: 'The title shown in Google results and in the browser tab. If you leave it empty, we create one from the vehicle details.',
  metaDescription: 'The short summary shown under the title in Google results. Aim for about 150 characters.',
};

/** what the website itself needs to publish (the server checks the same): [field, label] */
const WEB_REQ: [string, string][] = [
  ['images', 'At least one photo'],
  ['year', 'Year'],
  ['make', 'Make'],
  ['model', 'Model'],
  ['price', 'Price'],
  ['mileage', 'Mileage'],
];

/** the details needed to publish, in form order: [field, label, section] */
const REQ: [string, string, string][] = [
  ['images', 'At least one photo', 'Photos'],
  ['year', 'Year', 'Basics'],
  ['make', 'Make', 'Basics'],
  ['model', 'Model', 'Basics'],
  ['trim', 'Trim', 'Basics'],
  ['bodyStyle', 'Body style', 'Basics'],
  ['price', 'Price', 'Price & ID'],
  ['mileage', 'Mileage', 'Price & ID'],
  ['vin', 'VIN', 'Price & ID'],
  ['stockNumber', 'Stock number', 'Price & ID'],
  ['exteriorColor', 'Exterior colour', 'Specs'],
  ['interiorColor', 'Interior colour', 'Specs'],
  ['transmission', 'Transmission', 'Specs'],
  ['description', 'Description', 'Description'],
];

function Tip({ text, label }: { text?: string; label: string }) {
  if (!text) return null;
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={`What is ${label}?`}
        className="inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full text-[#64748B] outline-none hover:bg-[#EAF1FF] hover:text-[#1D4ED8] focus-visible:bg-[#EAF1FF] focus-visible:text-[#1D4ED8]"
      >
        <Info className="h-[15px] w-[15px]" strokeWidth={2} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] left-[-10px] z-30 hidden w-[260px] rounded-lg bg-[#0F172A] px-3 py-2.5 text-[12.5px] font-normal normal-case leading-normal tracking-normal text-[#F1F5F9] shadow-[0_8px_24px_rgba(15,23,42,0.25)] group-focus-within:block group-hover:block"
      >
        {text}
        <span className="absolute left-4 top-full border-[6px] border-transparent border-t-[#0F172A]" />
      </span>
    </span>
  );
}

/** a numbered card of the form with its "2 of 4 required" chip; some can be hidden */
function Sec({
  id, num, title, desc, chip, collapsible, startOpen = true, forceOpen, children,
}: {
  id: string; num: number; title: React.ReactNode; desc: string; chip: { text: string; tone: 'ok' | 'todo' | 'opt' }; collapsible?: boolean; startOpen?: boolean; forceOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const shown = !collapsible || open;
  return (
    <section id={id} className={cx(CARD, 'scroll-mt-28')}>
      <div className={cx('flex flex-wrap items-center gap-3 px-5 py-4', shown && 'border-b border-[#E5E9F0]')}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EAF1FF] text-[13px] font-bold text-[#1D4ED8]">{num}</span>
        <div className="flex min-w-[200px] flex-1 flex-col">
          <h2 className="m-0 flex items-center gap-1 text-base font-bold text-[#0F172A]">{title}</h2>
          <span className="text-[13px] text-[#526077]">{desc}</span>
        </div>
        <span
          className={cx(
            'whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
            chip.tone === 'ok' ? 'bg-[#E8F7EE] text-[#15803D]' : chip.tone === 'todo' ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#F1F5F9] text-[#526077]',
          )}
        >
          {chip.text}
        </span>
        {collapsible && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cx(BTN_S, 'min-h-9 px-3')}>
            {open ? 'Hide' : 'Show'}
            <ChevronDown className={cx('h-4 w-4 transition', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {/* kept in the page when hidden, so "Still needed" links can find and open the field */}
      <div className={cx('p-5', !shown && 'hidden')}>{children}</div>
    </section>
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

  // Where it goes besides the website — CarGurus / Facebook. Both optional: both off = website only.
  // A saved vehicle keeps its own choice; a new one starts from the dealership's channels (Business details).
  const savedChoice = typeof initial.syndicateCargurus === 'boolean' || typeof initial.syndicateFacebook === 'boolean';
  const [platforms, setPlatforms] = useState<('cargurus' | 'marketplace')[]>(
    savedChoice
      ? ([initial.syndicateCargurus !== false && 'cargurus', initial.syndicateFacebook !== false && 'marketplace'].filter(Boolean) as ('cargurus' | 'marketplace')[])
      : ['cargurus', 'marketplace'],
  );
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

  // Load destination platforms configured in Business details (new vehicles only: a saved vehicle keeps its choice)
  useEffect(() => {
    if (savedChoice) return;
    api('/dealer/settings')
      .then((r) => {
        const op = r?.settings?.feedOperation;
        if (op && typeof op === 'string') {
          const list = op.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) as ('cargurus' | 'marketplace')[];
          // "website" (both switched off in Business details) = website only
          setPlatforms(list.filter((p) => p === 'cargurus' || p === 'marketplace'));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // a hidden section opens itself on setHot: scroll again once it is shown
    setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    setTimeout(() => setHot(''), 2600);
    const el = box.querySelector<HTMLElement>('input,textarea,select');
    if (el && name !== 'images') setTimeout(() => el.focus({ preventScroll: true }), 250);
  }, []);

  useEffect(() => {
    if (focusField) setTimeout(() => goField(focusField), 350);
  }, [focusField, goField]);

  function bodyFor(status: string) {
    const b: Record<string, unknown> = {
      ...v,
      status,
      features: lines(featText),
      safetyFeatures: lines(safeText),
      vin: String(v.vin || '').toUpperCase().trim(),
      // where it goes besides the website (both off = website only)
      syndicateCargurus: platforms.includes('cargurus'),
      syndicateFacebook: platforms.includes('marketplace'),
    };
    for (const k of SERVER_ONLY) delete b[k];
    if (!String(b.slug || '').trim() || b.slug === initial.slug) delete b.slug;
    return b;
  }

  async function save(status: string, msg: string) {
    if (status === 'PUBLISHED') {
      if (!canPublish) {
        const issuesList: string[] = [];
        if (!webOk) {
          issuesList.push(`Website: ${webMiss.map(([, l]) => l).join(', ')}`);
        }
        if (cgSelected && !ready) {
          issuesList.push(`CarGurus: ${badCount} required field(s) missing or invalid`);
        }
        if (mpSelected && !mpOk) {
          issuesList.push(`Marketplace: ${mpMiss.size} required field(s) missing`);
        }
        toast.error(`Please complete the required details: ${issuesList.join('; ')}`);
        if (!webOk) {
          goField(webMiss[0][0]);
        } else if (cgSelected && !ready && issues[0]) {
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
      // just published (new, or was a draft / sold) with Facebook on: offer to post it on Facebook straight away
      if (status === 'PUBLISHED' && mpSelected && (isNew || status0 !== 'PUBLISHED')) {
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

  // Dynamic models for current make
  const availableModels = useMemo(() => {
    return getModelsForMake(v.make || '');
  }, [v.make]);
  const ready = issues.length === 0;
  // Facebook Marketplace: the 9 fields a listing needs (lib/marketplace)
  const mpMiss = useMemo(() => new Set(mpMissing({ ...v, images: v.images })), [v]);
  const mpOk = mpMiss.size === 0;
  const badCount = CG_ITEMS.filter(([k]) => bad[k]).length;

  const cgSelected = platforms.includes('cargurus');
  const mpSelected = platforms.includes('marketplace');

  // The website itself needs these to publish (same rule as the server): year, make, model, price, mileage, a photo
  const webMiss = WEB_REQ.filter(([k]) => (k === 'images' ? !(v.images || []).length : String(v[k] ?? '').trim() === ''));
  const webOk = webMiss.length === 0;

  // Fields required depending on active platforms (the website's own details always)
  const isReq = (k: string) => {
    if (WEB_REQ.some(([w]) => w === k)) return true;
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

  // website only (both off), website + CarGurus, website + Facebook, or all three
  const canPublish = missingReqFields.length === 0 && webOk;


  /* ───────────── what is still needed (one list for CarGurus + Marketplace) ───────────── */
  const mpMissKeys = useMemo(() => new Set(MP_FIELDS.filter(([, l]) => mpMiss.has(l)).map(([k]) => k)), [mpMiss]);
  const problem = (k: string): string => {
    if (!isReq(k)) return '';
    if (webMiss.some(([w]) => w === k)) return 'Needed to publish on your website.';
    if (cgSelected && bad[k]) return bad[k];
    if (mpSelected && mpMissKeys.has(k)) {
      return k === 'mileage' && String(v.mileage ?? '').trim() !== '' ? 'Facebook Marketplace needs a mileage of more than 0.' : 'Needed for Facebook Marketplace.';
    }
    return '';
  };
  const filled = (k: string) => (k === 'images' ? (v.images || []).length > 0 : String(v[k] ?? '').trim() !== '');
  const reqList = REQ.filter(([k]) => isReq(k));
  const stillNeeded = reqList.filter(([k]) => problem(k));
  const doneCount = reqList.length - stillNeeded.length;
  const reqTotal = reqList.length;
  const left = stillNeeded.length;
  const pct = reqTotal ? Math.round((doneCount / reqTotal) * 100) : 100;
  const chipFor = (sec: string): { text: string; tone: 'ok' | 'todo' | 'opt' } => {
    const r = reqList.filter((x) => x[2] === sec);
    if (!r.length) return { text: 'Optional', tone: 'opt' };
    const d = r.filter(([k]) => !problem(k)).length;
    return d === r.length ? { text: '✓ Complete', tone: 'ok' } : { text: `${d} of ${r.length} required`, tone: 'todo' };
  };
  const photoN = (v.images || []).length;
  // both can be off: the vehicle is then published on the website only
  const togglePlatform = (p: 'cargurus' | 'marketplace') => {
    setDirty(true);
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  };
  const channels = ['your website', ...(cgSelected ? ['CarGurus'] : []), ...(mpSelected ? ['Facebook'] : [])];

  /* ───────────── field building blocks ───────────── */
  const dupNote = (k: string) =>
    k === dup?.field && (
      <span className="text-xs font-semibold text-[#B45309]">
        Already in your inventory: <b>{nameOf(dup.v)}</b> ·{' '}
        <Link className="underline" href={`/dealer/inventory/${dup.v.id}`}>
          Open it
        </Link>
      </span>
    );

  /** one field: label (+ * when needed to publish, ⓘ help, VIN counter), the control, the problem / duplicate note */
  const field = (
    k: string,
    label: string,
    control: React.ReactNode,
    o: { wide?: boolean; full?: boolean; prefix?: string; suffix?: string; counter?: React.ReactNode; raw?: boolean; after?: React.ReactNode } = {},
  ) => {
    const err = filled(k) ? problem(k) : '';
    return (
      <div key={k} data-f={k} className={cx('flex min-w-0 scroll-mt-28 flex-col gap-1.5', o.full ? 'col-span-full' : o.wide && 'md:col-span-2')}>
        <div className="flex min-h-6 items-center gap-0.5">
          <label htmlFor={`in-${k}`} className="text-[13px] font-semibold text-[#1E293B]">
            {label}
          </label>
          {isReq(k) && (
            <>
              <span aria-hidden="true" className="ml-0.5 font-bold text-[#B91C1C]">
                *
              </span>
              <span className="sr-only">(required)</span>
            </>
          )}
          <Tip text={TIPS[k]} label={label} />
          {o.counter && <span className="ml-auto">{o.counter}</span>}
        </div>
        {o.raw ? (
          control
        ) : (
          <div className={cx(BOX, err ? 'border-[#DC2626]' : 'border-[#CBD5E1]', hot === k && 'ring-2 ring-amber-400 ring-offset-2')}>
            {o.prefix && <span className="flex items-center pl-3 font-medium text-[#526077]">{o.prefix}</span>}
            {control}
            {o.suffix && <span className="flex items-center pr-3 font-medium text-[#526077]">{o.suffix}</span>}
          </div>
        )}
        {err && <span className="text-xs font-medium text-[#B91C1C]">{err}</span>}
        {dupNote(k)}
        {o.after}
      </div>
    );
  };
  const inp = (k: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`in-${k}`} name={k} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} className={CTRL} {...props} />
  );
  const sel = (k: string, opts: string[], placeholder: string) => (
    <select id={`in-${k}`} name={k} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} className={cx(CTRL, 'cursor-pointer')}>
      <option value="">{placeholder}</option>
      {withOptions(opts, v[k]).map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </select>
  );
  /** type or pick from a long list */
  const dl = (k: string, listId: string, opts: string[], props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <>
      <input id={`in-${k}`} name={k} list={listId} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} className={CTRL} {...props} />
      <datalist id={listId}>
        {opts.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </>
  );
  const area = (value: string, onChange: (t: string) => void, props: React.TextareaHTMLAttributes<HTMLTextAreaElement> = {}) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} className={cx(CTRL, 'min-h-[120px] resize-y py-2.5 leading-normal')} {...props} />
  );
  const GRID = 'grid grid-cols-1 gap-x-4 gap-y-[18px] sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]';
  const vinLen = String(v.vin || '').trim().length;

  const publishLabel = !isNew && status0 === 'PUBLISHED' ? 'Save changes' : 'Publish vehicle';
  const doPublish = () => save('PUBLISHED', !isNew && status0 === 'PUBLISHED' ? 'Vehicle saved' : 'Published - live on your website');
  const doDraft = () => (status0 === 'SOLD' && !isNew ? save('SOLD', 'Saved') : save('DRAFT', 'Saved as draft - hidden from your website'));

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="pb-12" autoComplete="off">
      {/* ===== page header ===== */}
      <header className="sticky top-0 z-20 -mx-4 -mt-6 mb-6 border-b border-[#E5E9F0] bg-white px-4 py-[18px] sm:-mx-7 sm:-mt-7 sm:px-7">
        <div className="flex max-w-[1240px] flex-wrap items-center gap-4">
          <div className="flex min-w-[280px] flex-1 flex-col gap-1">
            <Link href="/dealer/inventory" className="inline-flex items-center gap-1 self-start text-[13px] font-semibold text-[#1D4ED8] hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to inventory
            </Link>
            <h1 className="m-0 truncate text-[26px] font-bold tracking-[-0.02em] text-[#0F172A]">{isNew ? 'Add a vehicle' : nameOf(initial) || 'Untitled vehicle'}</h1>
            {isNew ? (
              <p className="m-0 text-sm text-[#526077]">
                Fields marked <span className="font-bold text-[#B91C1C]">*</span> are needed to publish. Hover the{' '}
                <Info className="inline h-4 w-4 align-[-3px] text-[#64748B]" /> icon next to any field to see what it means.
              </p>
            ) : (
              <p className="m-0 text-sm text-[#526077]">
                Status: <b className="text-[#0F172A]">{STATUS_TXT[status0]}</b>
                {status0 === 'PUBLISHED' && tenant && (
                  <>
                    {' · '}
                    <a className="font-semibold text-[#1D4ED8] hover:underline" href={siteUrl(tenant, `index.html#/vehicle/${encodeURIComponent(initial.legacyId || initial.id)}`)} target="_blank" rel="noreferrer">
                      View on website
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-2.5">
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
              <button type="button" className={BTN_S} disabled={!!saving} onClick={doDraft}>
                {(saving === 'DRAFT' || saving === 'SOLD') && <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#CBD5E1] border-t-[#0F172A]" />}
                {!isNew && status0 === 'SOLD' ? 'Keep as sold' : 'Save as draft'}
              </button>
              <button
                type="button"
                className={BTN_P}
                disabled={!canPublish || !!saving}
                onClick={doPublish}
                title={!canPublish ? 'Fill in every detail marked * first' : undefined}
              >
                {saving === 'PUBLISHED' ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Check className="h-4 w-4" />}
                {publishLabel}
              </button>
            </div>
            <span className={cx('text-xs font-semibold', left === 0 ? 'text-[#15803D]' : 'text-[#526077]')}>
              {left === 0 ? '✓ Everything needed is filled in' : `${left} required detail${left === 1 ? '' : 's'} left before you can publish`}
            </span>
          </div>
        </div>
      </header>

      {/* already in the inventory */}
      {dup && (
        <div className="mb-5 flex max-w-[1240px] flex-wrap items-center gap-4 rounded-[14px] border border-amber-300 bg-amber-50 p-4">
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

      <div className="flex max-w-[1296px] flex-wrap items-start gap-6">
        {/* ===== the form ===== */}
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <Sec
            id="sec-photos"
            num={1}
            title={
              <>
                Photos {isReq('images') && <span className="text-[#B91C1C]">*</span>}
                <Tip text={TIPS.images} label="photos" />
              </>
            }
            desc="The first photo is the cover. Use the arrows to change the order."
            chip={photoN ? { text: `✓ ${photoN} photo${photoN === 1 ? '' : 's'}`, tone: 'ok' } : { text: 'At least 1 needed', tone: isReq('images') ? 'todo' : 'opt' }}
          >
            <div data-f="images" className={cx('scroll-mt-28 rounded-xl transition', hot === 'images' && 'ring-2 ring-amber-400 ring-offset-4')}>
              <ImageUploader studio value={v.images} onChange={(imgs) => set('images', imgs)} />
            </div>
            {problem('images') && photoN > 0 && <p className="mt-2 text-xs font-medium text-[#B91C1C]">{problem('images')}</p>}
          </Sec>

          <Sec id="sec-basics" num={2} title="The basics" desc="What the vehicle is. Buyers search by these first." chip={chipFor('Basics')}>
            <div className={GRID}>
              {field('year', 'Year', inp('year', { type: 'number', min: 1900, placeholder: 'e.g. 2021', inputMode: 'numeric' }))}
              {field('make', 'Make', dl('make', 'makes-list', VEHICLE_MAKES, { placeholder: 'e.g. Toyota' }))}
              {field('model', 'Model', dl('model', 'models-list', availableModels, { placeholder: v.make ? `Models for ${v.make}…` : 'e.g. Corolla' }))}
              {field('trim', 'Trim', inp('trim', { placeholder: 'e.g. XLT SuperCrew' }))}
              {field('vehicleType', 'Vehicle type', dl('vehicleType', 'vehicle-types-list', VEHICLE_TYPES, { placeholder: 'e.g. Car, SUV, Truck' }))}
              {field('bodyStyle', 'Body style', sel('bodyStyle', BODY, 'Select body style'))}
            </div>
          </Sec>

          <Sec id="sec-price" num={3} title="Price & identification" desc="What it costs and how you and buyers identify it." chip={chipFor('Price & ID')}>
            <div className={GRID}>
              {field('price', 'Price', inp('price', { type: 'number', min: 0, placeholder: '0', inputMode: 'decimal' }), { prefix: '$' })}
              {field('processingFee', 'Processing fee', inp('processingFee', { type: 'number', min: 0, placeholder: 'e.g. 499', inputMode: 'decimal' }), { prefix: '$' })}
              {field('msrp', 'MSRP', inp('msrp', { type: 'number', min: 0, placeholder: 'Optional', inputMode: 'decimal' }), { prefix: '$' })}
              {field('mileage', 'Mileage', inp('mileage', { type: 'number', min: 0, placeholder: 'e.g. 42500', inputMode: 'numeric' }), { suffix: 'mi' })}
              {field('vin', 'VIN', inp('vin', { placeholder: '17 characters', maxLength: 17, className: cx(CTRL, 'font-mono uppercase tracking-[0.06em]') }), {
                wide: true,
                counter: <span className={cx('text-xs font-semibold tabular-nums', vinLen === 17 ? 'text-[#15803D]' : 'text-[#526077]')}>{vinLen} / 17</span>,
              })}
              {field('stockNumber', 'Stock number', inp('stockNumber', { placeholder: 'e.g. BM-1042' }))}
              {field('condition', 'Condition', sel('condition', VEHICLE_CONDITIONS.length ? VEHICLE_CONDITIONS : ['Used', 'New', 'Rebuilt', 'Salvage'], 'Select condition'))}
              {field(
                'certified',
                'Certified pre-owned',
                <select id="in-certified" value={v.certified ? 'Yes' : 'No'} onChange={(e) => set('certified', e.target.value === 'Yes')} className={cx(CTRL, 'cursor-pointer')}>
                  <option>No</option>
                  <option>Yes</option>
                </select>,
              )}
              {field('dealLabel', 'Deal badge', inp('dealLabel', { placeholder: 'e.g. $1,500 below market' }), { wide: true })}
            </div>
          </Sec>

          <Sec id="sec-specs" num={4} title="Specifications" desc="Engine, colours, drivetrain and history." chip={chipFor('Specs')} collapsible forceOpen={!!hot}>
            <div className={GRID}>
              {field('exteriorColor', 'Exterior colour', dl('exteriorColor', 'ext-colors-list', EXTERIOR_COLORS, { placeholder: 'e.g. Silver' }))}
              {field('interiorColor', 'Interior colour', dl('interiorColor', 'int-colors-list', INTERIOR_COLORS, { placeholder: 'e.g. Black' }))}
              {field('transmission', 'Transmission', dl('transmission', 'transmissions-list', TRANSMISSIONS, { placeholder: 'e.g. Automatic' }))}
              {field('drivetrain', 'Drivetrain', sel('drivetrain', DRIVES.length ? DRIVES : DRIVE, 'Select drivetrain'))}
              {field('fuelType', 'Fuel type', sel('fuelType', FUEL_TYPES.length ? FUEL_TYPES : FUEL, 'Select fuel type'))}
              {field('engine', 'Engine', inp('engine', { placeholder: 'e.g. 3.5L V6' }))}
              {field('horsepower', 'Horsepower', inp('horsepower', { placeholder: 'e.g. 300', inputMode: 'numeric' }), { suffix: 'hp' })}
              {field('cylinders', 'Cylinders', dl('cylinders', 'cylinders-list', CYLINDERS, { placeholder: 'e.g. 6' }))}
              {field('interiorType', 'Interior material', sel('interiorType', INTERIOR_TYPES, 'Select material'))}
              {field('mpg', 'Fuel economy', inp('mpg', { placeholder: 'e.g. 18 city / 24 hwy' }))}
              {field('fuelTank', 'Tank size', inp('fuelTank', { placeholder: 'e.g. 23', inputMode: 'decimal' }), { suffix: 'gal' })}
              {field('doors', 'Doors', inp('doors', { type: 'number', min: 0, placeholder: 'e.g. 4' }))}
              {field('seats', 'Seats', inp('seats', { type: 'number', min: 0, placeholder: 'e.g. 5' }))}
              {field('owners', 'Previous owners', inp('owners', { type: 'number', min: 0, placeholder: 'e.g. 1' }))}
              {field('accidents', 'Accidents reported', inp('accidents', { type: 'number', min: 0, placeholder: 'e.g. 0' }))}
            </div>
          </Sec>

          <Sec id="sec-desc" num={5} title="Description & installed options" desc="What makes this vehicle worth a visit." chip={chipFor('Description')}>
            <div className={GRID}>
              {field(
                'description',
                'Description',
                area(
                  v.description || '',
                  (t) => {
                    setDescAuto(false);
                    set('description', t);
                  },
                  { id: 'in-description', name: 'description', rows: 7, placeholder: 'Describe the vehicle’s condition, history and highlights…' },
                ),
                {
                  full: true,
                  after: (
                    <div className="flex flex-wrap items-center gap-2.5">
                      {descAuto ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-[#526077]">
                          <Sparkles className="h-3.5 w-3.5 text-[#1D4ED8]" /> Written automatically from the details above — type in it to use your own words.
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={cx(BTN_S, 'min-h-[38px]')}
                            onClick={() => {
                              if (String(v.description || '').trim() && !window.confirm('Replace your description with one written from the vehicle details?')) return;
                              setDirty(true);
                              setDescAuto(true);
                            }}
                          >
                            <Sparkles className="h-4 w-4" /> Write it for me
                          </button>
                          <span className="text-xs text-[#526077]">Creates a draft from the details above. You can edit it freely.</span>
                        </>
                      )}
                    </div>
                  ),
                },
              )}
              {field(
                'features',
                'Installed options',
                area(
                  featText,
                  (t) => {
                    setDirty(true);
                    setFeatText(t);
                  },
                  { id: 'in-features', rows: 6, placeholder: 'Heated seats\nApple CarPlay\nSunroof' },
                ),
                { wide: true, after: <span className="text-xs text-[#526077]">One per line.</span> },
              )}
              {field(
                'safetyFeatures',
                'Installed options — safety',
                area(
                  safeText,
                  (t) => {
                    setDirty(true);
                    setSafeText(t);
                  },
                  { id: 'in-safetyFeatures', rows: 6, placeholder: 'Blind-spot monitoring\nBackup camera' },
                ),
                { wide: true, after: <span className="text-xs text-[#526077]">One per line.</span> },
              )}
            </div>
          </Sec>

          <Sec
            id="sec-seo"
            num={6}
            title="Google search & web address"
            desc="Optional. We fill these in automatically if you leave them empty."
            chip={{ text: 'Optional', tone: 'opt' }}
            collapsible
            startOpen={false}
            forceOpen={['slug', 'title', 'metaTitle', 'metaDescription'].includes(hot)}
          >
            <div className={GRID}>
              {field('metaTitle', 'Search title', inp('metaTitle', { placeholder: 'e.g. 2021 Toyota Corolla LE for sale in Salem' }), { wide: true })}
              {field('slug', 'Web address', inp('slug', { placeholder: '2021-toyota-corolla-le' }), { wide: true })}
              {field('title', 'Custom listing title', inp('title', { placeholder: 'e.g. One-owner Toyota Camry SE' }), { wide: true })}
              {field(
                'metaDescription',
                'Search description',
                area(v.metaDescription || '', (t) => set('metaDescription', t), { id: 'in-metaDescription', rows: 3, placeholder: 'A one or two sentence summary shown under the title in Google…' }),
                { full: true },
              )}
            </div>
          </Sec>

          {!cgOn && issues.some((i) => i.f === 'vin') && (
            <p className="flex items-center gap-2 text-xs text-[#526077]">
              <AlertTriangle className="h-3.5 w-3.5" /> Vehicles need a 17-character VIN and a photo to appear in your inventory feeds.
            </p>
          )}
        </div>

        {/* ===== publishing panel ===== */}
        <aside aria-label="Publishing checklist" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 lg:sticky lg:top-[132px]">
          <section className={cx(CARD, 'overflow-hidden')}>
            <div className="flex flex-col gap-3 px-5 py-[18px]">
              <h2 className="m-0 text-base font-bold text-[#0F172A]">Ready to publish?</h2>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] text-[#526077]">Required details</span>
                <span className="text-sm font-bold tabular-nums text-[#0F172A]">
                  {doneCount} of {reqTotal}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#E5E9F0]" role="progressbar" aria-valuemin={0} aria-valuemax={reqTotal} aria-valuenow={doneCount} aria-label="Required details completed">
                <div className={cx('h-full rounded-full transition-all duration-300', left === 0 ? 'bg-[#16A34A]' : 'bg-[#2563EB]')} style={{ width: `${pct}%` }} />
              </div>
            </div>

            {left === 0 && (
              <div className="mx-5 mb-[18px] flex items-start gap-2.5 rounded-[10px] border border-[#BBE5CB] bg-[#E8F7EE] px-3.5 py-3">
                <CheckCircle2 className="mt-px h-[18px] w-[18px] shrink-0 text-[#15803D]" />
                <span className="text-[13px] text-[#14532D]">
                  <b>All set.</b> Press <b>{publishLabel}</b> to put it live.
                </span>
              </div>
            )}

            {left > 0 && (
              <div className="border-t border-[#E5E9F0] px-3 py-3.5">
                <span className="block px-2 pb-2 text-xs font-semibold uppercase tracking-[0.06em] text-[#526077]">Still needed</span>
                <div className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto">
                  {stillNeeded.map(([k, label, section]) => (
                    <button key={k} type="button" onClick={() => goField(k)} title={problem(k)} className="flex items-center gap-2.5 rounded-lg p-2 text-left hover:bg-[#F1F5F9]">
                      <span className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-[#CBD5E1]" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[13px] font-medium text-[#0F172A]">{label}</span>
                        {filled(k) && <span className="truncate text-[11px] text-[#B91C1C]">{problem(k)}</span>}
                      </span>
                      <span className="text-xs text-[#526077]">{section}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-[#E5E9F0] bg-[#F8FAFC] px-5 py-4">
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-[#526077]">When you publish, it goes to</span>
              <div className="flex items-start gap-2.5">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[#EAF1FF] text-[#1D4ED8]">
                  <Globe className="h-4 w-4" />
                </span>
                <span className="flex flex-col">
                  <span className="text-[13px] font-semibold text-[#0F172A]">Your website</span>
                  <span className="text-xs text-[#526077]">Live as soon as you publish</span>
                </span>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[#EAF1FF] text-[#1D4ED8]">
                  <Rss className="h-4 w-4" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-[13px] font-semibold text-[#0F172A]">CarGurus</span>
                  <span className="text-xs text-[#526077]">{cgSelected ? 'Included in your next CarGurus feed' : 'Off — not sent to CarGurus'}</span>
                </span>
                <input type="checkbox" className="mt-1.5 h-4 w-4 accent-[#2563EB]" checked={cgSelected} onChange={() => togglePlatform('cargurus')} aria-label="Send this vehicle to CarGurus" />
              </label>
              <label className="flex cursor-pointer items-start gap-2.5">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[#EAF1FF] text-[#1877F2]">
                  <FacebookIcon className="h-4 w-4" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-[13px] font-semibold text-[#0F172A]">Facebook</span>
                  <span className="text-xs text-[#526077]">
                    {mpSelected ? 'Post it to your Pages and Marketplace right after publishing' : 'Off — not posted to Facebook'}
                  </span>
                </span>
                <input type="checkbox" className="mt-1.5 h-4 w-4 accent-[#2563EB]" checked={mpSelected} onChange={() => togglePlatform('marketplace')} aria-label="Post this vehicle to Facebook and Marketplace" />
              </label>
              <span className={cx('rounded-lg px-2.5 py-1.5 text-xs', cgSelected || mpSelected ? 'bg-white text-[#334155]' : 'bg-[#EAF1FF] font-semibold text-[#1D4ED8]')}>
                {cgSelected || mpSelected ? `Publishes to ${channels.slice(0, -1).join(', ')} and ${channels[channels.length - 1]}.` : 'Website only — CarGurus and Facebook are both off. You can turn them on any time.'}
              </span>
            </div>
          </section>

          <div className="flex items-start gap-2.5 rounded-[10px] border border-[#E5E9F0] bg-white px-3.5 py-3">
            <Info className="mt-px h-[18px] w-[18px] shrink-0 text-[#1D4ED8]" />
            <span className="text-[13px] text-[#526077]">
              Not finished? <b className="text-[#0F172A]">Save as draft</b> any time. Drafts are only visible to your team.
            </span>
          </div>
        </aside>
      </div>

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
