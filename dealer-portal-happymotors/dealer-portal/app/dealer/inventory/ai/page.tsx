'use client';

/**
 * Add a vehicle (the only way to add one). The "+ Add vehicle" popup (AddVehicleChooser) opens this page:
 *  · Add Manually (?mode=manual, or /dealer/inventory/new) — no mode cards at all: the VIN box (with Scan) and a
 *    Decode VIN button, the photo uploader and the full vehicle form. AI does not read the photos here.
 *  · Add with AI (default) — two cards at the top:
 *     · Photos & VIN — type or scan the VIN (looks itself up), upload photos (AI reads them when it is on).
 *       The full vehicle form is always open below, so a dealer can also simply fill it in by hand.
 *     · Walkaround Video — one video; AI takes the photos, VIN, mileage and spoken notes from it.
 * "Only you can answer these" (price, mileage, stock number, history) stays at the top. Every form value is tagged
 * VIN / AI / You / Needs you and can be changed; values the dealer changed are kept when AI finishes later. A VIN
 * decode, the photo reading and the video reading fill the form in place (no popups). Publishing uploads the
 * photos, saves the vehicle and offers Facebook.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTenant } from '@/components/DealerShell';
import { useToast } from '@/components/toast';
import { PHOTO_ACCEPT, uploadFiles } from '@/components/ImageUploader';
import { FbPostModal } from '@/components/fb/FbPostModal';
import { AQ_CSS } from '@/components/ai/aqStyles';
import { usePhotoSort } from '@/lib/use-photo-sort';
import { api, mediaUrl } from '@/lib/api';
import { BODY_STYLES, DRIVETRAINS, checkStock, checkVin, normBodyStyle, normDrive, normVin, StockDup, STOCK_TAKEN_RE, VinDup } from '@/lib/vin-check';
import { trimOptions } from '@/lib/trims';
import { PriceInput, rawPrice } from '@/components/PriceInput';
import { useMobileFormFocus } from '@/lib/use-mobile-form';
import { VinScannerModal } from '@/components/VinScannerModal';
import { ScanLine } from 'lucide-react';
import { brandRun } from '@/lib/branding';
import {
  aiApi, AiStatus, ANGLE_LABEL, ANGLE_ORDER, arrangePhotos, bigFrame, extractAudio, extractFrames, mergeVideo, nextPhotoId, Photo, shrink, Vid, vinOk,
} from '@/lib/ai';

/* ======================= fields of the results page ======================= */
const OPT: Record<string, string[]> = {
  vtype: ['Car', 'Truck', 'SUV', 'Van', 'Motorcycle'],
  body: BODY_STYLES,
  condition: ['Used', 'New'],
  ext: ['Black', 'White', 'Silver', 'Gray', 'Blue', 'Red', 'Green', 'Brown', 'Beige', 'Gold', 'Orange', 'Yellow', 'Purple'],
  int: ['Black', 'Gray', 'Beige', 'Brown', 'White', 'Red', 'Blue', 'Other'],
  trans: ['Automatic', 'Manual', 'CVT', 'Dual-Clutch'],
  drive: DRIVETRAINS,
  fuel: ['Gasoline', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Electric', 'Biodiesel'],
  itype: ['Cloth', 'Leather', 'Leatherette', 'Suede', 'Vinyl'],
};
// [key, label, required, tip, prefix, suffix, size, kind]
type FieldDef = [string, string, 0 | 1, string, string?, string?, string?, string?];
/** the search fields: shown inside "More Options" (no card of their own) */
const SEO_TITLE = 'Online Search & Web Address';
const SECTIONS: [string, string, FieldDef[]][] = [
  ['The Basics', 'Confirm your vehicle details.', [
    ['year', 'Year', 1, 'The model year, as 4 digits.'],
    ['make', 'Make', 1, 'The manufacturer, e.g. Toyota or Ford.'],
    ['model', 'Model', 1, 'The model name, e.g. Corolla or F-150.'],
    ['trim', 'Trim', 1, 'The version of the model, e.g. LE or XLT. Badged on the back or shown in the VIN report.'],
    ['vtype', 'Vehicle type', 0, 'The general category; decides which section of your website lists it.'],
    ['body', 'Body style', 1, 'The shape: sedan, SUV, pickup and so on. Facebook Marketplace needs it.'],
  ]],
  ['Pricing & Details', '', [
    ['price', 'Price', 1, 'The selling price buyers see, in US dollars.', '$'],
    ['fee', 'Processing fee', 0, 'Any documentation fee added at sale. Leave empty if none.', '$'],
    ['msrp', 'MSRP', 0, 'The original manufacturer price when new. Optional.', '$'],
    ['mileage', 'Mileage', 1, 'The odometer reading in miles. AI reads it from the dashboard photo; please double-check it.', '', 'mi'],
    ['vin', 'VIN', 1, 'The 17-character Vehicle Identification Number.', '', '', 'wide'],
    ['stock', 'Stock number', 1, 'Your own stock number for this vehicle. Type it in; it is never created automatically.'],
    ['condition', 'Condition', 0, 'New or used.'],
    ['badge', 'Deal badge', 0, 'A short highlight on the listing, e.g. "One owner". Under 30 characters.', '', '', 'wide'],
  ]],
  ['Specifications', '', [
    ['ext', 'Exterior color', 1, 'The main paint color, read by AI from the photos.'],
    ['int', 'Interior color', 1, 'The main cabin color. Choose it yourself: it is never filled in by the VIN or AI.'],
    ['trans', 'Transmission', 1, 'How the vehicle changes gear.'],
    ['drive', 'Drivetrain', 0, 'Which wheels are powered.'],
    ['fuel', 'Fuel type', 0, 'What the vehicle runs on.'],
    ['engine', 'Engine', 0, 'Engine size and layout, e.g. 3.5L V6.'],
    ['hp', 'Horsepower', 0, 'Engine power output.', '', 'hp'],
    ['itype', 'Interior material', 0, 'What the seats are made of (cloth, leather …). Choose it yourself: it is never filled in by the VIN or AI. Added to the features list.'],
    ['mpg', 'Fuel economy', 0, 'Miles per gallon, city / highway. Optional.'],
    ['tank', 'Tank size', 0, 'Fuel tank size in US gallons. Optional.', '', 'gal'],
    ['doors', 'Doors', 0, 'Number of passenger doors.'],
    ['seats', 'Seats', 0, 'How many people it carries.'],
    ['owners', 'Previous owners', 0, 'Optional. How many people owned the vehicle before. Check the vehicle history report. Never filled in by AI.'],
    ['accidents', 'Accidents reported', 0, 'The number of accidents on the vehicle history report. Optional; never filled in by AI.'],
    ['options', 'Installed Options', 0, 'Options and features installed on this vehicle, one per line. Shown in the features list on your website.', '', '', 'full', 'area'],
  ]],
  ['Description', 'Describe this vehicle.', [
    ['description', 'Description', 1, 'Written by AI from the VIN record and what it saw in the photos. Edit it freely.', '', '', 'full', 'area'],
  ]],
  [SEO_TITLE, 'Auto-Populated. Edit as needed.', [
    ['seoTitle', 'Search title', 0, 'The title shown in Google results and the browser tab.', '', '', 'wide'],
    ['slug', 'Web address', 0, 'The end of this vehicle’s web address.', '', '', 'wide'],
  ]],
];
/** Specifications fields shown under "More options" (closed by default; still part of the form and saved as before) */
const MORE_KEYS = ['hp', 'itype', 'mpg', 'tank', 'doors', 'seats', 'owners', 'accidents', 'options'];
/** "Online Search & Web Address" fields: also under "More Options" (they have no card of their own any more) */
const SEO_KEYS = ['seoTitle', 'slug'];
const LABEL: Record<string, string> = {};
const REQUIRED: string[] = [];
SECTIONS.forEach((s) =>
  s[2].forEach((f) => {
    LABEL[f[0]] = f[1];
    if (f[2]) REQUIRED.push(f[0]);
  }),
);
const VSTEPS: [string, string][] = [
  ['read', 'Opening the video'], ['frames', 'Looking through your video'], ['audio', 'Listening to what you said'], ['ai', 'AI is reading the video'],
  ['close', 'Reading the VIN and mileage up close'], ['photos', 'Choosing the best photos'], ['vin', 'Looking up the VIN'],
];

type Decoded = {
  fields: Record<string, string>;
  clean: boolean;
  warnings: string[];
  safety: string[];
  checkDigitOk: boolean;
};
type You = { price: string; condition: string; owners: string; accidents: string; notes: string };
type Res = { v: Record<string, string>; src: Record<string, string>; ev: Record<string, string>; ok: Record<string, boolean> };
type Note = { kind: 'ok' | 'bad' | 'warn' | 'info'; icon: string; html: React.ReactNode };
type AiState = 'idle' | 'waiting' | 'running' | 'done' | 'error';
/** manual = Add Manually (VIN + Decode VIN, photos, full form) · photos = Photos & VIN · video = Walkaround Video */
type Mode = 'manual' | 'photos' | 'video';
const MANUAL_HINT = 'Enter VIN and click Decode VIN to continue.';
const AUTO_HINT = 'Looks up automatically when all 17 characters are entered.';
/** the VIN box with its Scan icon and phone layout (on top of AQ_CSS) */
const ENTRY_CSS = `
/* VIN box and Photos box: a soft animated outline around the card only (inside, layout and inputs are unchanged) */
@property --aq-ang{syntax:'<angle>';inherits:false;initial-value:0deg}
@keyframes aq-ring{to{--aq-ang:360deg}}
@keyframes aq-halo{0%,100%{box-shadow:0 1px 2px rgba(15,23,42,.05),0 0 0 0 rgba(37,99,235,0)}50%{box-shadow:0 1px 2px rgba(15,23,42,.05),0 0 18px 1px rgba(37,99,235,.16)}}
.aq .card.glow{position:relative;animation:aq-halo 4.5s ease-in-out infinite}
.aq .card.glow::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.5px;pointer-events:none;
  background:conic-gradient(from var(--aq-ang),#2563EB,#60A5FA 25%,#A5B4FC 40%,#22C55E 55%,#60A5FA 75%,#2563EB);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;
  animation:aq-ring 6s linear infinite;opacity:.85}
@media (prefers-reduced-motion:reduce){.aq .card.glow,.aq .card.glow::before{animation:none}}
/* form fields: a quiet animated outline (gradient border drawn as the border-box background, so .fld keeps overflow:hidden).
   Red stays unmistakably red: a missing required field (.miss) gets a crimson outline that pulses; never blue or green. */
@keyframes aq-redpulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,0)}50%{box-shadow:0 0 0 3px rgba(220,38,38,.20)}}
.aq .fld{border-color:transparent;background:linear-gradient(var(--fld-bg,#fff),var(--fld-bg,#fff)) padding-box,conic-gradient(from var(--aq-ang),#CBD5E1,#93C5FD 30%,#CBD5E1 55%,#BFDBFE 80%,#CBD5E1) border-box;animation:aq-ring 9s linear infinite}
.aq .fld:focus-within{border-color:transparent;background:linear-gradient(var(--fld-bg,#fff),var(--fld-bg,#fff)) padding-box,conic-gradient(from var(--aq-ang),#2563EB,#60A5FA 50%,#2563EB) border-box}
.aq .fld.ai{--fld-bg:#FBFAFF;border-color:transparent;background:linear-gradient(var(--fld-bg),var(--fld-bg)) padding-box,conic-gradient(from var(--aq-ang),#C4B5FD,#A5B4FC 40%,#DDD6FE 70%,#C4B5FD) border-box}
.aq .fld.unsure{--fld-bg:#FFFDF5;border-color:transparent;background:linear-gradient(var(--fld-bg),var(--fld-bg)) padding-box,conic-gradient(from var(--aq-ang),#FCD34D,#FBBF24 40%,#FDE68A 70%,#FCD34D) border-box}
.aq .fld.miss,.aq .fld.miss:focus-within{--fld-bg:#FFFBFB;border-color:transparent;background:linear-gradient(var(--fld-bg),var(--fld-bg)) padding-box,conic-gradient(from var(--aq-ang),#DC2626,#F87171 30%,#B91C1C 55%,#EF4444 80%,#DC2626) border-box;animation:aq-ring 4s linear infinite,aq-redpulse 1.8s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.aq .fld,.aq .fld.miss{animation:none}.aq .fld.miss{box-shadow:0 0 0 2px rgba(220,38,38,.2)}}
/* "Online Search & Web Address" inside More Options */
.aq .subsec{display:flex;flex-direction:column;gap:8px;margin-top:18px;padding-top:16px;border-top:1px solid #E5E9F0}
.aq .subsec h3{margin:0;font-size:14.5px;font-weight:700;color:#0F172A}
.aq .subsec .hint{margin:-4px 0 4px}
/* "← Inventory": a bigger, bolder arrow that is easy to tap */
.aq .backlink{display:inline-flex;align-items:center;gap:6px;font-size:14px;min-height:36px;margin-left:-4px;padding:0 6px;border-radius:8px;text-decoration:none}
.aq .backlink:hover{background:#EFF6FF}
.aq .backlink .arr{font-size:24px;line-height:1;font-weight:800;transform:translateY(-1px)}
/* Publish vehicle: green · Save as draft: neutral gray */
.aq .btn.pub{background:#16A34A;border-color:#16A34A;color:#fff}
.aq .btn.pub:hover:not(:disabled){background:#15803D;border-color:#15803D}
.aq .btn.pub .spin.w{border-color:rgba(255,255,255,.45);border-top-color:#fff}
.aq .btn.draft{background:#E2E8F0;border-color:#CBD5E1;color:#1E293B}
.aq .btn.draft:hover:not(:disabled){background:#CBD5E1}
/* "More Options" (Specifications, incl. Online Search & Web Address): open / close smoothly */
.aq .more{grid-column:1/-1;display:flex;flex-direction:column}
.aq .moreb{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border-radius:8px;border:1px solid #BFD3FE;background:#EFF6FF;color:#1D4ED8;font-weight:600;cursor:pointer}
.aq .moreb:hover{background:#DBEAFE}
.aq .moreb:focus-visible{outline:2px solid #2563EB;outline-offset:2px}
.aq .chev{display:inline-block;transition:transform .3s ease}
.aq .chev.up{transform:rotate(180deg)}
.aq .aq-collapse{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;transition:grid-template-rows .3s ease,opacity .3s ease,visibility 0s linear .3s}
.aq .aq-collapse.on{grid-template-rows:1fr;opacity:1;visibility:visible;transition:grid-template-rows .3s ease,opacity .3s ease,visibility 0s}
.aq .aq-collapse>div{min-height:0;overflow:hidden}
/* Add Manually: VIN box + Decode VIN on one row; the "N fields filled" summary under it */
.aq .vinrow{display:flex;gap:10px;align-items:stretch}
.aq .vinrow .fld{flex:1 1 auto;min-width:0}
.aq .vinrow .btn{min-height:44px}
.aq .filled-line{font-size:13.5px;font-weight:600;color:#15803D;padding:2px 2px 0}
.aq .filled{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:10px;background:#E8F7EE;border:1px solid #BBE5CB;color:#14532D;font-size:13.5px}
/* VIN box: one normal line, the Scan icon inside its right end (like "mi" in Mileage) */
.aq .fld.vinfld{min-height:44px;height:44px}
.aq .fld.vinfld input{padding-right:4px}
.aq .inscan{display:flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;border:0;border-left:1px solid #E2E8F0;background:transparent;color:#1D4ED8;cursor:pointer}
.aq .inscan:hover{background:#EFF6FF}
.aq .inscan:focus-visible{outline:2px solid #2563EB;outline-offset:-2px}
.aq .inscan svg{width:20px;height:20px}
/* phones: two fields per row (AQ_CSS), wide controls on their own row; labels, (i) and badges kept compact */
@media (max-width:640px){
.aq .grid{gap:14px 10px}
.aq .f.mfull{grid-column:1/-1}
.aq .lbl .opt{display:none}
.aq .lr{column-gap:3px;row-gap:2px}
.aq .lr .lbl{font-size:12px;line-height:1.25}
.aq .fld input,.aq .fld select{padding:0 10px}
.aq .fld.vinfld input{padding:0 4px 0 10px;font-size:15px;letter-spacing:.02em}
.aq .vinrow{gap:8px}
.aq .vinrow .btn{padding:0 12px;font-size:14px}
}
@media (max-width:767px){
.aq .top{padding:12px 16px;gap:10px}
.aq .top h1{font-size:20px}
.aq .top p{display:none}
.aq .f,.aq .card{scroll-margin-top:12px}
.aq .modal{align-items:flex-end;padding:12px}
}
`;
/** form fields that are the answers of "Only you can answer these" (kept in step both ways) */
const YOU_KEYS: Record<string, keyof You> = { price: 'price', condition: 'condition', owners: 'owners', accidents: 'accidents' };
/** where a value came from, for the "decoded" summary */
const FILLED_BY: Record<string, string> = { vin: 'VIN', ai: 'AI', unsure: 'AI' };

const lines = (s: string) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function NoteBox({ n }: { n: Note }) {
  return (
    <div className={`note n-${n.kind}`}>
      <span>{n.icon}</span>
      <span style={{ flex: 1 }}>{n.html}</span>
    </div>
  );
}
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="tip">
      <button type="button" className="tipb" aria-label={`What is ${label}?`}>
        ⓘ
      </button>
      <span role="tooltip" className="tipx">
        {children}
      </span>
    </span>
  );
}

/* ======================= photo strip (drag, ◀ ▶, ★, ×) ======================= */
/**
 * Mouse: drag any photo. Touch: drag a photo by its grip (⠿), the rest of the strip still scrolls the page.
 * The first photo is the Cover Photo (website, CarGurus, Facebook); drop a photo on the first spot to make it the cover.
 */
function Thumbs({ photos, onChange }: { photos: Photo[]; onChange: (p: Photo[]) => void }) {
  const n = photos.length;
  const sort = usePhotoSort(photos, onChange);
  const sd = sort.drag;
  const move = (i: number, j: number) => {
    if (j < 0 || j >= n) return;
    const a = photos.slice();
    [a[i], a[j]] = [a[j], a[i]];
    onChange(a);
  };
  return (
    <>
      <div className="thumbs" role="list" aria-label="Photos, first photo is the cover">
        {photos.map((p, i) => {
          const target = !!sd && sd.to === i && sd.from !== i;
          return (
            <div
              key={p.id}
              {...sort.tileProps(i)}
              role="listitem"
              aria-label={`Photo ${i + 1}${i === 0 ? ' (cover photo)' : ''}`}
              className={`th${i === 0 ? ' cover' : ''}${sd?.from === i ? ' drag' : ''}${target ? ` over ${sd && sd.from > i ? 'before' : 'after'}` : ''}${sd && i === 0 && sd.from !== 0 ? ' slot' : ''}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Photo ${i + 1}`} draggable={false} />
              {i === 0 ? <span className="n cv">★ Cover Photo</span> : <span className="n">{i + 1}</span>}
              {sd && i === 0 && sd.from !== 0 && <span className="slotx">{target ? 'Drop: new cover' : 'Drop here for cover'}</span>}
              <span className="grip" {...sort.handleProps(i)} title="Drag to reorder" aria-hidden>
                ⠿
              </span>
              {p.angle && (
                <span className="ang">
                  {ANGLE_LABEL[p.angle] || p.angle}
                  {p.quality && p.quality <= 2 ? ' · blurry?' : ''}
                </span>
              )}
              <span className="tb">
                {i > 0 && (
                  <button type="button" onClick={() => move(i, i - 1)} aria-label={`Move photo ${i + 1} left`}>
                    ◀
                  </button>
                )}
                {i < n - 1 && (
                  <button type="button" onClick={() => move(i, i + 1)} aria-label={`Move photo ${i + 1} right`}>
                    ▶
                  </button>
                )}
              </span>
              {i > 0 && (
                <button type="button" className="c" title="Make cover photo" aria-label={`Make photo ${i + 1} the cover photo`} onClick={() => onChange([p, ...photos.filter((x) => x.id !== p.id)])}>
                  ★
                </button>
              )}
              <button
                type="button"
                className="x"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => {
                  URL.revokeObjectURL(p.url);
                  onChange(photos.filter((x) => x.id !== p.id));
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {sd && sort.ghostStyle && (
        <div style={sort.ghostStyle} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {sd.src && <img src={sd.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>
      )}
    </>
  );
}

/* ================================ page ================================ */
export default function AiAddVehiclePage() {
  const router = useRouter();
  const toast = useToast();
  const { tenant } = useTenant();
  const dealer = tenant?.name || 'our dealership';
  // phones: the field being typed in is scrolled into the middle of the space above the keyboard
  const rootRef = useRef<HTMLDivElement>(null);
  useMobileFormFocus(rootRef);

  const [status, setStatus] = useState<AiStatus | null>(null);
  const [mode, _setMode] = useState<Mode>('photos');
  const modeRef = useRef<Mode>(mode);
  /** false until ?mode= has been read: the VIN / photo / mode parts wait for it, so the wrong layout never flashes */
  const [modeReady, setModeReady] = useState(false);

  // VIN
  const [vin, setVin] = useState('');
  const vinRef = useRef('');
  const [vinHint, setVinHint] = useState<{ text: string; color: string }>({ text: AUTO_HINT, color: '#526077' });
  const [vinBusy, setVinBusy] = useState(false);
  const [decoded, _setDecoded] = useState<Decoded | null>(null);
  const decodedRef = useRef<Decoded | null>(null);
  /** the VIN the current decoded record belongs to */
  const decodedVin = useRef('');
  const [vinNotes, setVinNotes] = useState<Note[]>([]);

  // photos
  const [photos, _setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef<Photo[]>([]);
  const manualOrder = useRef(false);
  const sentIds = useRef<number[]>([]);
  /** which photo box a file is dragged over (the box at the top, or its copy above Publish) */
  const [dropOver, setDropOver] = useState<'' | 'top' | 'bottom'>('');
  /** "More Options" in Specifications (with the Online Search & Web Address fields): closed by default */
  const [moreOpen, setMoreOpen] = useState(false);

  // AI
  const [ai, _setAi] = useState<any>(null);
  const aiRef = useRef<any>(null);
  const [aiState, _setAiState] = useState<AiState>('idle');
  const aiStateRef = useRef<AiState>('idle');
  const [aiErr, setAiErr] = useState('');
  const [aiMs, setAiMs] = useState(0);
  const aiVer = useRef(0);
  const lastRun = useRef('');

  // video
  const vid = useRef<Vid | null>(null);
  const [vsteps, setVsteps] = useState<Record<string, { st: string; text?: string }>>({});
  const [vNotes, setVNotes] = useState<Note[]>([]);
  const [vDone, setVDone] = useState(false);
  const [vDrop, setVDrop] = useState(false);

  // only you
  const [you, setYou] = useState<You>({ price: '', condition: 'Used', owners: '', accidents: '', notes: '' });
  const youRef = useRef(you);
  youRef.current = you;

  // results
  const [res, setRes] = useState<Res>({ v: {}, src: {}, ev: {}, ok: {} });
  const [rewriting, setRewriting] = useState(false);
  const [saving, setSaving] = useState('');
  const [fbVehicle, setFbVehicle] = useState<any>(null);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  /** photo id → its address on the server (uploaded once), and the photo list sent with the last save */
  const uploadedRef = useRef<Map<number, string>>(new Map());
  const sentImages = useRef<string[]>([]);
  // same VIN already in the inventory or sold: shown at once and saving is blocked (the API refuses it too)
  const [dup, setDup] = useState<VinDup | null>(null);
  /** another published vehicle already uses this stock number: publishing is blocked */
  const [stockDup, setStockDup] = useState<StockDup | null>(null);
  // the full form: always open in Photos & VIN (the default); with a video as soon as the VIN is decoded or AI has
  // read the video (or on request without a lookup)
  const [formOpen, setFormOpen] = useState(true);
  // fields the dealer changed in the form: kept when the VIN / AI values arrive later
  const touched = useRef<Set<string>>(new Set());

  const setPhotos = useCallback((p: Photo[]) => {
    photosRef.current = p;
    _setPhotos(p);
  }, []);
  const setAi = (a: any) => {
    aiRef.current = a;
    _setAi(a);
  };
  const setAiState = (s: AiState) => {
    aiStateRef.current = s;
    _setAiState(s);
  };
  const setDecoded = (d: Decoded | null) => {
    decodedRef.current = d;
    _setDecoded(d);
  };

  useEffect(() => {
    aiApi<AiStatus>('status').then(setStatus).catch(() => setStatus({ hasKey: false, provider: '', model: '', video: false, voice: false }));
  }, []);
  // keep the page from being left by accident while work is on it
  useEffect(() => {
    if (!vin && !photos.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [vin, photos.length]);

  /* ---------------- VIN ---------------- */
  const onVin = (raw: string) => {
    const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);
    setVin(v);
    vinRef.current = v;
    if (/[IOQ]/.test(v)) {
      setVinHint({ text: 'A VIN never contains I, O or Q. These are usually 1 or 0.', color: '#B91C1C' });
      return;
    }
    const manual = modeRef.current === 'manual';
    if (v.length < 17) {
      setVinHint({ text: manual ? MANUAL_HINT : AUTO_HINT, color: '#526077' });
      if (decodedRef.current) {
        setDecoded(null);
        setVinNotes([]);
      }
      return;
    }
    if (manual) {
      // Add Manually: looked up when the dealer clicks Decode VIN; a changed VIN drops the old record
      if (decodedRef.current && decodedVin.current !== v) {
        setDecoded(null);
        setVinNotes([]);
      }
      setVinHint(
        !vinOk(v)
          ? { text: 'Check this VIN: the 9th character doesn’t match the rest, which usually means a typo. You can still decode it.', color: '#92400E' }
          : decodedRef.current
            ? { text: '', color: '#526077' }
            : { text: 'Click Decode VIN to fill in the form below.', color: '#1D4ED8' },
      );
      return;
    }
    if (!vinOk(v)) setVinHint({ text: 'Check this VIN: the 9th character doesn’t match the rest, which usually means a typo. Looking it up anyway…', color: '#92400E' });
    else setVinHint({ text: 'Looking up…', color: '#526077' });
    void lookupVin(v);
  };

  const lookupVin = async (v: string) => {
    setVinBusy(true);
    setVinNotes([]);
    try {
      const d = await aiApi<Decoded>('decode-vin', { vin: v });
      if (vinRef.current !== v) return;
      const f = d.fields;
      if (!f.make || !f.year) {
        setDecoded(null);
        setVinNotes([{ kind: 'bad', icon: '⚠', html: <><b>We couldn’t find this VIN.</b> {(d.warnings || []).join(' ') || 'Check each character and try again.'}</> }]);
        return;
      }
      const notes: Note[] = [];
      if (!d.clean && d.warnings.length) notes.push({ kind: 'warn', icon: '⚠', html: <><b>The database flagged this VIN:</b> {d.warnings.join(' ')}</> });
      // no vehicle summary line here: the decoded fields are listed in the "fields decoded" card below
      setVinNotes(notes);
      setVinHint({ text: '', color: '#526077' });
      decodedVin.current = v;
      setDecoded(d);
      if (modeRef.current === 'video') await videoAfterVin(d);
    } catch (e) {
      if (vinRef.current === v) setVinNotes([{ kind: 'bad', icon: '⚠', html: (e as Error).message }]);
    } finally {
      setVinBusy(false);
    }
  };

  /** "Scan VIN" camera scanner: a scanned VIN fills the VIN box and is decoded (Photos & VIN looks itself up) */
  const [scanOpen, setScanOpen] = useState(false);
  const onScanned = (v: string) => {
    onVin(v);
    if (modeRef.current === 'manual' && !/[IOQ]/.test(v)) void lookupVin(v);
  };
  /** Add Manually: the Decode VIN button (and Enter in the VIN box) */
  const decodeNow = () => {
    const v = vinRef.current;
    if (v.length !== 17) {
      setVinHint({ text: `A VIN has 17 characters; this one has ${v.length}.`, color: '#B91C1C' });
      return;
    }
    if (/[IOQ]/.test(v)) {
      setVinHint({ text: 'A VIN never contains I, O or Q. These are usually 1 or 0.', color: '#B91C1C' });
      return;
    }
    if (!vinBusy) void lookupVin(v);
  };
  const scanBtn = (
    <button type="button" className="inscan" onClick={() => setScanOpen(true)} title="Scan VIN" aria-label="Scan VIN">
      <ScanLine aria-hidden="true" />
    </button>
  );

  /* ---------------- photos + AI (starts by itself) ---------------- */
  /**
   * A picture this browser can read is used as it is. HEIC / AVIF / BMP … that it cannot read are converted by the
   * server first (it stores every vehicle photo as .jpeg anyway) and the .jpeg is used for the preview and the AI.
   */
  const readPhoto = async (f: File): Promise<Photo | null> => {
    try {
      return await shrink(f, f.name);
    } catch {
      /* not readable here: let the server convert it */
    }
    try {
      const [u] = await uploadFiles([f]);
      const res = await fetch(mediaUrl(u));
      if (!res.ok) return null;
      return await shrink(await res.blob(), f.name);
    } catch {
      return null;
    }
  };
  const addFiles = async (list: FileList | File[]) => {
    // HEIC / HEIF files often come without a type on Windows: their name decides
    const files = Array.from(list).filter((f) => f.type.startsWith('image/') || /\.(heic|heif|avif|webp|bmp)$/i.test(f.name));
    if (!files.length) return;
    const done = await Promise.all(files.map((f) => readPhoto(f)));
    const ok = done.filter(Boolean) as Photo[];
    if (ok.length < files.length) toast.error(`${files.length - ok.length} file(s) couldn’t be read as pictures.`);
    manualOrder.current = false;
    setPhotos([...photosRef.current, ...ok]);
  };
  const changePhotos = (p: Photo[]) => {
    manualOrder.current = true;
    setPhotos(p);
  };

  const photoKey = useMemo(() => photos.map((p) => p.id).sort((a, b) => a - b).join(','), [photos]);

  const runAI = useCallback(async () => {
    const d = decodedRef.current;
    if (!d) return;
    const ver = ++aiVer.current;
    const key = `${vinRef.current}|${photosRef.current.map((p) => p.id).sort((a, b) => a - b).join(',')}`;
    setAiState('running');
    setAiErr('');
    const sent = photosRef.current.slice(0, 40);
    sentIds.current = sent.map((p) => p.id);
    const t0 = performance.now();
    try {
      const f = d.fields;
      const r = await aiApi<{ findings: any }>('analyze', {
        vehicle: { year: f.year, make: f.make, model: f.model, trim: f.trim, body: f.body },
        images: sent.map((p) => ({ media_type: 'image/jpeg', data: p.data })),
      });
      if (ver !== aiVer.current) return;
      const labels = new Map<number, { angle: string; quality: number }>();
      (r.findings.photos || []).forEach((x: { n: number; angle: string; quality: number }) => {
        const p = sent[x.n - 1];
        if (p) labels.set(p.id, x);
      });
      let next = photosRef.current.map((p) => (labels.has(p.id) ? { ...p, angle: labels.get(p.id)!.angle, quality: labels.get(p.id)!.quality } : p));
      const coverP = r.findings.best_cover_photo ? sent[r.findings.best_cover_photo - 1] : null;
      if (!manualOrder.current) next = arrangePhotos(next, coverP ? coverP.id : null);
      setPhotos(next);
      setAi(r.findings);
      setAiMs(Math.round(performance.now() - t0));
      setAiState('done');
      lastRun.current = key;
    } catch (e) {
      if (ver !== aiVer.current) return;
      setAiState('error');
      setAiErr((e as Error).message);
    }
  }, [setPhotos]);

  useEffect(() => {
    if (mode !== 'photos') return; // Add Manually: AI does not read the photos · video: they come from the video
    if (!decoded || !photos.length) {
      aiVer.current++;
      setAiState('idle');
      setAi(null);
      lastRun.current = '';
      return;
    }
    if (lastRun.current === `${vinRef.current}|${photoKey}` && aiStateRef.current === 'done') return;
    setAiState('waiting');
    const t = setTimeout(() => void runAI(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, photoKey, mode]);

  /* ---------------- mode ---------------- */
  const setMode = (m: Mode) => {
    if (mode === m) return;
    // a walkaround video brings its own photos: the photos (and edits) of the other way are dropped
    modeRef.current = m;
    _setMode(m);
    aiVer.current++;
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    touched.current.clear();
    setAi(null);
    setAiState('idle');
    setAiErr('');
    setVsteps({});
    setVNotes([]);
    setVDone(false);
    lastRun.current = '';
    // Photos & VIN: the full form is always open (fill it in by hand, or let the VIN / photos fill it)
    setFormOpen(m === 'photos' || !!decodedRef.current);
    const v = vinRef.current;
    if (v.length < 17) setVinHint({ text: AUTO_HINT, color: '#526077' });
    else if (!decodedRef.current && !/[IOQ]/.test(v)) void lookupVin(v);
  };
  // ?mode=manual: Add Manually (no mode cards) · ?mode=video: Walkaround Video · otherwise Photos & VIN
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mode');
    if (m === 'manual' || m === 'video') {
      modeRef.current = m;
      _setMode(m);
      if (m === 'video') setFormOpen(false);
      else setVinHint({ text: MANUAL_HINT, color: '#526077' });
    }
    setModeReady(true);
  }, []);

  /* ---------------- walkaround video ---------------- */
  const vstep = (key: string, st: string, text?: string) => setVsteps((s) => ({ ...s, [key]: { st, text: text ?? s[key]?.text } }));

  const analyzeVideoInParts = async (audio: string) => {
    const v = vid.current!;
    const size = 10;
    const parts: { off: number; frames: Vid['frames'] }[] = [];
    for (let i = 0; i < v.frames.length; i += size) parts.push({ off: i, frames: v.frames.slice(i, i + size) });
    let done = 0;
    const one = async (p: (typeof parts)[number], k: number) => {
      const body = { frames: p.frames.map((f) => ({ data: f.data })), audio: k === 0 ? audio : '' };
      for (let tryN = 0; tryN < 2; tryN++) {
        try {
          const r = await aiApi('analyze-video', body);
          vstep('ai', 'run', `AI is reading the video (${++done} of ${parts.length} parts done)`);
          return r;
        } catch (e) {
          if (tryN === 1 || /limit|sign in|not set up/i.test((e as Error).message)) throw e;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    };
    vstep('ai', 'run', `AI is reading the video (0 of ${parts.length} parts done)`);
    const out = await Promise.allSettled(parts.map(one));
    const ok = out.map((x, k) => (x.status === 'fulfilled' && x.value ? { r: x.value, off: parts[k].off } : null)).filter(Boolean) as { r: any; off: number }[];
    if (!ok.length) throw (out[0] as PromiseRejectedResult).reason;
    return { findings: mergeVideo(ok), missed: out.length - ok.length };
  };

  const readCloseups = async () => {
    const v = vid.current!;
    const a = aiRef.current;
    const fr: { n: number; angle: string; quality: number }[] = a.frames || [];
    const byAngle = (g: string) => fr.filter((x) => x.angle === g).sort((p, q) => q.quality - p.quality).map((x) => x.n);
    const vinN = [...new Set([...(a.vin_frames || []), ...byAngle('vin_label'), ...byAngle('document')])].slice(0, 2);
    const odoN = [...new Set([...(a.odometer_frames || []), ...byAngle('odometer'), ...byAngle('dashboard')])].slice(0, 2);
    const imgs: { kind: string; data: string }[] = [];
    for (const n of vinN) {
      const f = v.frames[n - 1];
      if (f) imgs.push({ kind: 'VIN sticker', data: (await bigFrame(v, f.t, 1800, 0.92)).data });
    }
    for (const n of odoN) {
      const f = v.frames[n - 1];
      if (f) imgs.push({ kind: 'instrument cluster / odometer', data: (await bigFrame(v, f.t, 1800, 0.92)).data });
    }
    if (!imgs.length) return null;
    return aiApi('read-closeups', { images: imgs.slice(0, 4) });
  };

  /** at least 15 photos from different sides, sharpest moment of each, then arranged */
  const videoPhotos = async () => {
    const v = vid.current!;
    const fr = ((aiRef.current.frames || []) as { n: number; angle: string; quality: number }[]).filter((x) => v.frames[x.n - 1] && !['vin_label', 'document'].includes(x.angle));
    const tOf = (x: { n: number }) => v.frames[x.n - 1].t;
    const picked: { n: number; angle: string; quality: number }[] = [];
    const far = (x: { n: number }, gap: number) => picked.every((p) => Math.abs(tOf(p) - tOf(x)) >= gap);
    const groups: Record<string, typeof fr> = {};
    fr.forEach((x) => (groups[x.angle] = groups[x.angle] || []).push(x));
    ANGLE_ORDER.forEach((g) => {
      const list = (groups[g] || []).sort((p, q) => q.quality - p.quality);
      if (list[0] && list[0].quality >= 2) picked.push(list[0]);
    });
    const target = Math.max(15, Math.min(20, picked.length + 6));
    const rest = fr.filter((x) => !picked.includes(x)).sort((p, q) => q.quality - p.quality);
    for (const gap of [2, 1, 0])
      for (const x of rest) {
        if (picked.length >= target) break;
        if (!picked.includes(x) && x.quality >= (gap ? 3 : 1) && far(x, gap)) picked.push(x);
      }
    if (picked.length < 15)
      v.frames.forEach((_, i) => {
        if (picked.length < 15 && !picked.some((p) => p.n === i + 1)) picked.push({ n: i + 1, angle: 'other', quality: 3 });
      });
    const out: Photo[] = [];
    let k = 0;
    for (const x of picked) {
      vstep('photos', 'run', `Choosing the sharpest photos (${++k} of ${picked.length})`);
      const f = v.frames[x.n - 1];
      const b = await bigFrame(v, f.t, 1600, 0.88, true);
      out.push({ id: nextPhotoId(), url: URL.createObjectURL(b.blob), file: b.blob, data: f.data, t: f.t, angle: x.angle, quality: x.quality });
    }
    manualOrder.current = false;
    setPhotos(arrangePhotos(out, null));
  };

  const handleVideo = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setVNotes([{ kind: 'bad', icon: '⚠', html: 'That isn’t a video file.' }]);
      return;
    }
    setVsteps({});
    setVNotes([]);
    setVDone(false);
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setAi(null);
    setAiState('running');
    setAiErr('');
    try {
      vstep('read', 'run');
      if (vid.current) URL.revokeObjectURL(vid.current.url);
      vstep('read', 'ok');
      vstep('frames', 'run');
      vid.current = await extractFrames(file, (pct) => vstep('frames', 'run', `Looking through your video (${pct}%)`));
      const v = vid.current;
      vstep('frames', 'ok', `Checked ${v.cands.length} moments of your ${Math.round(v.dur)} s video and kept the ${v.frames.length} sharpest for AI`);
      vstep('audio', 'run');
      const audio = await extractAudio(file, 150);
      vstep(
        'audio',
        audio && (audio.data || audio.silent) ? 'ok' : 'err',
        audio?.data ? 'Got the sound' : audio?.silent ? 'No talking heard (that’s fine)' : 'Couldn’t read the sound (type your notes instead)',
      );
      vstep('ai', 'run');
      const r = await analyzeVideoInParts(audio?.data || '');
      setAi(r.findings);
      vstep('ai', 'ok', `AI read the video${r.missed ? ` (${r.missed} part${r.missed > 1 ? 's' : ''} skipped: AI was busy)` : ''}`);
      // close-ups of the VIN and the odometer go to the AI while the listing photos are chosen
      vstep('close', 'run');
      let clP: Promise<any> = Promise.resolve(null);
      try {
        clP = readCloseups().catch(() => null);
      } catch {
        /* no close-ups */
      }
      vstep('photos', 'run');
      await videoPhotos();
      vstep('photos', 'ok', `${photosRef.current.length} photos chosen and arranged, best cover first`);
      const cl = await clP;
      const a = { ...aiRef.current };
      const v1 = a.vin_in_video || {};
      let found: string | null = null;
      let vinWarn = '';
      if (cl?.vin?.valid) found = cl.vin.value;
      else if (vinOk(v1.value)) found = String(v1.value).toUpperCase();
      else {
        const guess = cl?.vin?.value || v1.value;
        if (guess) {
          found = String(guess).toUpperCase().replace(/[^A-Z0-9]/g, '');
          vinWarn = 'The VIN was hard to read, so one character may be wrong. Please compare it with the sticker.';
        }
      }
      if (cl?.odometer_miles?.value) a.odometer_miles = { value: cl.odometer_miles.value, confidence: cl.odometer_miles.confidence, evidence: 'Close-up of the dashboard in your video' };
      setAi(a);
      const odo = a.odometer_miles?.value;
      vstep('close', found || odo ? 'ok' : 'err', [found ? `VIN read${vinWarn ? ' (please check it)' : ''}` : 'VIN not readable', odo ? 'mileage read' : 'mileage not readable'].join(', '));
      // what the dealer said → the notes box (their own words; they can edit)
      const sn: string[] = a.spoken_notes || [];
      if (sn.length && !youRef.current.notes.trim()) setYou((y) => ({ ...y, notes: `${sn.join('. ')}.` }));
      const notes: Note[] = [
        {
          kind: 'ok',
          icon: '✓',
          html: (
            <>
              <b>Found in your video:</b>{' '}
              {[
                a.seen_vehicle || null,
                found ? 'VIN' : null,
                odo ? `${Number(odo).toLocaleString()} mi` : null,
                a.exterior_color?.value ? `${a.exterior_color.value} paint` : null,
                sn.length ? `${sn.length} spoken note${sn.length > 1 ? 's' : ''}` : null,
                `${photosRef.current.length} photos`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </>
          ),
        },
      ];
      if (vinWarn) notes.push({ kind: 'warn', icon: '⚠', html: vinWarn });
      if (!odo) notes.push({ kind: 'warn', icon: '⚠', html: 'Mileage not read from the video. Please enter it.' });
      setVNotes(notes);
      setVDone(true);
      if (found && found.length === 17) {
        vstep('vin', 'run');
        onVin(found);
      } else {
        vstep('vin', 'err', 'VIN not readable in the video. Please type it below.');
        setAiState('done');
        setTimeout(() => {
          const el = document.getElementById('aq-vin');
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el?.focus();
        }, 100);
      }
    } catch (e) {
      setAiState('error');
      setAiErr((e as Error).message);
      setVsteps((s) => Object.fromEntries(Object.entries(s).map(([k, x]) => [k, x.st === 'run' ? { ...x, st: 'err' } : x])));
      setVNotes([{ kind: 'bad', icon: '⚠', html: (e as Error).message }]);
    }
  };

  /** video: once the VIN is known — compare with what was seen, and write the description */
  const videoAfterVin = async (d: Decoded) => {
    const a = aiRef.current;
    if (!a) return;
    const f = d.fields;
    vstep('vin', 'ok', `VIN found: ${[f.year, f.make, f.model].join(' ')}`);
    const seen = String(a.seen_vehicle || '').toLowerCase();
    const next = { ...a };
    next.vehicle_matches_vin =
      seen && f.make && !seen.includes(f.make.toLowerCase())
        ? { status: 'mismatch', note: `The video looks like a ${a.seen_vehicle}, but the VIN is a ${f.make} ${f.model}.` }
        : { status: 'match', note: '' };
    setAi(next);
    setAiState('running');
    const facts = {
      dealership: dealer, Year: f.year, Make: f.make, Model: f.model, Trim: f.trim, 'Body style': f.body, Engine: f.engine, Drivetrain: f.drive, 'Fuel type': f.fuel,
      'Exterior color': a.exterior_color?.value,
      Transmission: f.trans || a.transmission?.value || '',
      Features: (a.features || []).filter((x: any) => x.confidence !== 'low').map((x: any) => x.name),
    };
    try {
      const r = await aiApi<{ text: string }>('write-description', { facts });
      setAi({ ...aiRef.current, description: r.text });
    } catch {
      setAi({ ...aiRef.current, description: '' });
    }
    setAiState('done');
  };

  /* ---------------- the full form (opens by itself) ---------------- */
  const buildResults = () => {
    const d = decodedRef.current;
    const f: Record<string, string> = d?.fields || {};
    const a = aiRef.current;
    const y = youRef.current;
    const R: Res = { v: {}, src: {}, ev: {}, ok: {} };
    const set = (k: string, val: unknown, src: string, ev?: string) => {
      R.v[k] = val == null ? '' : String(val);
      R.src[k] = R.v[k] ? src : REQUIRED.includes(k) && ['vin', 'ai', 'unsure'].includes(src) ? 'miss' : '';
      if (ev) R.ev[k] = ev;
    };
    const aiSet = (k: string, x: any, fmt?: (v: any) => string) => {
      if (x && x.value != null && x.value !== '') set(k, fmt ? fmt(x.value) : x.value, x.confidence === 'high' ? 'ai' : 'unsure', x.evidence);
      else {
        R.v[k] = '';
        R.src[k] = REQUIRED.includes(k) ? 'miss' : '';
        R.ev[k] = x && x.evidence && x.evidence !== 'not visible' ? x.evidence : 'Not visible in the photos. Please enter it.';
      }
    };
    (['year', 'make', 'model', 'trim', 'vtype', 'body', 'engine', 'hp', 'fuel', 'drive', 'trans', 'doors', 'seats'] as const).forEach((k) => set(k, f[k], 'vin'));
    if (R.v.trim) R.v.trim = R.v.trim.toUpperCase();
    if (R.v.body) R.v.body = normBodyStyle(R.v.body);
    if (R.v.drive) R.v.drive = normDrive(R.v.drive);
    ['trim', 'trans', 'body'].forEach((k) => {
      if (!R.v[k]) R.ev[k] = d ? 'Not in the VIN record. Please choose it.' : 'Please choose it.';
    });
    set('vin', vinRef.current, 'you');
    // the dealer's own stock number: typed in, never generated
    R.v.stock = '';
    R.src.stock = 'miss';
    R.ev.stock = 'Enter your own stock number.';
    set('price', rawPrice(y.price), 'you');
    set('condition', y.condition, 'you');
    set('owners', y.owners, 'you');
    set('accidents', y.accidents, 'you');
    ['fee', 'msrp', 'badge', 'mpg', 'tank'].forEach((k) => set(k, '', ''));
    const vinSafety = d?.safety || [];
    if (a) {
      aiSet('ext', a.exterior_color);
      if (!R.v.trans && a.transmission?.value) aiSet('trans', a.transmission); // the VIN record often leaves it out
      aiSet('mileage', a.odometer_miles, (v) => String(v).replace(/[^0-9]/g, ''));
      const feats = (a.features || []).filter((x: any) => x.confidence !== 'low').map((x: any) => x.name);
      set('options', feats.join('\n'), feats.length ? 'ai' : '', (a.features || []).map((x: any) => `${x.name} (${x.evidence})`).join(' · '));
      const aiSafe: string[] = (a.safety_features || []).filter((x: any) => x.confidence !== 'low').map((x: any) => x.name);
      const safe = vinSafety.slice();
      aiSafe.forEach((n) => {
        if (!safe.some((s) => s.toLowerCase() === n.toLowerCase())) safe.push(n);
      });
      set('safety', safe.join('\n'), aiSafe.length ? 'ai' : safe.length ? 'vin' : '', vinSafety.length ? `${vinSafety.length} from the official VIN record${aiSafe.length ? `, ${aiSafe.length} seen in photos` : ''}` : '');
      set(
        'description',
        (a.description || '') + (y.notes ? ` ${y.notes}` : ''),
        a.description ? 'ai' : 'miss',
        a.description ? `Written from the VIN record and the photos${y.notes ? ', plus your notes' : ''}.` : 'Please write a short description.',
      );
    } else {
      ['ext', 'mileage'].forEach((k) => {
        R.v[k] = '';
        R.src[k] = REQUIRED.includes(k) ? 'miss' : '';
        R.ev[k] = 'No AI reading. Please enter it.';
      });
      set('options', '', '');
      set('safety', vinSafety.join('\n'), vinSafety.length ? 'vin' : '');
      set('description', y.notes || '', y.notes ? 'you' : 'miss', y.notes ? '' : 'Please write a short description.');
    }
    // interior color and interior material (cloth, leather …): never from the VIN record, photos or video —
    // always the dealer's own choice
    R.v.int = '';
    R.src.int = 'miss';
    R.ev.int = 'Choose the interior color yourself. It is never filled in automatically.';
    R.v.itype = '';
    R.src.itype = '';
    R.ev.itype = 'Choose the interior material yourself. It is never filled in automatically.';
    // AI's "Photo 3" refers to the order sent; show the number the photo has now
    if (modeRef.current !== 'video' && sentIds.current.length)
      Object.keys(R.ev).forEach((k) => {
        if (R.ev[k])
          R.ev[k] = String(R.ev[k]).replace(/Photo (\d+)/gi, (m, n) => {
            const id = sentIds.current[Number(n) - 1];
            const i = photosRef.current.findIndex((p) => p.id === id);
            return i >= 0 ? `Photo ${i + 1}` : m;
          });
      });
    const name = [R.v.year, R.v.make, R.v.model, R.v.trim].filter(Boolean).join(' ');
    set('seoTitle', `${name} for sale | ${dealer}`, 'auto');
    set('slug', slugify(name), 'auto');
    // what the dealer already changed in the form stays as they typed it
    setRes((P) => {
      for (const k of touched.current) {
        if (!(k in P.v)) continue;
        R.v[k] = P.v[k];
        R.src[k] = P.src[k];
        if (P.ev[k] !== undefined) R.ev[k] = P.ev[k];
        else delete R.ev[k];
        if (P.ok[k]) R.ok[k] = true;
      }
      return R;
    });
  };

  // open the full form as soon as the VIN is decoded or AI has read the video
  useEffect(() => {
    if (decoded || (mode === 'video' && vDone) || mode !== 'video') setFormOpen(true);
  }, [decoded, vDone, mode]);
  // and keep it filled in: new VIN / AI results and the "Only you" answers flow in (changed fields are kept)
  useEffect(() => {
    if (formOpen) buildResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, decoded, ai, aiState, you]);

  // duplicate VIN (exact, trimmed, upper-case) — the VIN typed at the top, or the one in the form once it is open
  const formVin = normVin(formOpen && touched.current.has('vin') ? res.v.vin : vin);
  useEffect(() => {
    if (formVin.length !== 17) {
      setDup(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => void checkVin(formVin, savedDraft || undefined).then((r) => live && setDup(r)), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [formVin, savedDraft]);
  // duplicate stock number (trimmed, case-insensitive) among the published vehicles: checked while typing
  const stockNow = String(res.v.stock || '').trim();
  useEffect(() => {
    if (!stockNow) {
      setStockDup(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => void checkStock(stockNow, savedDraft || undefined).then((r) => live && setStockDup(r)), 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [stockNow, savedDraft]);

  /* ---------------- results page ---------------- */
  const setField = (k: string, val: string) => {
    // price and history are the "Only you can answer these" answers: one value, shown in both places
    if (YOU_KEYS[k]) setYou((y) => ({ ...y, [YOU_KEYS[k]]: val }));
    else touched.current.add(k);
    setRes((R) => {
      const src = { ...R.src };
      const ev = { ...R.ev };
      const ok = { ...R.ok };
      if (src[k] === 'miss' && val.trim()) {
        src[k] = 'you';
        ev[k] = '';
      }
      if (src[k] === 'unsure') ok[k] = true; // touching it counts as checked
      return { v: { ...R.v, [k]: val }, src, ev, ok };
    });
  };

  /**
   * Mileage and stock number in "Only you can answer these": the same values as in the form below (one value, shown in
   * both places). What the dealer types there is theirs and is kept when AI finishes later.
   */
  const setOwn = (k: 'mileage' | 'stock', val: string) => {
    setField(k, val);
    setRes((R) => ({ ...R, src: { ...R.src, [k]: val.trim() ? 'you' : REQUIRED.includes(k) ? 'miss' : '' }, ev: { ...R.ev, [k]: '' } }));
  };

  const missingReq = (() => {
    const m = REQUIRED.filter((k) => !String(res.v[k] || '').trim());
    if (res.v.vin && res.v.vin.length !== 17 && !m.includes('vin')) m.push('vin');
    if (res.v.price && !(Number(res.v.price) > 0) && !m.includes('price')) m.push('price');
    if (photos.length === 0) m.push('photos');
    return m;
  })();
  const toCheck = Object.keys(res.src).filter((k) => res.src[k] === 'unsure' && !res.ok[k] && res.v[k]);
  const reqTotal = REQUIRED.length + 1;
  const reqDone = reqTotal - missingReq.length;

  const goField = (k: string) => {
    // a field under the closed "More Options" (incl. Online Search & Web Address): open it first, then scroll once it has opened
    const inMore = MORE_KEYS.includes(k) || SEO_KEYS.includes(k);
    const closed = inMore && !moreOpen;
    if (inMore) setMoreOpen(true);
    const go = () => {
      document.getElementById(`f-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => (document.getElementById(`r-${k}`) as HTMLElement | null)?.focus({ preventScroll: true }), 350);
    };
    if (closed) setTimeout(go, 320);
    else go();
  };

  const rewriteDesc = async () => {
    setRewriting(true);
    const facts: Record<string, unknown> = { dealership: dealer };
    ['year', 'make', 'model', 'trim', 'body', 'engine', 'fuel', 'drive', 'trans', 'ext', 'int', 'itype', 'condition', 'owners', 'accidents'].forEach((k) => {
      if (res.v[k]) facts[LABEL[k]] = res.v[k];
    });
    facts.Features = lines(res.v.options);
    facts['Safety features'] = lines(res.v.safety);
    if (you.notes) facts['Dealer notes'] = you.notes;
    try {
      const r = await aiApi<{ text: string }>('write-description', { facts });
      setRes((R) => ({ ...R, v: { ...R.v, description: r.text }, src: { ...R.src, description: 'ai' }, ev: { ...R.ev, description: '' } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRewriting(false);
    }
  };

  const vehicleBody = (st: 'PUBLISHED' | 'DRAFT', images: string[]) => {
    const v = res.v;
    const feats = lines(v.options);
    if (v.itype && !feats.some((x) => x.toLowerCase().includes(v.itype.toLowerCase()))) feats.push(`${v.itype} seats`);
    const body: Record<string, unknown> = {
      status: st,
      year: v.year ? Number(v.year) : null,
      make: v.make, model: v.model, trim: v.trim, vehicleType: v.vtype, bodyStyle: v.body, condition: v.condition || 'Used',
      price: rawPrice(v.price), processingFee: v.fee, msrp: v.msrp, mileage: v.mileage, vin: String(v.vin || '').toUpperCase().trim(), stockNumber: v.stock, dealLabel: v.badge,
      exteriorColor: v.ext, interiorColor: v.int, transmission: v.trans, drivetrain: v.drive, fuelType: v.fuel, engine: v.engine, horsepower: v.hp,
      mpg: v.mpg, fuelTank: v.tank, doors: v.doors, seats: v.seats, owners: v.owners, accidents: v.accidents,
      description: v.description, features: feats, safetyFeatures: lines(v.safety),
      title: [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '), metaTitle: v.seoTitle, images, featured: false,
    };
    if (String(v.slug || '').trim()) body.slug = slugify(v.slug);
    return body;
  };

  /**
   * Uploads the photos that are not on the server yet and returns every photo's address in the order shown
   * (first = cover). Photos uploaded for a draft are not uploaded again, so reordering after "Save as draft" is kept.
   */
  const uploadAll = async () => {
    const list = photosRef.current;
    const todo = list.filter((p) => !uploadedRef.current.has(p.id));
    for (let i = 0; i < todo.length; i += 8) {
      setSaving(`Uploading photos (${Math.min(i + 8, todo.length)} of ${todo.length})…`);
      const chunk = todo.slice(i, i + 8);
      const files = chunk.map((p, k) => (p.file instanceof File ? p.file : new File([p.file], `photo-${i + k + 1}.jpg`, { type: 'image/jpeg' })));
      const urls = await uploadFiles(files);
      chunk.forEach((p, k) => urls[k] && uploadedRef.current.set(p.id, urls[k]));
    }
    return list.map((p) => uploadedRef.current.get(p.id)).filter((u): u is string => !!u);
  };

  const save = async (st: 'PUBLISHED' | 'DRAFT') => {
    // nothing is required to save or publish (no CarGurus checks): the details marked "Needs you" and photos can be
    // added later. Only something to recognise the vehicle by is needed.
    if (!res.v.make && !res.v.model && !res.v.vin) {
      toast.error('Enter at least a make, model or VIN.');
      goField('make');
      return;
    }
    // duplicate VIN: never saved twice (in the inventory or already sold)
    const finalVin = normVin(res.v.vin);
    const again = dup || (finalVin.length === 17 ? await checkVin(finalVin, savedDraft || undefined) : null);
    if (again && again.vehicle.id !== savedDraft) {
      setDup(again);
      toast.error(again.message);
      goField('vin');
      return;
    }
    // duplicate stock number: a published vehicle needs a stock number of its own (drafts may share one)
    if (st === 'PUBLISHED' && stockNow) {
      const taken = stockDup || (await checkStock(stockNow, savedDraft || undefined));
      if (taken) {
        setStockDup(taken);
        toast.error(taken.message);
        goField('stock');
        return;
      }
    }
    try {
      // the photos in the order shown here (drag / ◀ ▶ / ★): the first one is the cover everywhere
      let images: string[] = photosRef.current.length ? await uploadAll() : [];
      if (savedDraft) {
        // a draft was saved already: update it instead of making a second copy. The server may have swapped a photo
        // for its branded copy since then (same position): keep the server's copy of each photo, in the new order.
        setSaving('Saving…');
        const server: string[] = (await api(`/dealer/vehicles/${savedDraft}`)).images || [];
        if (server.length === sentImages.current.length) {
          const copy = new Map(sentImages.current.map((u, k) => [u, server[k]] as [string, string]));
          images = images.map((u) => copy.get(u) || u);
        }
      }
      setSaving(st === 'PUBLISHED' ? 'Publishing…' : 'Saving draft…');
      const body = vehicleBody(st, images);
      const out = savedDraft ? await api(`/dealer/vehicles/${savedDraft}`, { method: 'PATCH', body }) : await api('/dealer/vehicles', { body });
      sentImages.current = images;
      void brandRun(); // the main photo gets the dealer's branding bands (when photo branding is on)
      if (st === 'DRAFT') {
        setSavedDraft(out.id);
        toast.ok('Saved as a draft. It isn’t on your website yet.');
        return;
      }
      toast.ok('Vehicle published');
      if (tenant?.features?.facebook === false) router.push('/dealer/inventory');
      else setFbVehicle({ ...body, ...out });
    } catch (e) {
      const msg = (e as Error).message;
      if (STOCK_TAKEN_RE.test(msg)) {
        setStockDup({ message: msg, vehicle: { id: '', name: '', status: 'PUBLISHED' } });
        goField('stock');
      }
      toast.error(msg);
    } finally {
      setSaving('');
    }
  };

  /* ---------------- decoded summary, save buttons, duplicate VIN ---------------- */
  /** fields filled in by the VIN record or AI (not by the dealer), in form order */
  const decodedKeys = SECTIONS.flatMap((sec) => sec[2].map((f) => f[0])).filter((k) => FILLED_BY[res.src[k]] && String(res.v[k] || '').trim());
  /** Add Manually: what the VIN decode filled in (not what the dealer typed), listed under the VIN */
  const vinKeys = decodedKeys.filter((k) => res.src[k] === 'vin');
  const emptyKeys = SECTIONS.flatMap((sec) => sec[2].map((f) => f[0])).filter((k) => !String(res.v[k] || '').trim());
  const aiBusy = aiState === 'running' || aiState === 'waiting';

  const saveButtons = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <button type="button" className="btn draft" disabled={!!saving || !!dup} onClick={() => void save('DRAFT')}>
        {savedDraft ? 'Update draft' : 'Save as draft'}
      </button>
      <button type="button" className="btn pub" disabled={!!saving || !!dup || !!stockDup} title={dup ? dup.message : stockDup ? stockDup.message : undefined} onClick={() => void save('PUBLISHED')}>
        {saving ? (
          <>
            <span className="spin w" /> {saving}
          </>
        ) : (
          '✓ Publish vehicle'
        )}
      </button>
    </div>
  );

  const dupNote = dup ? (
    <NoteBox
      n={{
        kind: 'bad',
        icon: '⛔',
        html: (
          <>
            <b>{dup.message}</b> {dup.vehicle.name ? `(${dup.vehicle.name}) ` : ''}
            <Link href={`/dealer/inventory/${dup.vehicle.id}`} className="link">
              Open it
            </Link>
          </>
        ),
      }}
    />
  ) : null;

  /* ================================ render ================================ */
  const aiBar = (() => {
    const n = photos.length;
    if (mode === 'manual' || (status && !status.hasKey))
      return n ? <div className="ai-bar" style={{ background: '#F1F5F9', color: '#475569' }}>📷 {n} photo{n > 1 ? 's' : ''}. The first one is the cover; drag, ◀ ▶ or ★ to change the order.</div> : null;
    if (mode === 'video') return n ? <div className="ai-bar" style={{ background: '#F1F5F9', color: '#475569' }}>🎥 {n} photos taken from your video and arranged in the best order. Drag, ◀ ▶ or ★ to change it.</div> : null;
    if (!n) return null;
    if (!decoded) return <div className="ai-bar" style={{ background: '#F1F5F9', color: '#475569' }}>✨ AI will read and arrange the photos as soon as the VIN is found.</div>;
    if (aiState === 'waiting' || aiState === 'running')
      return (
        <div className="ai-bar" style={{ background: '#F1EDFF', color: '#5B3FD6' }}>
          <span className="spin" />
          AI is reading and arranging {n} photo{n > 1 ? 's' : ''}… you can carry on with step 3.
        </div>
      );
    if (aiState === 'error')
      return (
        <div className="note n-bad">
          <span>⚠</span>
          <span>
            {aiErr}{' '}
            <button type="button" className="link" onClick={() => void runAI()}>
              Try again
            </button>
          </span>
        </div>
      );
    if (aiState === 'done' && ai) {
      const m = ai.vehicle_matches_vin || {};
      return (
        <>
          {m.status === 'mismatch' && <NoteBox n={{ kind: 'bad', icon: '⚠', html: <><b>These photos may show a different vehicle than the VIN.</b> {m.note}</> }} />}
          <div className="ai-bar" style={{ background: '#E8F7EE', color: '#15803D' }}>
            ✓ Photos read{manualOrder.current ? '' : ' and arranged (best cover first)'} in {(aiMs / 1000).toFixed(1)} s. Drag, ◀ ▶ or ★ to change the order.
          </div>
          {n > 40 && <NoteBox n={{ kind: 'info', icon: 'ℹ', html: `AI read the first 40 photos; the other ${n - 40} are kept and placed at the end.` }} />}
        </>
      );
    }
    return null;
  })();

  const numMark = (n: number | string, ok: boolean) => <span className={`num${ok ? ' ok' : ''}`}>{ok ? '✓' : n}</span>;

  const fieldBox = (fd: FieldDef) => {
    const [k, label, req, tip, pre, suf, size, kind] = fd;
    const s = res.src[k];
    const val = res.v[k] || '';
    const cls = `fld${s === 'unsure' && !res.ok[k] ? ' unsure' : s === 'miss' ? ' miss' : ''}`;
    let input: React.ReactNode;
    if (OPT[k])
      input = (
        <select id={`r-${k}`} value={val} onChange={(e) => setField(k, e.target.value)}>
          <option value="">Choose…</option>
          {val && !OPT[k].includes(val) && <option>{val}</option>}
          {OPT[k].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    else if (k === 'price') input = <PriceInput id="r-price" value={val} onChange={(raw) => setField('price', raw)} placeholder="" />;
    else if (k === 'trim')
      input = (
        <>
          <input id="r-trim" list="r-trim-list" autoComplete="off" value={val} onChange={(e) => setField('trim', e.target.value)} />
          <datalist id="r-trim-list">
            {trimOptions(res.v.make, res.v.model).map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </>
      );
    else if (kind === 'area') input = <textarea id={`r-${k}`} value={val} onChange={(e) => setField(k, e.target.value)} style={k === 'description' ? undefined : { minHeight: 90 }} />;
    else
      input = (
        <input
          id={`r-${k}`}
          value={val}
          onChange={(e) => setField(k, k === 'vin' ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') : e.target.value)}
          className={k === 'vin' ? 'mono' : undefined}
          maxLength={k === 'vin' ? 17 : undefined}
          inputMode={pre === '$' || suf ? 'decimal' : undefined}
        />
      );
    return (
      <div className={`f${size ? ` ${size}` : ''}`} id={`f-${k}`} key={k}>
        <div className="lr">
          <label className="lbl" htmlFor={`r-${k}`}>
            {label} {req ? <span className="req">*</span> : null}
          </label>
          <Tip label={label}>{tip}</Tip>
        </div>
        <div className={cls}>
          {pre ? <span className="pre">{pre}</span> : null}
          {input}
          {suf ? <span className="suf">{suf}</span> : null}
        </div>
        {k === 'stock' && stockDup && (
          <span className="ev" style={{ color: '#B91C1C', fontWeight: 600 }} role="alert">
            {stockDup.message}
          </span>
        )}
        {k === 'vin' && dup && (
          <span className="ev" style={{ color: '#B91C1C', fontWeight: 600 }} role="alert">
            {dup.message}
          </span>
        )}
        {k === 'description' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn sm" disabled={rewriting || !status?.hasKey} onClick={() => void rewriteDesc()}>
              {rewriting ? (
                <>
                  <span className="spin" /> Writing…
                </>
              ) : (
                '✨ Rewrite with the final details'
              )}
            </button>
            <span className="hint">Uses the details above, including your notes.</span>
          </div>
        )}
      </div>
    );
  };

  /** the photos card: step 2 of Photos & VIN, step 3 of the video (plain wording when AI is off: nothing reads them) */
  const photosCard = (n: number | string, at: 'top' | 'bottom' = 'top') => {
    const manual = mode === 'manual' || (mode === 'photos' && !!status && !status.hasKey);
    return (
                <div className={`card glow${mode === 'video' ? ' vmode' : ''}`} id={at === 'bottom' ? 'aq-photos-bottom' : 'aq-photos'}>
                  {!manual && (
                  <div className="hd">
                    {numMark(n, photos.length > 0)}
                    <div style={{ flex: 1 }}>
                      <h2>{mode === 'video' ? 'Photos From Your Video' : 'Photos'}</h2>
                      <p>AI reads colors, interior, features and the mileage from these.</p>
                    </div>
                  </div>
                  )}
                  <div className="bd">
                    <div
                      className={`drop${dropOver === at ? ' over' : ''}`}
                      onDragEnter={(e) => {
                        if (!e.dataTransfer.types.includes('Files')) return;
                        e.preventDefault();
                        setDropOver(at);
                      }}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes('Files')) return;
                        e.preventDefault();
                        setDropOver(at);
                      }}
                      onDragLeave={() => setDropOver('')}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropOver('');
                        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
                      }}
                    >
                      <b>Drag photos here</b>
                      <span style={{ color: '#526077' }}>or</span>
                      <label className="btn">
                        <input
                          type="file"
                          accept={PHOTO_ACCEPT}
                          multiple
                          className="sr"
                          onChange={(e) => {
                            if (e.target.files) void addFiles(e.target.files);
                            e.target.value = '';
                          }}
                        />
                        Choose photos
                      </label>
                      <span className="hint">{manual ? 'Upload multiple photos at once.' : 'Upload multiple photos at once. AI puts them in the best order.'}</span>
                    </div>
                    <Thumbs photos={photos} onChange={changePhotos} />
                    {aiBar}
                  </div>
                </div>
    );
  };

  const vinCount = (
    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: vin.length === 17 ? '#15803D' : '#526077' }}>{vin.length} / 17</span>
  );

  return (
    <div className="aq" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: AQ_CSS + ENTRY_CSS }} />

      <section>
          <div className="top">
            <div style={{ flex: '1 1 360px' }}>
              <Link href="/dealer/inventory" className="link backlink" aria-label="Back to Inventory">
                <span className="arr" aria-hidden>
                  ←
                </span>
                Inventory
              </Link>
              <h1 style={{ marginTop: 4 }}>Add a vehicle</h1>
              <p>
                {mode === 'manual'
                  ? 'Decode the VIN to fill in the details, then check and complete the form below.'
                  : 'Choose how: Photos & VIN, or one Walkaround Video. The VIN and AI fill in the details; check and complete the form below.'}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              {status && modeReady && mode !== 'manual' && (
                <span className={`chip ${status.hasKey ? 's-ok' : 's-miss'}`} style={{ fontSize: 12, padding: '4px 10px' }} title={status.model}>
                  {status.hasKey ? `✨ AI ready · ${status.model.split(' · ')[0]}` : 'AI is off'}
                </span>
              )}
              {formOpen && modeReady && saveButtons}
            </div>
          </div>
          <div className="wrap">
            <div className="col">
              {/* until ?mode= is read nothing below is drawn: no flash of the AI cards before Add Manually */}
              {modeReady && (
                <>
              {mode !== 'manual' && status && !status.hasKey && (
                <NoteBox
                  n={{
                    kind: 'warn',
                    icon: '⚠',
                    html: (
                      <>
                        <b>AI isn’t switched on for this portal yet.</b> The VIN lookup still works and you can fill in the form below yourself, but photos and videos can’t be read.
                        Ask your platform admin to add the AI key (GEMINI_API_KEY) to the server.
                      </>
                    ),
                  }}
                />
              )}

              {/* Add with AI: Photos & VIN | Walkaround Video (Add Manually has no mode cards) */}
              {mode !== 'manual' && (
              <div className="modes" role="group" aria-label="How do you want to add this vehicle?">
                <button type="button" className={`modeb${mode === 'photos' ? ' on' : ''}`} onClick={() => setMode('photos')}>
                  <span className="ic">📷</span>
                  <span>
                    <b style={{ fontSize: 15 }}>Photos &amp; VIN</b>
                    <br />
                    <span className="hint">Type or scan the VIN, add your photos, check the form below.</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`modeb${mode === 'video' ? ' on' : ''}`}
                  onClick={() => setMode('video')}
                  disabled={!!status && !status.video}
                  title={status && !status.video ? 'Video needs Gemini, OpenRouter or Qwen as the AI.' : undefined}
                >
                  <span className="ic">🎥</span>
                  <span>
                    <b style={{ fontSize: 15 }}>Walkaround Video</b> <span className="chip s-ai">Fastest</span>
                    <br />
                    <span className="hint">Step 1: upload one video. AI finds the VIN, photos, mileage and your notes.</span>
                  </span>
                </button>
              </div>
              )}

              {/* VIDEO */}
              {mode === 'video' && (
                <div className="card">
                  <div className="hd">
                    {numMark(1, vDone)}
                    <div style={{ flex: 1 }}>
                      <h2>Walkaround Video</h2>
                      <p>One short video around and inside the car. We take the photos, VIN and mileage from it.</p>
                    </div>
                  </div>
                  <div className="bd">
                    <div
                      className={`drop${vDrop ? ' over' : ''}`}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setVDrop(true);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setVDrop(true);
                      }}
                      onDragLeave={() => setVDrop(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setVDrop(false);
                        const f = Array.from<File>(e.dataTransfer.files).find((x) => x.type.startsWith('video/'));
                        if (f) void handleVideo(f);
                      }}
                    >
                      <b>Drop the video here</b>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                        <label className="btn p">
                          <input
                            type="file"
                            accept="video/*"
                            capture="environment"
                            className="sr"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (f) void handleVideo(f);
                            }}
                          />
                          🎥 Record video
                        </label>
                        <label className="btn">
                          <input
                            type="file"
                            accept="video/*"
                            className="sr"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (f) void handleVideo(f);
                            }}
                          />
                          Upload a video
                        </label>
                      </div>
                      <span className="hint">On a phone, “Record video” opens the camera. The video stays on your device; only small still pictures and the sound are sent.</span>
                    </div>
                    {Object.keys(vsteps).length > 0 && (
                      <div className="steps">
                        {VSTEPS.map(([k, t]) => {
                          const s = vsteps[k];
                          return (
                            <div key={k} className={`stp ${s?.st || ''}`}>
                              <span className="b">{s?.st === 'run' ? <span className="spin" style={{ width: 12, height: 12 }} /> : s?.st === 'ok' ? '✓' : s?.st === 'err' ? '!' : '•'}</span>
                              <span className="t">{s?.text || t}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {vNotes.map((n, i) => (
                      <NoteBox key={i} n={n} />
                    ))}
                  </div>
                </div>
              )}

              {/* VIN */}
              <div className="card glow">
                {mode !== 'manual' && (
                <div className="hd">
                  {numMark(mode === 'video' ? 2 : 1, !!decoded)}
                  <div style={{ flex: 1 }}>
                    <h2>{mode === 'video' ? 'VIN (Found in Your Video)' : 'VIN'}</h2>
                    <p>
                      {mode === 'video'
                        ? 'Filled in from the sticker in your video. Check it, or type it if it couldn’t be read.'
                        : 'Type or scan it: we look it up in the official US vehicle database and most details fill in from this.'}
                    </p>
                  </div>
                </div>
                )}
                <div className="bd">
                  <div className="f">
                    <div className="lr">
                      <label className="lbl" htmlFor="aq-vin">
                        VIN <span className="req">*</span>
                      </label>
                      <Tip label="the VIN">
                        The 17-character Vehicle Identification Number. Find it at the bottom of the windshield on the driver’s side, or on the driver’s door frame. It never contains I, O or Q.
                      </Tip>
                      {vinCount}
                    </div>
                    {mode === 'manual' ? (
                      <div className="vinrow">
                        <div className="fld vinfld">
                          <input
                            id="aq-vin"
                            className="mono"
                            maxLength={17}
                            autoComplete="off"
                            placeholder=""
                            value={vin}
                            onChange={(e) => onVin(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                decodeNow();
                              }
                            }}
                          />
                          {scanBtn}
                        </div>
                        <button type="button" className="btn p" onClick={decodeNow} disabled={vinBusy || vin.length !== 17}>
                          {vinBusy ? (
                            <>
                              <span className="spin w" /> Decoding…
                            </>
                          ) : decoded ? (
                            'Decode again'
                          ) : (
                            'Decode VIN'
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="fld vinfld">
                        <input id="aq-vin" className="mono" maxLength={17} autoComplete="off" placeholder="" value={vin} onChange={(e) => onVin(e.target.value)} />
                        {mode === 'photos' && scanBtn}
                      </div>
                    )}
                    {vinHint.text && (
                      <span className="hint" style={{ color: vinHint.color }}>
                        {vinHint.text}
                      </span>
                    )}
                  </div>
                  {vinBusy && (
                    <div className="ai-bar" style={{ background: '#EFF6FF', color: '#1E3A8A' }}>
                      <span className="spin" />
                      Looking up the VIN…
                    </div>
                  )}
                  {vinNotes.map((n, i) => (
                    <NoteBox key={i} n={n} />
                  ))}
                  {mode === 'manual' && decoded && !vinBusy && vinKeys.length > 0 && (
                    <div className="filled-line" role="status" aria-live="polite">
                      ✓ {vinKeys.length} field{vinKeys.length === 1 ? '' : 's'} filled — please confirm the details below.
                    </div>
                  )}
                  {dup && dupNote}
                </div>
              </div>

              {/* PHOTOS */}
              {mode !== 'video' || photos.length > 0 ? photosCard(mode === 'video' ? 3 : 2) : null}

              {/* ONLY YOU (Add Manually: these are in the form itself) */}
              {mode !== 'manual' && (
              <div className="card">
                <div className="hd">
                  {numMark(mode === 'video' ? (photos.length ? 4 : 3) : 3, Number(rawPrice(you.price)) > 0 && !!String(res.v.mileage || '').trim() && !!String(res.v.stock || '').trim())}
                  <div style={{ flex: 1 }}>
                    <h2>Only You Can Answer These</h2>
                    <p>Price, stock number and history are never filled in by AI. If AI reads the mileage, check it here.</p>
                  </div>
                </div>
                <div className="bd">
                  <div className="grid">
                    <div className="f">
                      <div className="lr">
                        <label className="lbl" htmlFor="aq-price">
                          Price <span className="req">*</span>
                        </label>
                        <Tip label="Price">The selling price buyers see, in US dollars. Must be more than $0.</Tip>
                      </div>
                      <div className="fld">
                        <span className="pre">$</span>
                        <PriceInput id="aq-price" placeholder="e.g. 17,900" value={you.price} onChange={(raw) => setYou({ ...you, price: raw })} />
                      </div>
                    </div>
                    <div className="f">
                      <div className="lr">
                        <label className="lbl" htmlFor="aq-mileage">
                          Mileage <span className="req">*</span>
                        </label>
                        <Tip label="Mileage">The odometer reading in miles (total miles, not the trip meter).</Tip>
                      </div>
                      <div className="fld">
                        <PriceInput id="aq-mileage" inputMode="numeric" placeholder="e.g. 42,500" value={res.v.mileage || ''} onChange={(raw) => setOwn('mileage', raw.replace(/[^0-9]/g, ''))} />
                        <span className="suf">mi</span>
                      </div>
                      {(res.src.mileage === 'ai' || res.src.mileage === 'unsure') && !!res.v.mileage && (
                        <span className="hint" style={{ color: '#5B3FD6' }}>
                          ✨ Read by AI from the dashboard in your {mode === 'video' ? 'video' : 'photos'}. Please check it.
                        </span>
                      )}
                    </div>
                    <div className="f mfull">
                      <div className="lr">
                        <label className="lbl" htmlFor="aq-stock">
                          Stock number <span className="req">*</span>
                        </label>
                        <Tip label="Stock number">Your own stock number for this vehicle. It is never created automatically.</Tip>
                      </div>
                      <div className="fld">
                        <input id="aq-stock" autoComplete="off" placeholder="e.g. BM-1042" value={res.v.stock || ''} onChange={(e) => setOwn('stock', e.target.value)} />
                      </div>
                      {stockDup && (
                        <span className="ev" style={{ color: '#B91C1C', fontWeight: 600 }} role="alert">
                          {stockDup.message}
                        </span>
                      )}
                    </div>
                    <div className="f mfull">
                      <div className="lr">
                        <span className="lbl">Condition</span>
                        <Tip label="Condition">Whether the vehicle is new or used. Controls which search filter it appears under.</Tip>
                      </div>
                      <div className="seg">
                        {['Used', 'New'].map((x) => (
                          <button key={x} type="button" className={`segb${you.condition === x ? ' on' : ''}`} onClick={() => setYou({ ...you, condition: x })}>
                            {x}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="f">
                      <div className="lr">
                        <label className="lbl" htmlFor="aq-owners">
                          Previous owners <span className="hint opt" style={{ fontWeight: 500 }}>(optional)</span>
                        </label>
                        <Tip label="Previous owners">How many people owned the vehicle before. Check the vehicle history report.</Tip>
                      </div>
                      <div className="fld">
                        <input id="aq-owners" inputMode="numeric" placeholder="e.g. 1" value={you.owners} onChange={(e) => setYou({ ...you, owners: e.target.value.replace(/[^0-9]/g, '') })} />
                      </div>
                    </div>
                    <div className="f">
                      <div className="lr">
                        <label className="lbl" htmlFor="aq-acc">
                          Accidents reported <span className="hint opt" style={{ fontWeight: 500 }}>(optional)</span>
                        </label>
                        <Tip label="Accidents reported">The number of accidents on the vehicle history report. Being honest here builds buyer trust.</Tip>
                      </div>
                      <div className="fld">
                        <input id="aq-acc" inputMode="numeric" placeholder="e.g. 0" value={you.accidents} onChange={(e) => setYou({ ...you, accidents: e.target.value.replace(/[^0-9]/g, '') })} />
                      </div>
                    </div>
                  </div>
                  <div className="f">
                    <div className="lr">
                      <label className="lbl" htmlFor="aq-notes">
                        Anything else you want buyers to know
                      </label>
                      <span className="hint">(optional)</span>
                    </div>
                    <div className="fld">
                      <textarea id="aq-notes" style={{ minHeight: 70 }} placeholder="e.g. Clean title, full service records, new tyres" value={you.notes} onChange={(e) => setYou({ ...you, notes: e.target.value })} />
                    </div>
                    <span className="hint">Only what you write here is shared. AI never adds history details.</span>
                  </div>
                </div>
              </div>
              )}

              {!formOpen && (
                <div className="card" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
                  <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <b>{mode === 'video' ? 'Upload the walkaround video to start' : 'Enter the VIN to start'}</b>
                    <span className="hint">
                      The full vehicle form opens here by itself as soon as {mode === 'video' ? 'AI has read the video' : 'the VIN is decoded'}, already filled in. Nothing to click.
                    </span>
                  </div>
                  <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => setFormOpen(true)}>
                    Fill in the form without a VIN lookup →
                  </button>
                </div>
              )}

              {/* ===================== DECODED FIELDS + THE FULL FORM ===================== */}
              {formOpen && (
                <>
                  {mode !== 'manual' && (
                  <div className="card" id="aq-decoded">
                    <div className="hd">
                      <span className={`num${decodedKeys.length ? ' ok' : ''}`}>{decodedKeys.length ? '✓' : '•'}</span>
                      <div style={{ flex: 1 }}>
                        <h2>
                          {decodedKeys.length} Field{decodedKeys.length === 1 ? '' : 's'} Decoded
                          {aiBusy ? ' · AI is still reading…' : ''}
                        </h2>
                        <p>
                          {decodedKeys.length
                            ? 'Filled in for you from the official VIN record and by AI. Check them in the form below and change any value.'
                            : 'Nothing filled in yet. Fill in the form below.'}{' '}
                          {emptyKeys.length ? `${emptyKeys.length} field${emptyKeys.length === 1 ? '' : 's'} still empty.` : 'Every field has a value.'}
                        </p>
                      </div>
                      {aiBusy && <span className="spin" />}
                    </div>
                    {decodedKeys.length > 0 && (
                      <div className="bd">
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {decodedKeys.map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => goField(k)}
                              title={`${LABEL[k]} — filled in from the ${FILLED_BY[res.src[k]] === 'AI' ? 'photos / video by AI' : 'official VIN record'}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 320, border: '1px solid #E5E9F0', borderRadius: 999, background: '#F8FAFC', padding: '4px 10px', fontSize: 12.5, cursor: 'pointer' }}
                            >
                              <b style={{ color: '#0F172A', whiteSpace: 'nowrap' }}>{LABEL[k]}</b>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  )}
              {mode !== 'manual' && !ai && !aiBusy && status?.hasKey !== false && (aiState === 'error' || photos.length > 0) && (
                    <NoteBox n={{ kind: 'warn', icon: '⚠', html: <><b>AI didn’t read the photos</b>{aiErr ? ` (${aiErr})` : ''}. Colors, interior and mileage need to be filled in by you.</> }} />
                  )}
              {ai?.vehicle_matches_vin?.status === 'mismatch' && (
                <NoteBox n={{ kind: 'bad', icon: '⚠', html: <><b>The photos may show a different vehicle than the VIN.</b> {ai.vehicle_matches_vin.note}</> }} />
              )}
              {ai?.vin_in_photo?.value && String(ai.vin_in_photo.value).replace(/\s/g, '').toUpperCase() !== vin && (
                <NoteBox n={{ kind: 'bad', icon: '⚠', html: <b>A VIN in the photos ({ai.vin_in_photo.value}) doesn’t match the one entered.</b> }} />
              )}
              {SECTIONS.map((sec, si) => {
                const keys = sec[2].map((f) => f[0]);
                const mi = sec[2].filter((f) => f[2] && missingReq.includes(f[0])).length;
                const ck = keys.filter((k) => toCheck.includes(k)).length;
                const isSpecs = sec[0] === 'Specifications';
                // the search fields are shown inside "More Options" of Specifications: no card of their own
                if (sec[0] === SEO_TITLE) return null;
                const seoSec = SECTIONS.find((x) => x[0] === SEO_TITLE);
                const moreFilled = isSpecs ? [...MORE_KEYS, ...SEO_KEYS].filter((k) => String(res.v[k] || '').trim()).length : 0;
                return (
                  <div className="card" key={si}>
                    <div className="hd">
                      {numMark(String.fromCharCode(65 + si), !mi)}
                      <div style={{ flex: 1 }}>
                        <h2>{sec[0]}</h2>
                        {sec[1] ? <p>{sec[1]}</p> : null}
                      </div>
                      <span className={`chip ${mi ? 's-miss' : ck ? 's-unsure' : 's-ok'}`}>{mi ? `${mi} Required` : ck ? `${ck} worth a look` : '✓ Complete'}</span>
                    </div>
                    <div className="bd">
                      {isSpecs ? (
                        <div className="grid">
                          {sec[2].filter((f) => !MORE_KEYS.includes(f[0])).map(fieldBox)}
                          <div className="more">
                            <button type="button" className="moreb" aria-expanded={moreOpen} aria-controls="aq-more-options" onClick={() => setMoreOpen(!moreOpen)}>
                              {moreOpen ? 'Fewer Options' : 'More Options'} <span className={`chev${moreOpen ? ' up' : ''}`} aria-hidden>▾</span>
                              {!moreOpen && moreFilled > 0 && <span className="hint">({moreFilled} filled)</span>}
                            </button>
                            <div id="aq-more-options" className={`aq-collapse${moreOpen ? ' on' : ''}`} aria-hidden={!moreOpen}>
                              <div>
                                <div className="grid" style={{ paddingTop: 14 }}>
                                  {sec[2].filter((f) => MORE_KEYS.includes(f[0])).map(fieldBox)}
                                </div>
                                {seoSec && (
                                  <div className="subsec">
                                    <h3>{seoSec[0]}</h3>
                                    {seoSec[1] ? <p className="hint">{seoSec[1]}</p> : null}
                                    <div className="grid">{seoSec[2].map(fieldBox)}</div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid">{sec[2].map(fieldBox)}</div>
                      )}
                      {si === 3 && ai && (ai.visible_condition_notes || []).length > 0 && (
                        <NoteBox
                          n={{
                            kind: 'warn',
                            icon: '👀',
                            html: (
                              <>
                                <b>AI noticed (not added to the listing; your call):</b>
                                {ai.visible_condition_notes.map((x: { note: string; evidence: string }, i: number) => (
                                  <span key={i}>
                                    <br />
                                    {x.note} <i>({x.evidence})</i>
                                  </span>
                                ))}
                              </>
                            ),
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
                  {/* the same photos again (same photos, same order), so they can be added without scrolling back up */}
                  {(mode !== 'video' || photos.length > 0) && photosCard(mode === 'video' ? 3 : 2, 'bottom')}
                  <div className="card" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
                    <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <b>{dup ? dup.message : stockDup ? stockDup.message : savedDraft ? 'Saved as a draft' : missingReq.length ? `${missingReq.length} Field${missingReq.length > 1 ? 's' : ''} remaining` : 'Ready to publish'}</b>
                      <span className="hint">{dup ? 'Change the VIN to save this vehicle.' : stockDup ? 'Change the stock number to publish this vehicle.' : 'You can publish now and complete any remaining details later.'}</span>
                    </div>
                    {saveButtons}
                  </div>
                </>
              )}
                </>
              )}
            </div>
            {formOpen && modeReady && (
            <aside className="panel">
              <div className="card glow">
                <div className="bd" style={{ gap: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 16 }}>Ready to Publish?</h2>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="hint" style={{ fontSize: 13 }}>
                      Required details
                    </span>
                    <b>
                      {reqDone} of {reqTotal}
                    </b>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: '#E5E9F0', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((reqDone / reqTotal) * 100)}%`, background: missingReq.length ? '#2563EB' : '#16A34A', borderRadius: 999, transition: 'width .25s' }} />
                  </div>
                  {ai && aiMs > 0 && <span className="hint">✨ AI read the {mode === 'video' ? 'video' : 'photos'} in {(aiMs / 1000).toFixed(1)} s</span>}
                </div>
                <div style={{ borderTop: '1px solid #E5E9F0', padding: 12 }}>
                  {!missingReq.length ? (
                    <div className="note n-ok" style={{ margin: 4 }}>
                      <span>✓</span>
                      <span>
                        <b>All required details are filled.</b> You can publish now.
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="hint" style={{ color: '#B91C1C', padding: '4px 8px', fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.08em' }}>
                        {missingReq.length} required field{missingReq.length === 1 ? '' : 's'} remaining
                      </div>
                      {missingReq.map((k) => (
                        <button key={k} type="button" className="miss-item" onClick={() => k !== 'photos' && goField(k)}>
                          <span className="dot" />
                          <span style={{ flex: 1, fontWeight: 500 }}>
                            {LABEL[k] || 'At least one photo'} <span className="req">*</span>
                          </span>
                          <span className="hint">Fill in →</span>
                        </button>
                      ))}
                    </>
                  )}
                  {toCheck.length > 0 && (
                    <>
                      <div className="hint" style={{ color: '#92400E', padding: '10px 8px 4px', fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.08em' }}>
                        Worth a quick look ({toCheck.length})
                      </div>
                      <div className="hint" style={{ padding: '0 8px 6px' }}>
                        AI wasn’t fully sure. Already filled in; change it only if it’s wrong.
                      </div>
                      {toCheck.map((k) => (
                        <button key={k} type="button" className="miss-item" onClick={() => goField(k)}>
                          <span className="dot warn" />
                          <span style={{ flex: 1, fontWeight: 500 }}>{LABEL[k]}</span>
                          <span className="hint">{String(res.v[k]).split('\n')[0].slice(0, 18)}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </aside>
            )}
          </div>
        </section>

      <VinScannerModal open={scanOpen} onClose={() => setScanOpen(false)} onVin={onScanned} aiOn={!!status?.hasKey} />


      <FbPostModal
        vehicle={fbVehicle}
        onClose={() => {
          setFbVehicle(null);
          router.push('/dealer/inventory');
        }}
        intro={
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">✓ Published on your website. Post it on Facebook now?</div>
        }
      />
    </div>
  );
}
