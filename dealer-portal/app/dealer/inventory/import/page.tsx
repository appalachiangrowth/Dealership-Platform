'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, FileText, Pencil, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { CG_IMG_OK, photoExt } from '@/lib/cargurus';
import { brandRun } from '@/lib/branding';
import { useToast } from '@/components/toast';
import { FacebookIcon } from '@/lib/facebook';
import { MP_FIELDS, MP_FIX, MP_REQ_N, mpMissing } from '@/lib/marketplace';
import { Button, Input, LinkButton, cx } from '@/components/ui';
import { money, vehicleName } from '@/lib/format';

/* ================= INVENTORY IMPORT (CSV / TSV / XML) — same flow as the old portal =================
   Reads the file in the browser, matches its columns to vehicle fields, checks every vehicle against the
   CarGurus rules, then adds new vehicles and updates existing ones (matched by VIN, then stock number). */

type Rec = Record<string, string>;
type Parsed = { headers: string[]; records: Rec[] };
type V = Record<string, any>;
type Problem = { f: string; m: string; w?: boolean };
/** ok = CarGurus ready; mp = Marketplace fields this vehicle is missing (empty = Marketplace ready) */
type Row = { row: number; v: V; ex: V | null; by: string; probs: Problem[]; ok: boolean; mp: string[] };

/** [field, label, header names it is found under] */
const IMP_FIELDS: [string, string, string[]][] = [
  ['year', 'Year', ['year', 'modelyear', 'yr']],
  ['make', 'Make', ['make', 'manufacturer', 'brand']],
  ['model', 'Model', ['model', 'modelname']],
  ['trim', 'Trim', ['trim', 'series', 'trimlevel', 'submodel']],
  ['price', 'Price', ['price', 'saleprice', 'internetprice', 'sellingprice', 'askingprice', 'listprice', 'retailprice', 'ourprice']],
  ['mileage', 'Mileage', ['mileage', 'miles', 'odometer', 'km', 'kilometers']],
  ['vin', 'VIN', ['vin', 'vinnumber']],
  ['stockNumber', 'Stock number', ['stock', 'stocknumber', 'stockno', 'stocknum', 'stockid', 'stock#']],
  ['exteriorColor', 'Exterior colour', ['exteriorcolor', 'extcolor', 'exteriorcolour', 'color', 'colour', 'exterior', 'ext']],
  ['interiorColor', 'Interior colour', ['interiorcolor', 'intcolor', 'interiorcolour', 'interior', 'int']],
  ['bodyStyle', 'Body style', ['bodystyle', 'body', 'bodytype']],
  ['vehicleType', 'Type', ['vehicletype', 'type', 'category']],
  ['engine', 'Engine', ['engine', 'enginedescription', 'enginedesc']],
  ['horsepower', 'Horsepower', ['horsepower', 'hp']],
  ['transmission', 'Transmission', ['transmissiontype', 'transmission', 'trans', 'gearbox']],
  ['drivetrain', 'Drivetrain', ['drivetrain', 'drivetype', 'drive']],
  ['fuelType', 'Fuel', ['fueltype', 'fuel']],
  ['mpg', 'MPG', ['mpg', 'fueleconomy']],
  ['fuelTank', 'Tank size', ['fueltanksize', 'tank', 'tanksize']],
  ['doors', 'Doors', ['doors']],
  ['seats', 'Seats', ['seats', 'seating', 'passengercapacity']],
  ['owners', 'Previous owners', ['owners', 'previousowners']],
  ['accidents', 'Accidents', ['accidents']],
  ['condition', 'Condition (new/used)', ['condition', 'newused', 'isnew', 'new']],
  ['certified', 'Certified', ['certified', 'cpo', 'iscertified']],
  ['msrp', 'MSRP', ['msrp']],
  ['dealLabel', 'Deal badge', ['deal', 'deallabel', 'dealbadge']],
  ['description', 'Description', ['description', 'dealercommentsonvehicle', 'dealercomments', 'comments', 'notes', 'remarks', 'vehiclecomments']],
  ['features', 'Installed options', ['features', 'options', 'installedoptions', 'equipment']],
  ['safetyFeatures', 'Installed options (safety)', ['safety', 'safetyfeatures']],
  ['images', 'Photo URLs', ['images', 'imageurls', 'photos', 'photourls', 'pictures', 'imagelist', 'imageurl', 'image', 'mainimage', 'photo', 'photourl']],
  ['status', 'Status', ['status']],
];

/** CarGurus columns the import checks, in CarGurus order: [field, CarGurus name, req | opt] */
const IMP_CG: [string, string, 'req' | 'opt'][] = [
  ['vin', 'VIN', 'req'], ['make', 'Make', 'req'], ['model', 'Model', 'req'], ['year', 'Year', 'req'], ['trim', 'Trim', 'req'], ['price', 'Price', 'req'],
  ['mileage', 'Mileage', 'req'], ['images', 'Image URLs', 'req'], ['exteriorColor', 'Exterior Color', 'req'], ['description', 'Dealer comments on vehicle', 'req'],
  ['stockNumber', 'Stock Number', 'req'], ['transmission', 'Transmission Type', 'req'], ['features', 'Installed Options', 'opt'],
];
const CG_REQ_N = IMP_CG.filter((c) => c[2] === 'req').length; // 12 mandatory CarGurus fields
/** CarGurus name → field (for "Fix") */
const IMP_FIX: Record<string, string> = Object.fromEntries(IMP_CG.filter((c) => c[2] === 'req').map((c) => [c[1], c[0]]));
const STATUS_TXT: Record<string, string> = { PUBLISHED: 'for sale', DRAFT: 'draft', SOLD: 'sold' };
/** Dealer columns of a CarGurus file — filled in from your Business details automatically, so not kept per vehicle. */
const DEALER_COLS = new Set(['dealerid', 'dealername', 'dealerstreetaddress', 'dealercity', 'dealerstate', 'dealerzip', 'dealercrmemail']);
const CG_FIELDS = new Set(IMP_CG.map((c) => c[0]));

const impNorm = (h: string) => String(h || '').toLowerCase().replace(/[^a-z0-9#]/g, '');
const impGuess = (h: string) => IMP_FIELDS.find((f) => f[2].includes(impNorm(h)))?.[0] || '';
/** Columns of the file that are not one of the CarGurus columns: kept with each vehicle and added to the CarGurus master CSV. */
const extraColumns = (headers: string[], map: Record<string, string>) =>
  headers.filter((h) => !(map[h] && CG_FIELDS.has(map[h])) && !DEALER_COLS.has(impNorm(h))).slice(0, 60);

function parseDelimited(text: string, sep: string): Parsed {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
      continue;
    }
    if (c === '"' && cur === '') {
      q = true;
      continue;
    }
    if (c === sep) {
      row.push(cur);
      cur = '';
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, records: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()]))) };
}

function parseXml(text: string): Parsed {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This XML file could not be read. Check that it is a valid XML file.');
  const root = doc.documentElement;
  let recs: Element[] | null = null;
  for (const t of ['vehicle', 'Vehicle', 'listing', 'Listing', 'car', 'item', 'row', 'record']) {
    const l = root.getElementsByTagName(t);
    if (l.length) {
      recs = Array.from(l);
      break;
    }
  }
  if (!recs) {
    // fallback: the most repeated element name that has child elements
    const count: Record<string, number> = {};
    for (const e of Array.from(root.getElementsByTagName('*'))) if (e.children.length) count[e.tagName] = (count[e.tagName] || 0) + 1;
    const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    recs = best ? Array.from(root.getElementsByTagName(best)) : [];
  }
  const headers: string[] = [];
  const seen: Record<string, 1> = {};
  const records = recs.map((el) => {
    const o: Rec = {};
    for (const a of Array.from(el.attributes)) o[a.name] = a.value;
    for (const ch of Array.from(el.children)) {
      const val = ch.children.length ? Array.from(ch.children).map((x) => (x.textContent || '').trim()).filter(Boolean).join(' | ') : (ch.textContent || '').trim();
      o[ch.tagName] = o[ch.tagName] ? `${o[ch.tagName]} | ${val}` : val;
    }
    for (const k of Object.keys(o))
      if (!seen[k]) {
        seen[k] = 1;
        headers.push(k);
      }
    return o;
  });
  return { headers, records };
}

function parseInventoryFile(name: string, text: string): Parsed {
  if (/\.xml$/i.test(name) || /^\s*</.test(text)) return parseXml(text);
  const first = text.split(/\r?\n/)[0] || '';
  const counts: Record<string, number> = { '\t': first.split('\t').length, ',': first.split(',').length, ';': first.split(';').length };
  const sep = /\.tsv$/i.test(name) ? '\t' : Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return parseDelimited(text, sep);
}

const impNum = (v: string) => {
  const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? '' : n;
};
function impList(v: string, urls?: boolean): string[] {
  v = String(v || '').trim();
  if (!v) return [];
  if (urls) return v.match(/https?:\/\/[^\s|,;"'<>]+/g) || [];
  const parts = /[|;\n]/.test(v) ? v.split(/\s*[|;\n]\s*/) : v.split(/\s*,\s*/);
  return parts.map((x) => x.trim()).filter(Boolean);
}
function impVehicle(rec: Rec, map: Record<string, string>): V {
  const v: V = {};
  let imgs: string[] = [];
  for (const col of Object.keys(map)) {
    const f = map[col];
    let raw = rec[col];
    if (!f || raw == null || String(raw).trim() === '') continue;
    raw = String(raw).trim();
    if (f === 'images') imgs = imgs.concat(impList(raw, true));
    else if (f === 'features' || f === 'safetyFeatures') v[f] = (v[f] || []).concat(impList(raw));
    else if (f === 'price' || f === 'msrp') v[f] = impNum(raw);
    else if (f === 'mileage') {
      const m = impNum(raw);
      v.mileage = m === '' ? '' : Math.round(m);
    } else if (f === 'year') v.year = parseInt(raw, 10) || '';
    else if (f === 'condition') v.condition = /^(new|1|true|yes|y)$/i.test(raw) ? 'New' : 'Used';
    else if (f === 'certified') v.certified = /^(1|true|yes|y|certified|cpo)$/i.test(raw);
    else if (f === 'status') {
      const s = raw.toLowerCase();
      v.status = /draft|hidden|inactive/.test(s) ? 'DRAFT' : /sold/.test(s) ? 'SOLD' : 'PUBLISHED';
    } else if (f === 'vin') v.vin = raw.toUpperCase().replace(/\s+/g, '');
    else v[f] = raw;
  }
  if (imgs.length) v.images = imgs.filter((u, i, a) => a.indexOf(u) === i);
  return v;
}

/** every problem of one vehicle, in plain words */
function impProblems(v: V, rec: Rec, cols: Record<string, string>, seen: { vin: Record<string, number>; stock: Record<string, number> }, row: number): Problem[] {
  const P: Problem[] = [];
  const add = (f: string, m: string, w?: boolean) => P.push({ f, m, w: !!w });
  const raw = (f: string) => (cols[f] ? String(rec[cols[f]] || '').trim() : '');
  const maxY = new Date().getFullYear() + 1;
  if (!v.vin) add('VIN', 'Missing VIN');
  else if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v.vin)) add('VIN', `VIN "${v.vin}" is not valid: it must be 17 letters/digits, without I, O or Q`);
  else if (seen.vin[v.vin]) add('VIN', `Same VIN as row ${seen.vin[v.vin]}`);
  if (v.vin && !seen.vin[v.vin]) seen.vin[v.vin] = row;
  if (!v.make) add('Make', 'Missing Make');
  if (!v.model) add('Model', 'Missing Model');
  if (!raw('year')) add('Year', 'Missing Year');
  else if (!(v.year >= 1980 && v.year <= maxY)) add('Year', `Year "${raw('year')}" must be 4 digits between 1980 and ${maxY}`);
  if (!raw('price')) add('Price', 'Missing Price');
  else if (!(v.price > 0)) add('Price', `Price "${raw('price')}" must be a number above 0`);
  if (!raw('mileage')) add('Mileage', 'Missing Mileage');
  else if (v.mileage === '' || isNaN(v.mileage) || !/^[\d,.\s]*(mi|miles|km)?\.?$/i.test(raw('mileage')) || /\.\d*[1-9]/.test(raw('mileage').replace(/,/g, '')))
    add('Mileage', `Mileage "${raw('mileage')}" must be a whole number`);
  if (!raw('trim')) add('Trim', 'Missing Trim');
  if (!raw('exteriorColor')) add('Exterior Color', 'Missing Exterior Color');
  if (!raw('description')) add('Dealer comments on vehicle', 'Missing Dealer comments on vehicle');
  if (!raw('transmission')) add('Transmission Type', 'Missing Transmission Type');
  const sk = String(v.stockNumber || '').toLowerCase();
  if (!v.stockNumber) add('Stock Number', 'Missing Stock Number');
  else if (seen.stock[sk]) add('Stock Number', `Same Stock Number as row ${seen.stock[sk]}`);
  if (v.stockNumber && !seen.stock[sk]) seen.stock[sk] = row;
  const imgs: string[] = v.images || [];
  if (!raw('images')) add('Image URLs', 'Missing Image URLs (photo links)');
  else if (!imgs.length) add('Image URLs', 'No valid photo link: links must start with http:// or https://');
  for (const u of imgs) {
    const ext = photoExt(u);
    const short = u.length > 60 ? u.slice(0, 57) + '…' : u;
    if (ext && !CG_IMG_OK.includes(ext)) add('Image URLs', `Image format not supported (.${ext}): use JPG, PNG or GIF · ${short}`);
    else if (!ext) add('Image URLs', `Photo format cannot be confirmed (link has no .jpg/.png ending) · ${short}`, true);
  }
  return P;
}

function downloadTemplate() {
  // CarGurus columns + the two more Facebook Marketplace needs
  const csv =
    [...IMP_CG.map((c) => c[1]), 'Body Style', 'Interior Color'].join(',') +
    '\r\n' +
    '1HGCM82633A004352,Honda,Accord,2003,EX,6995,142000,https://yourdealership.com/photos/accord-1.jpg|https://yourdealership.com/photos/accord-2.jpg,Silver,"One owner, clean history",A100,Automatic,Sunroof | Leather seats,Sedan,Black\r\n' +
    '2T1BURHE3JC012345,Toyota,Corolla,2018,LE,15990,40210,https://yourdealership.com/photos/corolla-1.png,White,Great fuel economy,C200,CVT,Backup camera | Bluetooth,Sedan,Gray\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = 'inventory-template.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 300);
}

export default function ImportPage() {
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [P, setP] = useState<Parsed | null>(null);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Record<string, string>>({});
  const [cols, setCols] = useState<Record<string, string>>({});
  const [inv, setInv] = useState<V[]>([]);
  const [cgOn, setCgOn] = useState(true);
  const [filter, setFilter] = useState<'all' | 'bad' | 'ok' | 'mp' | 'dup'>('all');
  const [dupMode, setDupMode] = useState<'update' | 'skip'>('update');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  /** inline "Fix": src = which list it was opened from (CarGurus problems or the Marketplace box) */
  const [fix, setFix] = useState<{ row: number; field: string; value: string; src?: 'cg' | 'mp' } | null>(null);
  const [done, setDone] = useState<{ add: number; upd: number; left: number; bad: number; ready: number; skipped: { row: number; reason: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api('/dealer/vehicles?pageSize=500')
      .then((r) => {
        setInv(r.items);
        setCgOn(!!r.cargurusOn);
      })
      .catch(() => { });
  }, []);

  function read(file: File) {
    if (!/\.(csv|tsv|txt|xml)$/i.test(file.name)) return toast.error('Choose a CSV, TSV or XML file.');
    if (file.size > 25 * 1024 * 1024) return toast.error('That file is larger than 25 MB.');
    const r = new FileReader();
    r.onload = () => {
      let p: Parsed;
      try {
        p = parseInventoryFile(file.name, String(r.result));
      } catch (e) {
        return toast.error((e as Error).message);
      }
      if (!p.records.length) return toast.error('No vehicles found in this file. The first row must contain the column names.');
      if (p.records.length > 2000) return toast.error(`This file has ${p.records.length} rows. Import up to 2,000 at a time.`);
      const m: Record<string, string> = {};
      const c: Record<string, string> = {};
      for (const h of p.headers) {
        const f = impGuess(h);
        if (f && !c[f]) {
          m[h] = f;
          c[f] = h;
        } else m[h] = '';
      }
      setFileName(file.name);
      setMap(m);
      setCols(c);
      setP(p);
      setFilter('all');
      setStep(2);
    };
    r.onerror = () => toast.error('The file could not be read.');
    r.readAsText(file);
  }

  /** check every row against the CarGurus rules; split into new / update, ready / with problems */
  const R = useMemo(() => {
    if (!P) return null;
    const byVin: Record<string, V> = {};
    const byStock: Record<string, V> = {};
    for (const v of inv) {
      if (v.vin) byVin[String(v.vin).toUpperCase()] = v;
      if (v.stockNumber) byStock[String(v.stockNumber).toLowerCase()] = v;
    }
    const seen = { vin: {}, stock: {} };
    const missReq = IMP_CG.filter((c) => c[2] === 'req' && !cols[c[0]]);
    const absent = new Set(IMP_CG.filter((c) => !cols[c[0]]).map((c) => c[1]));
    // Marketplace columns the file does not have at all
    const mpMissCols = MP_FIELDS.filter(([f]) => !cols[f] && !(f === 'bodyStyle' && cols.vehicleType));
    const out = { rows: [] as Row[], ready: 0, bad: 0, mpReady: 0, add: 0, upd: 0, skip: [] as number[], missReq, mpMissCols };
    P.records.forEach((rec, i) => {
      const row = i + 2;
      const v = impVehicle(rec, map);
      if (!v.make && !v.model && !v.vin) {
        out.skip.push(row);
        return;
      }
      const probs = impProblems(v, rec, cols, seen, row).filter((p) => !absent.has(p.f));
      const errs = probs.filter((p) => !p.w);
      const exV = v.vin && byVin[v.vin];
      const exS = !exV && v.stockNumber && byStock[String(v.stockNumber).toLowerCase()];
      const ex = exV || exS || null;
      // a vehicle is only CarGurus-ready when the file has every required column too
      const ok = !errs.length && !missReq.length;
      const mp = mpMissing(v);
      out.rows.push({ row, v, ex, by: exV ? 'VIN' : exS ? 'stock number' : '', probs, ok, mp });
      if (ok) out.ready++;
      if (!mp.length) out.mpReady++;
      else out.bad++;
      if (ex) out.upd++;
      else out.add++;
    });
    return out;
  }, [P, map, cols, inv]);

  async function run(rows: Row[], which: string) {
    setBusy(which);
    try {
      const extraCols = P ? extraColumns(P.headers, map) : [];
      const body = rows.map((r) => {
        const o: V = { _row: r.row, ...r.v };
        const rec = P?.records[r.row - 2];
        if (rec && extraCols.length) o.extra = Object.fromEntries(extraCols.map((h) => [h, rec[h] ?? '']));
        if (!r.ex && !o.status) o.status = (o.images || []).length ? 'PUBLISHED' : 'DRAFT';
        return o;
      });
      const res = await api('/dealer/vehicles/import', { body: { rows: body } });
      const bad = rows.filter((r) => !r.ok).length;
      setDone({ add: res.created, upd: res.updated, left: (R?.rows.length || 0) - rows.length, bad, ready: rows.length - bad, skipped: res.skipped || [] });
      setStep(3);
      toast.ok(`Imported: ${res.created} added, ${res.updated} updated`);
      void brandRun(); // photo links from the file get the branding bands (when photo branding is on)
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  function saveFix() {
    if (!fix || !P) return;
    let col = cols[fix.field];
    let headers = P.headers;
    if (!col) {
      // the file has no such column (e.g. Interior Color for Marketplace): add it, empty for the other vehicles
      col = MP_FIELDS.find((f) => f[0] === fix.field)?.[1] || fix.field;
      if (headers.includes(col)) col = `${col} (added)`;
      headers = [...headers, col];
      setMap((m) => ({ ...m, [col as string]: fix.field }));
      setCols((c) => ({ ...c, [fix.field]: col as string }));
    }
    const records = P.records.slice();
    records[fix.row - 2] = { ...records[fix.row - 2], [col]: fix.value.trim() };
    setP({ ...P, headers, records });
    setFix(null);
    toast.ok('Saved: the vehicle was checked again');
  }

  const steps = ['Upload file', 'Check vehicles', 'Done'];
  const stepper = (
    <ol className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
      {steps.map((s, i) => {
        const n = i + 1;
        return (
          <li key={s} className={cx('flex items-center gap-2 rounded-full px-3 py-1', n < step ? 'bg-emerald-50 text-emerald-700' : n === step ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-500')}>
            <i className={cx('flex h-5 w-5 items-center justify-center rounded-full text-xs not-italic', n === step ? 'bg-white text-blue-700' : n < step ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500')}>
              {n < step ? <Check className="h-3 w-3" /> : n}
            </i>
            {s}
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className="mx-auto max-w-5xl pb-10">
      <Link href="/dealer/inventory" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3 w-3" /> Inventory
      </Link>
      <h1 className="font-heading text-2xl font-extrabold text-slate-900">Import inventory</h1>
      {stepper}

      {/* ---------- step 1: upload ---------- */}
      {step === 1 && (
        <div className="mt-6 space-y-5">
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]);
            }}
            className={cx('flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition', over ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400')}
          >
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".csv,.tsv,.txt,.xml,text/csv,text/tab-separated-values,application/xml,text/xml"
              onChange={(e) => {
                if (e.target.files?.[0]) read(e.target.files[0]);
                e.target.value = '';
              }}
            />
            <Upload className="mb-3 h-8 w-8 text-slate-400" />
            <b className="text-slate-900">
              Drop your inventory file here or <span className="text-blue-700 underline">choose a file</span>
            </b>
            <span className="mt-1 text-sm text-slate-500">CSV, TSV or XML · up to 2,000 vehicles · photos as image links (URLs)</span>
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-heading text-base font-bold text-slate-900">What your file needs</h3>
            <p className="mt-1 text-sm text-slate-500">One row per vehicle, column names in the first row. These are the columns CarGurus needs (blue = required):</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {IMP_CG.map((c) => (
                <span key={c[0]} className={cx('rounded-full px-3 py-1 text-xs font-semibold', c[2] === 'req' ? 'bg-blue-50 text-blue-800 ring-1 ring-blue-200' : 'bg-slate-100 text-slate-600')}>
                  {c[1]}
                  {c[2] === 'opt' && ' · optional'}
                </span>
              ))}
            </div>
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-slate-600">
              <li>
                All columns are <b>required by CarGurus</b> except Installed Options: every vehicle needs a <b>Trim</b>, <b>Exterior Color</b>, <b>Transmission Type</b> and <b>Dealer comments</b> too.
              </li>
              <li>
                <b>VIN</b>: 17 letters/digits (no I, O, Q) · <b>Year</b>: 4 digits · <b>Price</b>: above 0 · <b>Mileage</b>: whole number
              </li>
              <li>
                <b>Image URLs</b>: full links (https://…), separated by | or commas, ending in <b>.jpg, .jpeg, .png or .gif</b> (no .webp)
              </li>
              <li>
                Vehicles you already have (same VIN or stock number) are <b>updated</b>, not added twice. Your dealer details are added for CarGurus automatically.
              </li>
            </ul>
            <Button variant="secondary" size="sm" className="mt-4" onClick={downloadTemplate}>
              <Download className="h-3.5 w-3.5" /> Download a ready-to-fill template
            </Button>
          </section>
        </div>
      )}

      {/* ---------- step 2: check ---------- */}
      {step === 2 && P && R && (() => {
        const total = R.rows.length;
        const blocking = !cols.make || !cols.model;
        const extra = P.headers.filter((h) => map[h] && !IMP_CG.some((c) => c[0] === map[h]));
        const kept = extraColumns(P.headers, map);
        const dups = R.rows.filter((r) => r.ex);
        const list = R.rows.filter((r) => (filter === 'all' ? true : filter === 'bad' ? !r.ok : filter === 'dup' ? !!r.ex : filter === 'mp' ? !r.mp.length : r.ok));
        const keep = (r: Row) => !(dupMode === 'skip' && r.ex);
        const sk = dupMode === 'skip' ? dups.length : 0;
        const skR = dupMode === 'skip' ? dups.filter((r) => r.ok).length : 0;
        const fT = total - sk;
        const fReady = R.ready - skR;
        const fBad = R.bad - (sk - skR);
        const fMp = R.mpReady - (dupMode === 'skip' ? dups.filter((r) => !r.mp.length).length : 0);
        // why vehicles are not Marketplace ready: columns the file lacks, otherwise the fields most vehicles miss
        const mpWhy = (() => {
          if (R.mpMissCols.length) return `${R.mpMissCols.map((c) => c[1]).join(', ')} ${R.mpMissCols.length === 1 ? 'is' : 'are'} missing`;
          const n: Record<string, number> = {};
          for (const r of R.rows) if (keep(r)) for (const m of r.mp) n[m] = (n[m] || 0) + 1;
          const top = Object.entries(n).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([m, c]) => `${m} (${c})`);
          return top.length ? `missing ${top.join(', ')}` : '';
        })();
        return (
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
              <FileText className="h-5 w-5 text-slate-400" />
              <div className="min-w-0 flex-1">
                <b className="text-slate-900">{fileName}</b>
                <span className="ml-2 text-sm text-slate-500">
                  {P.records.length} row{P.records.length === 1 ? '' : 's'} · {P.headers.length} columns
                </span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setStep(1)}>
                Choose another file
              </Button>
            </div>

            {/* verdict */}
            {blocking ? (
              <Verdict tone="bad" title="This file cannot be imported">
                The <b>Make</b> and <b>Model</b> columns are missing. Add them (see the list below) and upload the file again.
              </Verdict>
            ) : R.missReq.length ? (
              <Verdict tone="bad" title={`${R.missReq.length} CarGurus column${R.missReq.length === 1 ? ' is' : 's are'} missing: ${R.missReq.map((c) => c[1]).join(', ')}`}>
                The vehicles can go on your website, but CarGurus will not accept them until these columns are added to your file.
              </Verdict>
            ) : R.bad ? (
              <Verdict tone="warn" title={`${R.bad} of ${total} vehicle${total === 1 ? ' has' : 's have'} problems`}>
                They are listed below. Fix them in your file and upload it again, or import only the ready vehicles now.
              </Verdict>
            ) : (
              <Verdict tone="ok" title={`✓ All ${total} vehicle${total === 1 ? ' is' : 's are'} ready`}>Every CarGurus column is there and every vehicle passed the checks.</Verdict>
            )}

            {/* numbers */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card3 n={total} label={`vehicle${total === 1 ? '' : 's'} in file`} sub={`${R.add} new · ${R.upd} already in your inventory`} />
              <Card3 tone="ok" n={R.ready} label="ready for CarGurus" sub={`Meets all ${CG_REQ_N} CarGurus mandatory criteria. Ready to syndicate.`} />
              <Card3
                tone="fb"
                n={R.mpReady}
                label="ready for Marketplace"
                sub={R.mpMissCols.length ? `Your file has no ${R.mpMissCols.map((c) => c[1]).join(', ')} column${R.mpMissCols.length === 1 ? '' : 's'}.` : `Has all ${MP_REQ_N} Facebook Marketplace fields. The FB button lists them on Marketplace.`}
              />
              <Card3 tone={R.bad ? 'bad' : undefined} n={R.bad} label="website only (issues)" sub="Will be imported to your website, but cannot be listed on CarGurus until the issues are fixed." />
            </div>
            <p className="-mt-2 text-xs text-slate-500">
              <FacebookIcon className="mr-1 inline h-3.5 w-3.5 text-[#1877F2]" />
              Marketplace needs: {MP_FIELDS.map((f) => f[1]).join(', ')}.
            </p>

            {/* columns */}
            {IMP_CG.every((c) => cols[c[0]]) ? (
              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                ✓ All {IMP_CG.length} CarGurus columns found in your file
                {extra.length > 0 && ` · also imported to your website: ${extra.join(', ')}`}
              </div>
            ) : (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3">
                  <h3 className="inline font-heading text-base font-bold text-slate-900">CarGurus columns</h3>
                  <span className="ml-2 text-xs text-slate-500">found automatically in your file</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {IMP_CG.map((c) => {
                    const f = cols[c[0]];
                    return (
                      <div key={c[0]} className={cx('flex items-start gap-2 rounded-lg border px-3 py-2', f ? 'border-emerald-200 bg-emerald-50/50' : c[2] === 'req' ? 'border-red-200 bg-red-50/60' : 'border-slate-200')}>
                        <span className={cx('font-bold', f ? 'text-emerald-600' : c[2] === 'req' ? 'text-red-600' : 'text-slate-400')}>{f ? '✓' : c[2] === 'req' ? '✕' : '–'}</span>
                        <div>
                          <b className="block text-sm text-slate-800">{c[1]}</b>
                          <small className="text-xs text-slate-500">{f ? (impNorm(f) === impNorm(c[1]) ? 'found' : `from column “${f}”`) : c[2] === 'req' ? 'missing · required' : 'not in file · optional'}</small>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {extra.length > 0 && <p className="mt-3 text-xs text-slate-500">Also imported to your website: {extra.join(', ')}.</p>}
              </section>
            )}

            {kept.length > 0 && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                <b>{kept.length} additional column{kept.length === 1 ? '' : 's'} kept with your vehicles:</b> {kept.join(', ')}.{' '}
                <span className="text-blue-800">They are not checked by CarGurus and are added at the end of the CarGurus master CSV.</span>
              </div>
            )}

            {/* already in the inventory */}
            {dups.length > 0 && (
              <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 font-bold text-amber-950">{dups.length}</span>
                  <div>
                    <b className="block text-amber-950">
                      {dups.length} vehicle{dups.length === 1 ? ' is' : 's are'} already in your inventory
                    </b>
                    <span className="text-sm text-amber-900">Matched by VIN (or stock number when there is no VIN). They are not added twice.</span>
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  {dups.slice(0, 6).map((r) => (
                    <div key={r.row} className="flex flex-wrap gap-2">
                      <span className="font-mono text-xs text-slate-500">Row {r.row}</span>
                      <b>{vehicleName(r.v)}</b>
                      <span className="text-slate-600">
                        same {r.by} as your <b>{vehicleName(r.ex!)}</b> ({STATUS_TXT[r.ex!.status]})
                      </span>
                    </div>
                  ))}
                  {dups.length > 6 && <div className="text-xs text-slate-500">… and {dups.length - 6} more (filter “Already in inventory” below)</div>}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold text-amber-950">What should happen to them?</span>
                  <div className="flex rounded-lg bg-white p-1 text-xs font-semibold ring-1 ring-amber-200">
                    {(
                      [
                        ['update', 'Update them with this file'],
                        ['skip', 'Skip them (keep my current data)'],
                      ] as const
                    ).map(([k, l]) => (
                      <button key={k} onClick={() => setDupMode(k)} className={cx('rounded-md px-3 py-1.5', dupMode === k ? 'bg-amber-500 text-white' : 'text-slate-600')}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* vehicles */}
            {total > 0 && (
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
                  <h3 className="font-heading text-base font-bold text-slate-900">Vehicles</h3>
                  {(R.bad > 0 || dups.length > 0 || R.mpReady !== total) && (
                    <div className="flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
                      {(
                        [
                          ['all', `All ${total}`],
                          ['bad', `Problems ${R.bad}`],
                          ['ok', `CarGurus ready ${R.ready}`],
                          ['mp', `Marketplace ready ${R.mpReady}`],
                          ...(dups.length ? ([['dup', `Already in inventory ${dups.length}`]] as const) : []),
                        ] as [typeof filter, string][]
                      ).map(([k, l]) => (
                        <button key={k} onClick={() => setFilter(k)} className={cx('rounded-md px-3 py-1.5', filter === k ? 'bg-white shadow' : 'text-slate-500')}>
                          {l}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
                  {list.slice(0, 300).map((r) => {
                    const errs = r.probs.filter((p) => !p.w);
                    const warns = r.probs.filter((p) => p.w);
                    return (
                      <div key={r.row} className="px-5 py-3">
                        <div className="flex items-start gap-3">
                          <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', r.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>{r.ok ? '✓' : '!'}</span>
                          <div className="min-w-0 flex-1">
                            <b className="text-slate-900">{vehicleName(r.v) || `Row ${r.row}`}</b>
                            <small className="block text-xs text-slate-500">
                              Row {r.row}
                              {r.v.vin && ` · ${r.v.vin}`}
                              {r.v.stockNumber && ` · Stock ${r.v.stockNumber}`}
                              {r.v.price ? ` · ${money(r.v.price)}` : ''} · {(r.v.images || []).length} photo{(r.v.images || []).length === 1 ? '' : 's'}
                            </small>
                          </div>
                          <span
                            title={r.ex ? `Same ${r.by} as ${vehicleName(r.ex)} in your inventory` : ''}
                            className={cx('shrink-0 rounded-full px-2.5 py-1 text-xs font-bold', r.ex ? (dupMode === 'skip' ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-700') : 'bg-emerald-50 text-emerald-700')}
                          >
                            {r.ex ? (dupMode === 'skip' ? 'In inventory · skipped' : 'In inventory · will update') : 'New'}
                          </span>
                          <span
                            title={r.mp.length ? `Facebook Marketplace needs: ${r.mp.join(', ')}` : 'Has every Facebook Marketplace field'}
                            className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold', r.mp.length ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-[#1877F2] ring-1 ring-blue-200')}
                          >
                            <FacebookIcon className="h-3 w-3" />
                            {r.mp.length ? (r.mp.length <= 2 ? `Marketplace: needs ${r.mp.join(', ')}` : `Marketplace: ${r.mp.length} missing`) : 'Marketplace ready'}
                          </span>
                        </div>
                        {(errs.length > 0 || warns.length > 0) && (
                          <ul className="ml-9 mt-2 space-y-1 text-sm">
                            {errs.map((p, i) => {
                              const k = IMP_FIX[p.f];
                              const canFix = !!(k && cols[k]);
                              const editing = fix && fix.src !== 'mp' && fix.row === r.row && fix.field === k;
                              return (
                                <li key={i} className="text-red-700">
                                  {editing ? (
                                    <span className="flex flex-wrap items-center gap-2">
                                      <b className="text-slate-800">{p.f}</b>
                                      <Input
                                        autoFocus
                                        className="min-w-[260px] flex-1"
                                        value={fix.value}
                                        placeholder={k === 'images' ? 'https://…/photo.jpg | https://…/photo2.jpg' : `Type the ${p.f}`}
                                        onChange={(e) => setFix({ ...fix, value: e.target.value })}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            saveFix();
                                          }
                                          if (e.key === 'Escape') setFix(null);
                                        }}
                                      />
                                      <Button size="sm" onClick={saveFix}>
                                        Save
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => setFix(null)}>
                                        Cancel
                                      </Button>
                                    </span>
                                  ) : (
                                    <>
                                      <b className="mr-1.5 text-slate-800">{p.f}</b>
                                      {p.m}
                                      {canFix && (
                                        <button
                                          type="button"
                                          onClick={() => setFix({ row: r.row, field: k, value: P.records[r.row - 2][cols[k]] || '', src: 'cg' })}
                                          className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                                        >
                                          <Pencil className="h-3 w-3" /> Fix
                                        </button>
                                      )}
                                    </>
                                  )}
                                </li>
                              );
                            })}
                            {warns.map((p, i) => (
                              <li key={`w${i}`} className="text-amber-700">
                                <b className="mr-1.5 text-slate-800">{p.f}</b>
                                {p.m}
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.mp.length > 0 && (
                          <div className="ml-9 mt-2 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2">
                            <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-[#1877F2]">
                              <FacebookIcon className="h-3.5 w-3.5" /> Fix for Facebook Marketplace
                              <span className="font-normal text-slate-500">· needs {r.mp.length} more field{r.mp.length === 1 ? '' : 's'}</span>
                            </div>
                            <ul className="space-y-1 text-sm">
                              {r.mp.map((label) => {
                                const k = MP_FIX[label];
                                const editing = fix && fix.src === 'mp' && fix.row === r.row && fix.field === k;
                                const alsoCg = errs.some((p) => IMP_FIX[p.f] === k);
                                const current = cols[k] ? P.records[r.row - 2][cols[k]] || '' : '';
                                return (
                                  <li key={label} className="text-blue-900">
                                    {editing ? (
                                      <span className="flex flex-wrap items-center gap-2">
                                        <b className="text-slate-800">{label}</b>
                                        <Input
                                          autoFocus
                                          className="min-w-[260px] flex-1"
                                          value={fix.value}
                                          placeholder={k === 'images' ? 'https://…/photo.jpg | https://…/photo2.jpg' : k === 'bodyStyle' ? 'e.g. Sedan, SUV, Pickup truck' : `Type the ${label}`}
                                          onChange={(e) => setFix({ ...fix, value: e.target.value })}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              saveFix();
                                            }
                                            if (e.key === 'Escape') setFix(null);
                                          }}
                                        />
                                        <Button size="sm" className="border-transparent bg-[#1877F2] text-white hover:bg-[#166fe5]" onClick={saveFix}>
                                          Save
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => setFix(null)}>
                                          Cancel
                                        </Button>
                                      </span>
                                    ) : (
                                      <>
                                        <b className="mr-1.5 text-slate-800">{label}</b>
                                        {!cols[k] ? 'is not in your file' : k === 'mileage' && String(current).trim() !== '' ? `must be more than 0 (now “${current}”)` : 'is empty'}
                                        {alsoCg && <span className="ml-1.5 text-xs text-slate-500">(CarGurus needs it too)</span>}
                                        {k && (
                                          <button
                                            type="button"
                                            onClick={() => setFix({ row: r.row, field: k, value: current, src: 'mp' })}
                                            className="ml-2 inline-flex items-center gap-1 rounded-md bg-[#1877F2] px-2 py-0.5 text-xs font-semibold text-white hover:bg-[#166fe5]"
                                          >
                                            <Pencil className="h-3 w-3" /> Fix for Marketplace
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {list.length > 300 && <p className="px-5 py-3 text-xs text-slate-500">Showing the first 300.</p>}
                </div>
              </section>
            )}
            {R.skip.length > 0 && (
              <p className="text-xs text-slate-500">
                {R.skip.length} empty row{R.skip.length === 1 ? '' : 's'} skipped (no make, model or VIN): row {R.skip.slice(0, 10).join(', ')}
                {R.skip.length > 10 ? '…' : ''}.
              </p>
            )}
            <p className="text-xs text-slate-500">Vehicles with photos are published on your website; vehicles without photos are saved as drafts.</p>

            {/* actions */}
            <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-[#f4f6fb]/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
              <LinkButton href="/dealer/inventory" variant="secondary">
                Cancel
              </LinkButton>
              {!blocking && (
                <>
                  <Button variant="secondary" disabled={!fT} loading={busy === 'all'} onClick={() => run(R.rows.filter(keep), 'all')}>
                    {fT ? `Import all ${fT}` : 'Nothing new to import'}
                  </Button>
                  <Button disabled={!fReady} loading={busy === 'ready'} onClick={() => run(R.rows.filter((r) => r.ok && keep(r)), 'ready')}>
                    Import {fReady} CarGurus-ready vehicle{fReady === 1 ? '' : 's'}
                  </Button>
                  <MpButton n={fMp} why={mpWhy} busy={busy === 'mp'} onClick={() => run(R.rows.filter((r) => !r.mp.length && keep(r)), 'mp')} />
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ---------- step 3: done ---------- */}
      {step === 3 && done && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl font-bold text-emerald-700">✓</span>
          <h3 className="mt-3 font-heading text-xl font-extrabold text-slate-900">Import finished</h3>
          <p className="mt-1 text-slate-600">
            <b>{done.add}</b> vehicle{done.add === 1 ? '' : 's'} added · <b>{done.upd}</b> updated
            {done.left > 0 && (
              <>
                {' '}
                · <b>{done.left}</b> with problems not imported
              </>
            )}
          </p>
          {done.skipped.length > 0 && (
            <div className="mx-auto mt-4 max-w-xl rounded-xl bg-red-50 p-3 text-left text-sm text-red-800">
              <b>{done.skipped.length} row(s) could not be saved:</b>
              <ul className="mt-1 list-disc pl-5">
                {done.skipped.slice(0, 10).map((s) => (
                  <li key={s.row}>
                    Row {s.row}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {done.bad > 0 && (
            <div className="mx-auto mt-4 max-w-xl rounded-xl bg-amber-50 p-3 text-left text-sm text-amber-900">
              <b>
                {done.bad} vehicle{done.bad === 1 ? ' is' : 's are'} on your website only:
              </b>{' '}
              excluded from the CarGurus feed until the mandatory fields are added. They are marked “CarGurus: issues” in your inventory; click the mark to fix them.
            </div>
          )}
          {done.ready > 0 && cgOn && (
            <div className="mx-auto mt-3 max-w-xl rounded-xl bg-blue-50 p-3 text-left text-sm text-blue-900">
              {done.ready} CarGurus-ready vehicle{done.ready === 1 ? ' is' : 's are'} now queued for CarGurus (sent after the platform team verifies them).
            </div>
          )}
          <LinkButton href="/dealer/inventory" className="mt-6">
            View inventory
          </LinkButton>

          {/* Where do you want to post options */}
          <div className="mx-auto mt-6 max-w-xl text-left">
            <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">Where do you want to post?</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-xs font-bold text-orange-700">CG</span>
                    <b className="text-sm font-semibold text-slate-900">CarGurus Feed</b>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                    Review vehicles eligible for the automated CarGurus syndication feed.
                  </p>
                </div>
                <Link
                  href="/dealer/cargurus"
                  className="mt-3.5 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  View CarGurus feed
                </Link>
              </div>

              <div className="flex flex-col justify-between rounded-xl border border-blue-200 bg-blue-50/40 p-4 transition hover:border-blue-300">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1877F2] text-white">
                      <FacebookIcon className="h-4 w-4" />
                    </span>
                    <b className="text-sm font-semibold text-slate-900">Facebook (FB Poster)</b>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                    Set up your Facebook Page and Groups to post vehicles directly from inventory.
                  </p>
                </div>
                <Link
                  href="/dealer/facebook"
                  className="mt-3.5 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1877F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#166fe5]"
                >
                  <FacebookIcon className="h-3.5 w-3.5" />
                  Set up Facebook posting
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            <LinkButton href="/dealer/inventory" variant="secondary">
              View inventory
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}

function Verdict({ tone, title, children }: { tone: 'ok' | 'warn' | 'bad'; title: string; children: React.ReactNode }) {
  const cls = { ok: 'border-emerald-200 bg-emerald-50 text-emerald-900', warn: 'border-amber-200 bg-amber-50 text-amber-900', bad: 'border-red-200 bg-red-50 text-red-900' }[tone];
  return (
    <div className={cx('rounded-2xl border px-5 py-4', cls)}>
      <b className="block">{title}</b>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/** "Import N Marketplace-ready vehicles" — with the reason underneath when some (or all) are not ready */
function MpButton({ n, why, busy, onClick }: { n: number; why: string; busy: boolean; onClick: () => void }) {
  return (
    <span className="inline-flex flex-col items-end">
      <Button className="border-transparent bg-[#1877F2] text-white hover:bg-[#166fe5] disabled:bg-[#1877F2]/50" disabled={!n} loading={busy} onClick={onClick}>
        <FacebookIcon className="mr-1.5 h-3.5 w-3.5" />
        Import {n} Marketplace-ready vehicle{n === 1 ? '' : 's'}
      </Button>
      {why && <small className="mt-1 max-w-[320px] text-right text-[11px] font-semibold text-red-600">Marketplace: {why}</small>}
    </span>
  );
}

function Card3({ n, label, sub, tone }: { n: number; label: string; sub: string; tone?: 'ok' | 'bad' | 'fb' }) {
  return (
    <div className={cx('rounded-2xl border bg-white p-4 shadow-sm', tone === 'ok' ? 'border-emerald-200' : tone === 'bad' ? 'border-red-200' : tone === 'fb' ? 'border-blue-200' : 'border-slate-200')}>
      <b className={cx('block font-heading text-3xl font-extrabold', tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : tone === 'fb' ? 'text-[#1877F2]' : 'text-slate-900')}>{n}</b>
      <span className="font-semibold text-slate-800">{label}</span>
      <small className="mt-1 block text-xs text-slate-500">{sub}</small>
    </div>
  );
}
