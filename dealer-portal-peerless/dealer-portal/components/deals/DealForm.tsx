'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CreditCard, Download, FileText, Printer, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Textarea, Toggle, cx } from '@/components/ui';
import { LicenseScanner } from './LicenseScanner';
import type { LicenseData } from '@/lib/aamva';
import { type Deal, FORMS, US_STATES, downloadPdf, num, openPdf, totals, usd } from '@/lib/deals';

type Dealer = { name: string; legalName: string; address: string; phone: string; email: string; licenseNumber: string };

const g2 = 'grid gap-4 sm:grid-cols-2';
const g3 = 'grid gap-4 sm:grid-cols-3';
const g4 = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4';

function StateSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const list = value && !US_STATES.includes(value) ? [value, ...US_STATES] : US_STATES;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {list.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </Select>
  );
}

function Money({ value, onChange, disabled }: { value: unknown; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
      <Input inputMode="decimal" className="pl-6 text-right" disabled={disabled} value={value === 0 ? '0' : String(value ?? '')} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} />
    </div>
  );
}

function Radio<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cx('rounded-lg border px-3 py-2 text-xs font-semibold', value === v ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Sell Car / Bill of Sale: buyer, money, disclosures, and the 4 deal forms. */
export function DealForm({ initial, dealer }: { initial: Deal; dealer?: Dealer | null }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<Deal>(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(!initial.id);
  const [scan, setScan] = useState(false);
  const [coBuyer, setCoBuyer] = useState(!!initial.coBuyerFullName);
  const [finish, setFinish] = useState(false);
  const [markSold, setMarkSold] = useState(true);
  const [busyPdf, setBusyPdf] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const set = <K extends keyof Deal>(k: K, v: Deal[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const t = totals(d);
  const v = d.vehicleSnapshot || {};
  const trade = d.tradeInVehicle || {};
  const vName = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || 'No vehicle selected';

  const applyLicense = (l: LicenseData) => {
    setD((x) => ({
      ...x,
      buyerFirstName: l.firstName || x.buyerFirstName,
      buyerMiddleName: l.middleName || x.buyerMiddleName,
      buyerLastName: l.lastName || x.buyerLastName,
      buyerFullName: [l.firstName, l.middleName, l.lastName].filter(Boolean).join(' ') || x.buyerFullName,
      buyerAddress: l.address || x.buyerAddress,
      buyerCity: l.city || x.buyerCity,
      buyerState: l.state || x.buyerState,
      buyerZip: l.zip || x.buyerZip,
      buyerDob: l.dob || x.buyerDob,
      buyerLicenseNumber: l.licenseNumber || x.buyerLicenseNumber,
      buyerLicenseState: l.licenseState || l.state || x.buyerLicenseState,
      buyerLicenseExpiry: l.expiry || x.buyerLicenseExpiry,
    }));
    setDirty(true);
    toast.ok('Buyer details filled from the license');
  };

  /** name parts → full name (until the full name is typed by hand) */
  const setName = (k: 'buyerFirstName' | 'buyerMiddleName' | 'buyerLastName', val: string) => {
    setD((x) => {
      const n = { ...x, [k]: val };
      const auto = [x.buyerFirstName, x.buyerMiddleName, x.buyerLastName].filter(Boolean).join(' ');
      if (!x.buyerFullName || x.buyerFullName === auto) n.buyerFullName = [n.buyerFirstName, n.buyerMiddleName, n.buyerLastName].filter(Boolean).join(' ');
      return n;
    });
    setDirty(true);
  };

  async function save(quiet = false): Promise<Deal | null> {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...d, salesTaxAmount: d.salesTaxManual ? d.salesTaxAmount : t.tax };
      for (const k of ['id', 'dealNumber', 'status', 'vehicleSnapshot', 'totalPrice', 'balanceDue', 'createdAt', 'updatedAt', 'tenantId', 'dealSeq', 'createdBy']) delete body[k];
      if (!coBuyer) Object.assign(body, { coBuyerFullName: '', coBuyerAddress: '', coBuyerPhone: '', coBuyerLicenseNumber: '' });
      const r = await api<Deal>(d.id ? `/dealer/deals/${d.id}` : '/dealer/deals', { method: d.id ? 'PATCH' : 'POST', body });
      setD(r);
      setDirty(false);
      if (!quiet) toast.ok(`Deal ${r.dealNumber} saved`);
      if (!d.id && r.id) router.replace(`/dealer/deals/${r.id}`);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    const saved = dirty || !d.id ? await save(true) : d;
    if (!saved?.id) return;
    try {
      const r = await api<Deal & { vehicleMarkedSold?: boolean }>(`/dealer/deals/${saved.id}/complete`, { body: { markSold } });
      setD(r);
      setFinish(false);
      toast.ok(r.vehicleMarkedSold ? 'Deal completed - vehicle marked as sold' : 'Deal completed');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function pdf(kind: string, how: 'download' | 'open') {
    let id = d.id;
    if (dirty || !id) id = (await save(true))?.id;
    if (!id) return;
    setBusyPdf(kind + how);
    try {
      const path = `/dealer/deals/${id}/pdf/${kind}`;
      if (how === 'open') await openPdf(path);
      else await downloadPdf(path, `${d.dealNumber || 'deal'}-${kind}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyPdf('');
    }
  }

  async function remove() {
    if (!d.id) return;
    try {
      await api(`/dealer/deals/${d.id}`, { method: 'DELETE' });
      toast.ok('Deal deleted');
      router.push('/dealer/deals');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const missing = [!d.buyerFullName && !d.buyerLastName && 'buyer name', !num(d.salePrice) && 'sale price', !v.vin && 'vehicle VIN'].filter(Boolean) as string[];
  const lien = d.paymentMethod !== 'CASH';

  return (
    <div className="pb-24">
      <PageHeader
        back="/dealer/deals"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {d.dealNumber ? `Deal ${d.dealNumber}` : 'Sell car'}
            {d.status && <Badge color={d.status === 'COMPLETED' ? 'green' : 'amber'}>{d.status === 'COMPLETED' ? 'Completed' : 'Draft'}</Badge>}
          </span>
        }
        desc={vName}
        actions={
          d.id ? (
            <Button variant="ghost" onClick={() => setConfirmDel(true)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : null
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {/* vehicle + dealer */}
          <Card title="Vehicle">
            <div className={g4}>
              <Info label="Vehicle" value={vName} />
              <Info label="VIN" value={v.vin} mono />
              <Info label="Stock #" value={v.stockNumber} />
              <Info label="Color / body" value={[v.exteriorColor, v.bodyStyle].filter(Boolean).join(' · ')} />
            </div>
            {dealer && (
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                Seller: <b className="text-slate-700">{dealer.legalName || dealer.name}</b>
                {dealer.address && ` · ${dealer.address}`}
                {' · '}
                {dealer.licenseNumber ? (
                  `Dealer license ${dealer.licenseNumber}`
                ) : (
                  <Link href="/dealer/business" className="font-semibold text-amber-700 hover:underline">
                    Add your dealer license number in Business details
                  </Link>
                )}
              </p>
            )}
          </Card>

          {/* buyer */}
          <Card
            title="Buyer"
            actions={
              <Button size="sm" onClick={() => setScan(true)}>
                <CreditCard className="h-4 w-4" /> Scan driver’s license
              </Button>
            }
          >
            <div className="space-y-4">
              <div className={g3}>
                <Field label="First name">
                  <Input value={d.buyerFirstName} onChange={(e) => setName('buyerFirstName', e.target.value)} />
                </Field>
                <Field label="Middle name">
                  <Input value={d.buyerMiddleName} onChange={(e) => setName('buyerMiddleName', e.target.value)} />
                </Field>
                <Field label="Last name">
                  <Input value={d.buyerLastName} onChange={(e) => setName('buyerLastName', e.target.value)} />
                </Field>
              </div>
              <div className={g3}>
                <Field label="Full legal name" className="sm:col-span-1">
                  <Input value={d.buyerFullName} onChange={(e) => set('buyerFullName', e.target.value)} />
                </Field>
                <Field label="Phone">
                  <Input type="tel" value={d.buyerPhone} onChange={(e) => set('buyerPhone', e.target.value)} />
                </Field>
                <Field label="Email">
                  <Input type="email" value={d.buyerEmail} onChange={(e) => set('buyerEmail', e.target.value)} />
                </Field>
              </div>
              <Field label="Street address">
                <Input value={d.buyerAddress} onChange={(e) => set('buyerAddress', e.target.value)} />
              </Field>
              <div className={g4}>
                <Field label="City">
                  <Input value={d.buyerCity} onChange={(e) => set('buyerCity', e.target.value)} />
                </Field>
                <Field label="State">
                  <StateSelect value={d.buyerState} onChange={(x) => set('buyerState', x)} />
                </Field>
                <Field label="ZIP">
                  <Input value={d.buyerZip} onChange={(e) => set('buyerZip', e.target.value)} />
                </Field>
                <Field label="County / city" hint="Where the car is kept">
                  <Input value={d.buyerCounty} onChange={(e) => set('buyerCounty', e.target.value)} />
                </Field>
              </div>
              <div className={g4}>
                <Field label="Driver’s license no.">
                  <Input value={d.buyerLicenseNumber} onChange={(e) => set('buyerLicenseNumber', e.target.value.toUpperCase())} />
                </Field>
                <Field label="License state">
                  <StateSelect value={d.buyerLicenseState} onChange={(x) => set('buyerLicenseState', x)} />
                </Field>
                <Field label="License expires">
                  <Input type="date" value={d.buyerLicenseExpiry} onChange={(e) => set('buyerLicenseExpiry', e.target.value)} />
                </Field>
                <Field label="Date of birth">
                  <Input type="date" value={d.buyerDob} onChange={(e) => set('buyerDob', e.target.value)} />
                </Field>
              </div>
              <Toggle checked={coBuyer} onChange={setCoBuyer} label="Add a co-buyer" />
              {coBuyer && (
                <div className="space-y-4 rounded-xl bg-slate-50 p-4">
                  <div className={g3}>
                    <Field label="Co-buyer full name">
                      <Input value={d.coBuyerFullName} onChange={(e) => set('coBuyerFullName', e.target.value)} />
                    </Field>
                    <Field label="Phone">
                      <Input type="tel" value={d.coBuyerPhone} onChange={(e) => set('coBuyerPhone', e.target.value)} />
                    </Field>
                    <Field label="Driver’s license no.">
                      <Input value={d.coBuyerLicenseNumber} onChange={(e) => set('coBuyerLicenseNumber', e.target.value.toUpperCase())} />
                    </Field>
                  </div>
                  <Field label="Address">
                    <Input value={d.coBuyerAddress} onChange={(e) => set('coBuyerAddress', e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
          </Card>

          {/* price */}
          <Card title="Price & trade-in">
            <div className="space-y-4">
              <div className={g4}>
                <Field label="Sale price">
                  <Money value={d.salePrice} onChange={(x) => set('salePrice', x)} />
                </Field>
                <Field label="Doc / processing fee">
                  <Money value={d.docFee} onChange={(x) => set('docFee', x)} />
                </Field>
                <Field label="Title & registration">
                  <Money value={d.titleRegFee} onChange={(x) => set('titleRegFee', x)} />
                </Field>
                <Field label="Down payment">
                  <Money value={d.downPayment} onChange={(x) => set('downPayment', x)} />
                </Field>
              </div>
              <div className={g4}>
                <Field label="Other fees">
                  <Money value={d.otherFees} onChange={(x) => set('otherFees', x)} />
                </Field>
                <Field label="Other fees label">
                  <Input value={d.otherFeesLabel} onChange={(e) => set('otherFeesLabel', e.target.value)} placeholder="e.g. Temp tags" />
                </Field>
                <Field label="Sales tax rate %" hint={d.stateCode === 'VA' ? 'VA: 4.15%, min $75' : undefined}>
                  <Input inputMode="decimal" value={String(d.salesTaxRate)} onChange={(e) => set('salesTaxRate', e.target.value.replace(/[^0-9.]/g, ''))} />
                </Field>
                <Group
                  label={
                    <span className="flex items-center justify-between gap-2">
                      Sales tax
                      <button type="button" className="text-[11px] font-semibold text-blue-700 hover:underline" onClick={() => set('salesTaxManual', !d.salesTaxManual)}>
                        {d.salesTaxManual ? 'Auto' : 'Edit'}
                      </button>
                    </span>
                  }
                >
                  <Money value={d.salesTaxManual ? d.salesTaxAmount : t.tax.toFixed(2)} disabled={!d.salesTaxManual} onChange={(x) => set('salesTaxAmount', x)} />
                </Group>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Trade-in (optional)</p>
                <div className={g4}>
                  <Field label="Allowance">
                    <Money value={d.tradeInAllowance} onChange={(x) => set('tradeInAllowance', x)} />
                  </Field>
                  <Field label="Payoff owed">
                    <Money value={d.tradeInPayoff} onChange={(x) => set('tradeInPayoff', x)} />
                  </Field>
                  <Field label="Year">
                    <Input value={trade.year || ''} onChange={(e) => set('tradeInVehicle', { ...trade, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                  </Field>
                  <Field label="Mileage">
                    <Input value={trade.mileage || ''} onChange={(e) => set('tradeInVehicle', { ...trade, mileage: e.target.value.replace(/\D/g, '') })} />
                  </Field>
                </div>
                <div className={cx(g3, 'mt-4')}>
                  <Field label="Make">
                    <Input value={trade.make || ''} onChange={(e) => set('tradeInVehicle', { ...trade, make: e.target.value })} />
                  </Field>
                  <Field label="Model">
                    <Input value={trade.model || ''} onChange={(e) => set('tradeInVehicle', { ...trade, model: e.target.value })} />
                  </Field>
                  <Field label="VIN">
                    <Input value={trade.vin || ''} onChange={(e) => set('tradeInVehicle', { ...trade, vin: e.target.value.toUpperCase().slice(0, 17) })} />
                  </Field>
                </div>
              </div>
            </div>
          </Card>

          {/* payment */}
          <Card title="Payment">
            <div className="space-y-4">
              <Radio
                value={d.paymentMethod}
                onChange={(x) => set('paymentMethod', x)}
                options={[
                  ['CASH', 'Cash'],
                  ['FINANCE', 'Financed'],
                  ['OUTSIDE_LIEN', 'Outside lien'],
                ]}
              />
              {lien && (
                <div className={g3}>
                  <Field label="Lienholder name">
                    <Input value={d.lienholderName} onChange={(e) => set('lienholderName', e.target.value)} />
                  </Field>
                  <Field label="Lienholder address">
                    <Input value={d.lienholderAddress} onChange={(e) => set('lienholderAddress', e.target.value)} />
                  </Field>
                  <Field label="Lien date">
                    <Input type="date" value={d.lienDate} onChange={(e) => set('lienDate', e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
          </Card>

          {/* disclosures */}
          <Card title="Odometer & warranty">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
                <Field label="Odometer (miles)">
                  <Input inputMode="numeric" value={d.odometerReading === null ? '' : String(d.odometerReading)} onChange={(e) => set('odometerReading', e.target.value.replace(/\D/g, ''))} />
                </Field>
                <Group label="Odometer status">
                  <Radio
                    value={d.odometerStatus}
                    onChange={(x) => set('odometerStatus', x)}
                    options={[
                      ['ACTUAL', 'Actual mileage'],
                      ['EXCEEDS_LIMITS', 'Exceeds mechanical limits'],
                      ['NOT_ACTUAL', 'Not actual mileage'],
                    ]}
                  />
                </Group>
              </div>
              <Group label="Warranty">
                <Radio
                  value={d.warrantyType}
                  onChange={(x) => set('warrantyType', x)}
                  options={[
                    ['AS_IS', 'As is - no dealer warranty'],
                    ['WARRANTY', 'Dealer warranty'],
                  ]}
                />
              </Group>
              {d.warrantyType === 'WARRANTY' && (
                <div className="space-y-4 rounded-xl bg-slate-50 p-4">
                  <Radio
                    value={d.warrantyKind}
                    onChange={(x) => set('warrantyKind', x)}
                    options={[
                      ['LIMITED', 'Limited'],
                      ['FULL', 'Full'],
                    ]}
                  />
                  <div className={g2}>
                    <Field label="Systems covered">
                      <Input value={d.warrantySystemsCovered} onChange={(e) => set('warrantySystemsCovered', e.target.value)} placeholder="e.g. Engine, transmission" />
                    </Field>
                    <Field label="Duration">
                      <Input value={d.warrantyDuration} onChange={(e) => set('warrantyDuration', e.target.value)} placeholder="e.g. 30 days or 1,000 miles" />
                    </Field>
                  </div>
                  {d.warrantyKind === 'LIMITED' && (
                    <div className={g4}>
                      <Field label="Labor paid %">
                        <Input inputMode="numeric" value={d.warrantyLaborPct} onChange={(e) => set('warrantyLaborPct', e.target.value.replace(/\D/g, '').slice(0, 3))} />
                      </Field>
                      <Field label="Parts paid %">
                        <Input inputMode="numeric" value={d.warrantyPartsPct} onChange={(e) => set('warrantyPartsPct', e.target.value.replace(/\D/g, '').slice(0, 3))} />
                      </Field>
                    </div>
                  )}
                </div>
              )}
              <Toggle checked={d.serviceContract} onChange={(x) => set('serviceContract', x)} label="Service contract offered" />
            </div>
          </Card>

          {/* title */}
          <Card title="Title & registration (VA VSA 17A)">
            <div className="space-y-4">
              <Radio
                value={d.titlePurpose}
                onChange={(x) => set('titlePurpose', x)}
                options={[
                  ['TITLE_AND_REGISTRATION', 'Title & registration'],
                  ['TITLE_ONLY', 'Title only'],
                  ['TRANSFER_PLATE', 'Transfer plate'],
                ]}
              />
              <div className={g4}>
                <Field label="Sale date">
                  <Input type="date" value={d.saleDate} onChange={(e) => set('saleDate', e.target.value)} />
                </Field>
                <Field label="Plate no.">
                  <Input value={d.plateNumber} onChange={(e) => set('plateNumber', e.target.value.toUpperCase())} />
                </Field>
                <Field label="GVWR / weight">
                  <Input value={d.gvwr} onChange={(e) => set('gvwr', e.target.value)} />
                </Field>
                <Field label="Title state">
                  <StateSelect value={d.stateCode} onChange={(x) => set('stateCode', x)} />
                </Field>
              </div>
              <Field label="Notes (printed on the bill of sale)">
                <Textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>

        {/* summary + forms */}
        <div className="space-y-5 xl:sticky xl:top-4">
          <Card title="Summary">
            <dl className="space-y-1.5 text-sm">
              <Row k="Sale price" v={usd(num(d.salePrice))} />
              {num(d.tradeInAllowance) > 0 && <Row k="Trade-in" v={`− ${usd(num(d.tradeInAllowance))}`} />}
              {num(d.tradeInPayoff) > 0 && <Row k="Trade-in payoff" v={usd(num(d.tradeInPayoff))} />}
              <Row k="Doc fee" v={usd(num(d.docFee))} />
              <Row k="Title & registration" v={usd(num(d.titleRegFee))} />
              {num(d.otherFees) > 0 && <Row k={d.otherFeesLabel || 'Other fees'} v={usd(num(d.otherFees))} />}
              <Row k={`Sales tax (${num(d.salesTaxRate)}%)`} v={usd(t.tax)} />
              <Row k="Total" v={usd(t.total)} strong />
              <Row k="Down payment" v={`− ${usd(num(d.downPayment))}`} />
              <Row k="Balance due" v={usd(t.balance)} strong />
            </dl>
          </Card>

          <Card title="Deal forms">
            {missing.length > 0 && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Missing: {missing.join(', ')}</p>}
            <ul className="divide-y divide-slate-100">
              {FORMS.map((f) => (
                <li key={f.kind} className="flex items-center justify-between gap-2 py-2">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
                    <FileText className="h-4 w-4 text-slate-400" /> {f.title}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" title="Open to print" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40" disabled={!!busyPdf} onClick={() => pdf(f.kind, 'open')}>
                      <Printer className="h-4 w-4" />
                    </button>
                    <button type="button" title="Download PDF" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40" disabled={!!busyPdf} onClick={() => pdf(f.kind, 'download')}>
                      <Download className="h-4 w-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <Button className="mt-3 w-full" variant="secondary" loading={busyPdf === 'packetdownload'} disabled={!!busyPdf} onClick={() => pdf('packet', 'download')}>
              <Download className="h-4 w-4" /> Download complete deal packet
            </Button>
          </Card>
        </div>
      </div>

      {/* action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:pl-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-slate-500">{dirty ? 'Unsaved changes' : d.id ? 'All changes saved' : ''}</span>
          <Button variant="secondary" loading={saving} disabled={!dirty} onClick={() => save()}>
            <Save className="h-4 w-4" /> Save draft
          </Button>
          <Button variant="success" disabled={saving} onClick={() => setFinish(true)}>
            <CheckCircle2 className="h-4 w-4" /> Generate deal forms
          </Button>
        </div>
      </div>

      <LicenseScanner open={scan} onClose={() => setScan(false)} onApply={applyLicense} />

      <Modal
        open={finish}
        onClose={() => setFinish(false)}
        title="Generate deal forms"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFinish(false)}>
              Cancel
            </Button>
            <Button variant="success" loading={saving} onClick={complete}>
              Complete deal
            </Button>
          </>
        }
      >
        <p>The deal is saved and marked as completed. Then download or print the forms on the right.</p>
        {missing.length > 0 && <p className="mt-2 text-amber-700">Still missing: {missing.join(', ')}.</p>}
        {d.vehicleId && (
          <label className="mt-4 flex items-center gap-2 font-medium text-slate-800">
            <input type="checkbox" className="h-4 w-4 accent-blue-700" checked={markSold} onChange={(e) => setMarkSold(e.target.checked)} />
            Mark this vehicle as sold (hides it from the website)
          </label>
        )}
      </Modal>

      <Modal
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title="Delete this deal?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDel(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove}>
              Delete deal
            </Button>
          </>
        }
      >
        The deal record is removed. The vehicle is not changed.
      </Modal>
    </div>
  );
}

/** like Field, but not a <label> (holds buttons) */
function Group({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value?: unknown; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('mt-0.5 truncate text-sm font-semibold text-slate-900', mono && 'font-mono')}>{String(value ?? '') || '—'}</div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cx('flex justify-between gap-3', strong && 'border-t border-slate-200 pt-1.5 font-bold text-slate-900')}>
      <dt className={strong ? '' : 'text-slate-500'}>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
