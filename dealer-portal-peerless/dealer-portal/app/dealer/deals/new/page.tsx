'use client';

import { useEffect, useState } from 'react';
import { Car, Search } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ErrorBox, Input, Loading, PageHeader } from '@/components/ui';
import { DealForm } from '@/components/deals/DealForm';
import { EMPTY_DEAL, usd, type Deal } from '@/lib/deals';

/** Sell car: /dealer/deals/new?vehicleId=… opens the form pre-filled; without a vehicle, pick one first. */
export default function NewDealPage() {
  const [vehicleId, setVehicleId] = useState<string | null | undefined>(undefined);
  useEffect(() => setVehicleId(new URLSearchParams(window.location.search).get('vehicleId')), []);
  if (vehicleId === undefined) return <Loading />;
  return vehicleId ? (
    <Prefilled vehicleId={vehicleId} />
  ) : (
    <PickVehicle
      onPick={(id) => {
        window.history.replaceState(null, '', `${window.location.pathname}?vehicleId=${encodeURIComponent(id)}`);
        setVehicleId(id);
      }}
    />
  );
}

function Prefilled({ vehicleId }: { vehicleId: string }) {
  const [state, setState] = useState<{ deal: Deal; dealer: any } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/dealer/deals/new?vehicleId=${encodeURIComponent(vehicleId)}`)
      .then((r) => setState({ deal: { ...EMPTY_DEAL, ...r.deal }, dealer: r.dealer }))
      .catch((e) => setError(e.message));
  }, [vehicleId]);
  if (error) return <ErrorBox error={error} />;
  if (!state) return <Loading />;
  return <DealForm initial={state.deal} dealer={state.dealer} />;
}

function PickVehicle({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const { data, loading, error } = useApi(`/dealer/vehicles?pageSize=100&q=${encodeURIComponent(term)}`, [term]);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const items: any[] = (data?.items || []).filter((v: any) => v.status !== 'SOLD');
  return (
    <>
      <PageHeader back="/dealer/deals" title="Sell car" desc="Choose the vehicle you are selling." />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" autoFocus placeholder="Search make, model, VIN or stock #" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !items.length ? (
        <p className="text-sm text-slate-500">No vehicles found.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((v) => (
            <button key={v.id} type="button" onClick={() => onPick(v.id)} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-400 hover:shadow-sm">
              <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                {v.images?.[0] ? <img src={mediaUrl(v.images[0])} alt="" className="h-full w-full object-cover" /> : <Car className="h-4 w-4 text-slate-400" />}
              </div>
              <div className="min-w-0">
                <b className="block truncate text-sm text-slate-900">{[v.year, v.make, v.model, v.trim].filter(Boolean).join(' ')}</b>
                <div className="truncate text-xs text-slate-500">
                  {v.stockNumber ? `#${v.stockNumber} · ` : ''}
                  {v.price ? usd(Number(v.price)) : 'No price'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
