'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, PageHeader, Select, Table, Td } from '@/components/ui';

/** Vehicle field → header names that are recognised automatically. */
const FIELDS: Record<string, string[]> = {
  vin: ['vin', 'vinnumber', 'vehiclevin'],
  stockNumber: ['stock', 'stocknumber', 'stockno', 'stocknum', 'stock#'],
  year: ['year', 'modelyear'],
  make: ['make', 'manufacturer'],
  model: ['model', 'modelname'],
  trim: ['trim', 'trimlevel', 'series'],
  price: ['price', 'sellingprice', 'saleprice', 'internetprice', 'askingprice', 'listprice'],
  processingFee: ['processingfee', 'processing_fee', 'profee', 'docfee', 'documentationfee', 'dealerfee', 'adminfee'],
  msrp: ['msrp'],
  mileage: ['mileage', 'miles', 'odometer'],
  exteriorColor: ['exteriorcolor', 'extcolor', 'color', 'colour', 'ext'],
  interiorColor: ['interiorcolor', 'intcolor', 'int'],
  bodyStyle: ['body', 'bodystyle', 'bodytype'],
  vehicleType: ['type', 'vehicletype'],
  condition: ['condition', 'newused', 'isnew'],
  engine: ['engine', 'enginedescription'],
  transmission: ['transmission', 'transmissiontype', 'trans'],
  drivetrain: ['drivetrain', 'drivetype', 'drive'],
  fuelType: ['fuel', 'fueltype'],
  mpg: ['mpg'],
  doors: ['doors'],
  description: ['description', 'comments', 'dealercomments', 'dealercommentsonvehicle'],
  features: ['features', 'options', 'installedoptions'],
  images: ['images', 'imageurls', 'imageurl', 'photos', 'photourls', 'pictures'],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]/g, '');

function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = t.split('\n', 1)[0];
  const delim = [',', '\t', ';', '|'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function parseXml(text: string): string[][] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This XML file could not be read');
  let items: Element[] = [];
  for (const tag of ['vehicle', 'listing', 'item', 'car']) {
    items = Array.from(doc.getElementsByTagName(tag));
    if (items.length) break;
  }
  if (!items.length) throw new Error('No <vehicle>, <listing> or <item> elements found');
  const records = items.map((el) => {
    const r: Record<string, string> = {};
    for (const child of Array.from(el.children)) {
      const kids = Array.from(child.children);
      r[child.tagName] = kids.length ? kids.map((k) => k.textContent?.trim() || '').join('|') : child.textContent?.trim() || '';
    }
    return r;
  });
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  return [headers, ...records.map((r) => headers.map((h) => r[h] || ''))];
}

export default function ImportPage() {
  const router = useRouter();
  const toast = useToast();
  const [file, setFile] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<number, string>>({});
  const [mode, setMode] = useState<'publish' | 'draft'>('draft');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function load(f: File) {
    setResult(null);
    try {
      const text = await f.text();
      const r = /\.xml$/i.test(f.name) || text.trim().startsWith('<') ? parseXml(text) : parseCsv(text);
      if (r.length < 2) throw new Error('The file has no vehicle rows');
      if (r.length > 2001) throw new Error('Up to 2,000 vehicles per file');
      const m: Record<number, string> = {};
      r[0].forEach((h, i) => {
        const n = norm(h);
        const hit = Object.entries(FIELDS).find(([k, al]) => al.includes(n) && !Object.values(m).includes(k));
        if (hit) m[i] = hit[0];
      });
      setFile(f.name);
      setRows(r);
      setMap(m);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function build() {
    return rows.slice(1).map((r) => {
      const v: Record<string, unknown> = {};
      Object.entries(map).forEach(([i, k]) => {
        if (!k) return;
        const val = (r[Number(i)] || '').trim();
        if (k === 'images') v.images = val.split(/\s*[|,;\n]\s*|\s+(?=https?:\/\/)/).filter((u) => /^https?:\/\//.test(u));
        else if (k === 'features') v.features = val.split(/\s*[|;,]\s*/).filter(Boolean);
        else if (k === 'condition') v.condition = /^(new|y|yes|true)$/i.test(val) ? 'New' : 'Used';
        else v[k] = val;
      });
      if (v.processingFee && v.price) {
        const p = parseFloat(String(v.price).replace(/[^0-9.]/g, '')) || 0;
        const fee = parseFloat(String(v.processingFee).replace(/[^0-9.]/g, '')) || 0;
        if (p > 0 && fee > 0) v.price = String(p + fee);
      }
      return v;
    });
  }

  async function run() {
    setBusy(true);
    const all = build();
    const total = { created: 0, updated: 0, skipped: [] as any[] };
    try {
      for (let i = 0; i < all.length; i += 500) {
        const r = await api('/dealer/vehicles/import', { body: { rows: all.slice(i, i + 500), mode } });
        total.created += r.created;
        total.updated += r.updated;
        total.skipped.push(...r.skipped.map((s: any) => ({ ...s, row: s.row + i })));
      }
      setResult(total);
      toast.ok(`Import finished: ${total.created} new, ${total.updated} updated`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        back="/dealer/vehicles"
        title="Import vehicles"
        desc="Upload a CSV, TSV or XML file (up to 2,000 vehicles). Existing vehicles are matched by VIN, then stock number, and updated; their other details and photos are kept."
      />
      <Card className="mb-6">
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center hover:border-blue-400">
          <FileUp className="mb-2 h-8 w-8 text-slate-400" />
          <span className="text-sm font-semibold text-slate-700">{file || 'Choose a .csv, .tsv or .xml file'}</span>
          <span className="text-xs text-slate-500">Works with this platform’s inventory.xml and most dealer feeds</span>
          <input type="file" accept=".csv,.tsv,.txt,.xml" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
      </Card>
      {rows.length > 1 && !result && (
        <>
          <Card title={`Match the columns · ${rows.length - 1} vehicles`} className="mb-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {rows[0].map((h, i) => (
                <Field key={i} label={h || `Column ${i + 1}`} hint={rows[1]?.[i]?.slice(0, 40)}>
                  <Select value={map[i] || ''} onChange={(e) => setMap({ ...map, [i]: e.target.value })}>
                    <option value="">— skip —</option>
                    {Object.keys(FIELDS).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </Card>
          <Card title="Preview" className="mb-6" pad={false}>
            <Table head={['#', 'Year', 'Make', 'Model', 'Price', 'VIN', 'Photos']}>
              {build()
                .slice(0, 15)
                .map((v: any, i) => (
                  <tr key={i}>
                    <Td>{i + 1}</Td>
                    <Td>{v.year}</Td>
                    <Td>{v.make}</Td>
                    <Td>{v.model}</Td>
                    <Td>{v.price}</Td>
                    <Td className="font-mono text-xs">{v.vin}</Td>
                    <Td>{v.images?.length || 0}</Td>
                  </tr>
                ))}
            </Table>
          </Card>
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <Field label="New vehicles are">
                <Select value={mode} onChange={(e) => setMode(e.target.value as 'publish' | 'draft')}>
                  <option value="draft">Saved as drafts</option>
                  <option value="publish">Published (vehicles without photos become drafts)</option>
                </Select>
              </Field>
              <Button onClick={run} loading={busy} variant="success" className="mt-5">
                Import {rows.length - 1} vehicles
              </Button>
            </div>
          </Card>
        </>
      )}
      {result && (
        <Card title="Import finished">
          <div className="mb-4 flex gap-3">
            <Badge color="green">{result.created} new</Badge>
            <Badge color="blue">{result.updated} updated</Badge>
            <Badge color={result.skipped.length ? 'amber' : 'slate'}>{result.skipped.length} skipped</Badge>
          </div>
          {result.skipped.length > 0 && (
            <ul className="mb-4 max-h-60 overflow-y-auto text-sm text-slate-600">
              {result.skipped.map((s: any) => (
                <li key={s.row}>
                  Row {s.row}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          <Button onClick={() => router.push('/dealer/vehicles')}>Go to vehicles</Button>
        </Card>
      )}
    </>
  );
}
