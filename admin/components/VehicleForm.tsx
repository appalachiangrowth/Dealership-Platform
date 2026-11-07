'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import { api, siteUrl } from '@/lib/api';
import { useToast } from './toast';
import { useTenant } from './DealerShell';
import { ImageUploader } from './ImageUploader';
import { Button, Card, Field, Input, Modal, Select, Textarea, Toggle, cx } from './ui';
import { vehicleName } from '@/lib/format';

export type Vehicle = Record<string, any> & { id?: string; images: string[]; features: string[]; safetyFeatures: string[] };

export const EMPTY_VEHICLE: Vehicle = {
  year: '', make: '', model: '', trim: '', vehicleType: 'Car', bodyStyle: '', condition: 'Used', certified: false, price: '', processingFee: '', msrp: '', mileage: '',
  stockNumber: '', vin: '', exteriorColor: '', interiorColor: '', engine: '', horsepower: '', drivetrain: '', transmission: '', fuelType: '', mpg: '',
  fuelTank: '', doors: '', seats: '', owners: '', accidents: '', dealLabel: '', description: '', features: [], safetyFeatures: [], images: [],
  status: 'DRAFT', featured: false, title: '', metaTitle: '', metaDescription: '',
};

const BODY = ['Sedan', 'SUV', 'Truck', 'Coupe', 'Hatchback', 'Wagon', 'Convertible', 'Van', 'Minivan', 'Crossover'];
const TYPES = ['Car', 'Truck', 'SUV', 'Van', 'Motorcycle', 'RV', 'Other'];
const DRIVE = ['Front-Wheel Drive', 'Rear-Wheel Drive', 'All-Wheel Drive', 'Four-Wheel Drive'];
const FUEL = ['Gasoline', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Electric', 'Flex Fuel', 'Biodiesel'];
const TRANS = ['Automatic', 'Manual', 'CVT', 'Dual-Clutch'];

function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [t, setT] = useState('');
  const add = () => {
    const items = t.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (items.length) onChange([...value, ...items.filter((i) => !value.includes(i))]);
    setT('');
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
            {f}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== f))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={t}
        placeholder={placeholder}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export function VehicleForm({ initial }: { initial: Vehicle }) {
  const [v, setV] = useState<Vehicle>(initial);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState<Record<string, string>>({});
  const [del, setDel] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const { tenant } = useTenant();
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));

  useEffect(() => {
    api('/dealer/vehicles/field-rules').then((r) => setRules(r.rules)).catch(() => {});
  }, []);
  const req = (k: string) => rules[k] === 'required';
  const L = (k: string, label: string) => (req(k) ? `${label} *` : label);

  async function save(status?: string) {
    setSaving(true);
    try {
      const body: Record<string, any> = { ...v, ...(status ? { status } : {}) };
      delete body.id;
      delete body.tenantId;
      delete body.createdAt;
      delete body.updatedAt;
      delete body.soldAt;
      delete body.legacyId;
      delete body.slug;
      const out = v.id ? await api(`/dealer/vehicles/${v.id}`, { method: 'PATCH', body }) : await api('/dealer/vehicles', { body });
      toast.ok(v.id ? 'Vehicle saved' : 'Vehicle added');
      if (!v.id) router.replace(`/dealer/vehicles/${out.id}`);
      else setV({ ...EMPTY_VEHICLE, ...out, processingFee: out.processingFee ?? v.processingFee });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const text = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={L(k, label)}>
      <Input value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...props} />
    </Field>
  );
  const pick = (k: string, label: string, opts: string[]) => (
    <Field label={L(k, label)}>
      <Input list={`dl-${k}`} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
      <datalist id={`dl-${k}`}>
        {opts.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </Field>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-6"
    >
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-[#f4f6fb]/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div>
          <h1 className="font-heading text-xl font-extrabold text-slate-900">{v.id ? vehicleName(v as any) : 'Add vehicle'}</h1>
          <div className="text-xs text-slate-500">
            Status: <b>{String(v.status).toLowerCase()}</b>
            {v.id && v.status === 'PUBLISHED' && tenant && (
              <>
                {' · '}
                <a className="text-blue-700 underline" href={`${siteUrl(tenant)}/index.html#/vehicle/${encodeURIComponent(v.legacyId || v.id)}`} target="_blank" rel="noreferrer">
                  View on website
                </a>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {v.id && (
            <Button type="button" variant="ghost" onClick={() => setDel(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {v.status !== 'SOLD' && v.id && (
            <Button type="button" variant="secondary" onClick={() => save('SOLD')} loading={saving}>
              Mark sold
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => save('DRAFT')} loading={saving}>
            Save as draft
          </Button>
          <Button type="button" variant="success" onClick={() => save('PUBLISHED')} loading={saving}>
            {v.status === 'PUBLISHED' ? 'Save' : 'Publish'}
          </Button>
        </div>
      </div>

      <Card title="Photos">
        <ImageUploader value={v.images} onChange={(imgs) => set('images', imgs)} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Basics">
            <div className="grid gap-4 sm:grid-cols-4">
              {text('year', 'Year', { inputMode: 'numeric' })}
              {text('make', 'Make')}
              {text('model', 'Model')}
              {text('trim', 'Trim')}
              {pick('vehicleType', 'Vehicle type', TYPES)}
              {pick('bodyStyle', 'Body style', BODY)}
              <Field label="Condition">
                <Select value={v.condition} onChange={(e) => set('condition', e.target.value)}>
                  <option>Used</option>
                  <option>New</option>
                  <option>Certified Pre-Owned</option>
                </Select>
              </Field>
              <div className="flex items-end pb-2">
                <Toggle checked={!!v.certified} onChange={(x) => set('certified', x)} label="Certified" />
              </div>
            </div>
          </Card>
          <Card title="Price & identification">
            <div className="grid gap-4 sm:grid-cols-3">
              {text('price', 'Price ($)', { inputMode: 'decimal' })}
              {text('processingFee', 'Processing Fee ($)', { inputMode: 'decimal', placeholder: 'e.g. 499' })}
              {text('msrp', 'MSRP ($)', { inputMode: 'decimal' })}
              {text('mileage', 'Mileage', { inputMode: 'numeric' })}
              {text('vin', 'VIN', { maxLength: 17, className: 'font-mono uppercase' })}
              {text('stockNumber', 'Stock number')}
              {text('dealLabel', 'Deal label', { placeholder: 'e.g. $1,500 below market' })}
            </div>
          </Card>
          <Card title="Specifications">
            <div className="grid gap-4 sm:grid-cols-3">
              {text('exteriorColor', 'Exterior colour')}
              {text('interiorColor', 'Interior colour')}
              {text('engine', 'Engine', { placeholder: '3.5L V6' })}
              {text('horsepower', 'Horsepower')}
              {pick('drivetrain', 'Drivetrain', DRIVE)}
              {pick('transmission', 'Transmission', TRANS)}
              {pick('fuelType', 'Fuel type', FUEL)}
              {text('mpg', 'MPG', { placeholder: '22 city / 30 hwy' })}
              {text('fuelTank', 'Fuel tank (gal)')}
              {text('doors', 'Doors')}
              {text('seats', 'Seats')}
              {text('owners', 'Previous owners')}
              {text('accidents', 'Accidents reported')}
            </div>
          </Card>
          <Card title="Description & features">
            <div className="space-y-4">
              <Field label={L('description', 'Description')} hint="Also sent to CarGurus as “Dealer comments”.">
                <Textarea rows={6} value={v.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
              <Field label="Features" hint="Press Enter after each one, or paste a comma-separated list.">
                <ListInput value={v.features} onChange={(x) => set('features', x)} placeholder="Sunroof, Leather seats, Backup camera…" />
              </Field>
              <Field label="Safety features">
                <ListInput value={v.safetyFeatures} onChange={(x) => set('safetyFeatures', x)} placeholder="Blind spot monitor, Lane assist…" />
              </Field>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="On the website">
            <div className="space-y-4">
              <Toggle checked={!!v.featured} onChange={(x) => set('featured', x)} label="Featured" desc="Shown in “Featured vehicles” on the home page." />
              <Field label="Status">
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold">
                  {['PUBLISHED', 'DRAFT', 'SOLD'].map((s) => (
                    <button type="button" key={s} onClick={() => set('status', s)} className={cx('rounded-md py-1.5', v.status === s ? 'bg-white shadow' : 'text-slate-500')}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Card>
          <Card title="Google (optional)">
            <div className="space-y-4">
              {text('title', 'Custom headline')}
              {text('metaTitle', 'Google title')}
              <Field label="Google description">
                <Textarea rows={3} value={v.metaDescription} onChange={(e) => set('metaDescription', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={del}
        onClose={() => setDel(false)}
        title="Delete this vehicle?"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setDel(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={async () => {
                try {
                  await api(`/dealer/vehicles/${v.id}`, { method: 'DELETE' });
                  toast.ok('Vehicle deleted');
                  router.replace('/dealer/vehicles');
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        {vehicleName(v as any)} will be removed from your website and feeds. Tip: use “Mark sold” to keep it in your records.
      </Modal>
    </form>
  );
}
