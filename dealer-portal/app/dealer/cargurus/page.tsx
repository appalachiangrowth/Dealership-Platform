'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Car, CheckCircle2, Download, ImageIcon } from 'lucide-react';
import { download, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Button, ErrorBox, LinkButton, Loading, PageHeader, cx } from '@/components/ui';
import { dateTime, money } from '@/lib/format';

type Issue = { field: string; label: string; msg: string };
type Row = { id: string; name: string; vin: string; stock: string; price: number | null; mileage: number | null; photos: number; image: string; live?: boolean; issues?: Issue[] };

const SYNC: Record<string, string> = {
  uploaded: 'sent to CarGurus',
  not_configured: 'approved, CarGurus delivery not set up yet',
  failed: 'upload failed, the platform team is on it',
};

function Thumb({ u }: { u: string }) {
  return (
    <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
      {u ? <img src={mediaUrl(u)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-slate-400" />}
    </span>
  );
}

function Tile({ k, n, sub, tone, small }: { k: string; n: React.ReactNode; sub: string; tone?: 'ok' | 'bad'; small?: boolean }) {
  return (
    <div className={cx('rounded-2xl border bg-white p-4 shadow-sm', tone === 'ok' ? 'border-emerald-200' : tone === 'bad' ? 'border-red-200' : 'border-slate-200')}>
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{k}</span>
      <b className={cx('mt-1 block font-heading font-extrabold', small ? 'text-base' : 'text-3xl', tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-slate-900')}>{n}</b>
      <small className="mt-1 block text-xs text-slate-500">{sub}</small>
    </div>
  );
}

/** Dealership Portal › CarGurus feed — read only, built from Inventory automatically (like the old portal). */
export default function CarGurusFeedPage() {
  const { data: M, loading, error, reload } = useApi('/dealer/feeds/cargurus/monitor');
  const [tab, setTab] = useState<'ready' | 'attention' | ''>('');
  const toast = useToast();

  if (loading && !M) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!M) return null;
  const ready: Row[] = M.ready;
  const attention: Row[] = M.attention;
  const t = tab || (ready.length || !attention.length ? 'ready' : 'attention');
  const ap = M.approved;
  const sync = M.lastSync;
  const syncTxt = ap ? `${dateTime(ap.at)}${sync ? ' · ' + (SYNC[sync.status] || (sync.sent ? SYNC.uploaded : sync.reason || '')) : ''}` : 'Not sent yet';
  const dl = M.dealer || {};

  return (
    <>
      <PageHeader
        title="CarGurus feed"
        desc="A read-only view of what goes to CarGurus. It is built from your Inventory automatically: add or fix vehicles there."
        actions={
          <LinkButton href="/dealer/inventory" variant="secondary">
            <Car className="h-4 w-4" /> Open Inventory
          </LinkButton>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile tone="ok" k="Active on CarGurus feed" n={M.liveCount} sub="vehicles in the feed CarGurus receives" />
        <Tile k="Ready" n={ready.length} sub={M.pending ? `queued for verification since ${dateTime(M.pending.at)}` : 'meet every CarGurus requirement'} />
        <Tile tone={attention.length ? 'bad' : undefined} k="Excluded · action required" n={attention.length} sub={attention.length ? 'missing CarGurus mandatory fields' : 'nothing to fix'} />
        <Tile small k="Last feed sent" n={syncTxt} sub={ap ? `${ap.vehicles} vehicle${ap.vehicles === 1 ? '' : 's'} approved` : 'the first feed goes out after verification'} />
      </div>

      {M.dealerWarnings.length > 0 && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <b>Your dealer details need attention before CarGurus can list your cars:</b> {M.dealerWarnings.join(' · ')}{' '}
          <Link href="/dealer/business" className="font-semibold underline">
            Open Business details
          </Link>
        </div>
      )}

      <div className="mt-6 flex gap-2 border-b border-slate-200">
        {(
          [
            ['ready', 'Ready on feed', ready.length, 'bg-emerald-500'],
            ['attention', 'Needs attention to syndicate', attention.length, 'bg-red-500'],
          ] as const
        ).map(([k, l, n, dot]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cx('-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold', t === k ? 'border-blue-700 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800')}
          >
            <i className={cx('h-2 w-2 rounded-full', dot)} />
            {l}
            <span className="rounded-full bg-slate-100 px-2 text-xs">{n}</span>
          </button>
        ))}
      </div>

      {t === 'ready' ? (
        <>
          <p className="my-3 text-sm font-semibold text-emerald-700">These vehicles meet all CarGurus standards and are automatically syndicated in your daily feed.</p>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">VIN</th>
                  <th className="px-4 py-3">Stock #</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Mileage</th>
                  <th className="px-4 py-3">Photos</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ready.length ? (
                  ready.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Thumb u={r.image} />
                          <b className="text-slate-900">{r.name}</b>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.vin}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.stock}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{money(r.price)}</td>
                      <td className="px-4 py-3 text-right">{Number(r.mileage || 0).toLocaleString('en-US')} mi</td>
                      <td className="px-4 py-3">{r.photos}</td>
                      <td className="px-4 py-3">
                        {r.live ? (
                          <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">● On CarGurus</span>
                        ) : (
                          <span className="whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200">● Queued · being verified</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <Car className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                      <b className="block text-slate-800">No vehicle is ready for CarGurus yet</b>
                      <span className="text-sm text-slate-500">Fix the vehicles under “Needs attention”, or add vehicles in Inventory.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <p className="my-3 text-sm font-semibold text-red-700">These vehicles are on your website but CarGurus does not accept them yet. Fix what is listed and they join the feed automatically.</p>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">What is missing</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attention.length ? (
                  attention.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Thumb u={r.image} />
                          <div className="min-w-0">
                            <b className="block text-slate-900">{r.name || 'Vehicle'}</b>
                            <span className="font-mono text-xs text-slate-500">{[r.vin, r.stock].filter(Boolean).join(' · ') || 'no VIN / stock'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ul className="space-y-1">
                          {(r.issues || []).map((x, i) => (
                            <li key={i}>
                              <b className="mr-1.5 text-slate-800">{x.label}</b>
                              <span className="text-red-700">{x.msg.replace(/ - https?:\/\/\S+$/, '')}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <LinkButton size="sm" href={`/dealer/inventory/${r.id}?focus=${encodeURIComponent(r.issues?.[0]?.field || '')}`}>
                          Fix in Inventory
                        </LinkButton>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center">
                      <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                      <b className="block text-slate-800">Nothing to fix</b>
                      <span className="text-sm text-slate-500">Every vehicle for sale meets the CarGurus requirements.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600">
        <b className="text-slate-800">Added to every CarGurus row automatically:</b> Dealer ID <span className="font-mono">{dl.id || '—'}</span> · {dl.name || '—'} ·{' '}
        {[dl.street, dl.city, dl.state, dl.zip].filter(Boolean).join(', ') || 'address missing'} · {dl.crmEmail || 'no CRM email'}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600">
        <b className="text-slate-800">Your inventory feeds:</b>
        <a href={M.xmlUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-700 underline">
          {M.xmlUrl}
        </a>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => download('/dealer/feeds/inventory.xml', 'inventory.xml').catch((e) => toast.error((e as Error).message))}
        >
          <Download className="h-3.5 w-3.5" /> Inventory XML
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => download('/dealer/feeds/cargurus-inventory.csv', 'cargurus-inventory.csv').catch((e) => toast.error((e as Error).message))}
        >
          <Download className="h-3.5 w-3.5" /> CarGurus-ready CSV
        </Button>
      </div>
    </>
  );
}
