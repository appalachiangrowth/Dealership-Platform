'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FileSignature } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { ErrorBox, Loading } from '@/components/ui';
import { EMPTY_VEHICLE, VehicleForm } from '@/components/VehicleForm';

/** Inventory › edit vehicle. ?focus=<field> opens the form on that field (CarGurus "Fix" links). */
export default function EditVehicle() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useApi(`/dealer/vehicles/${id}`);
  const [focus, setFocus] = useState<string | undefined>();
  useEffect(() => setFocus(new URLSearchParams(window.location.search).get('focus') || undefined), [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  let extraFee = data.processingFee ?? '';
  if (!extraFee && data.extra) {
    let ex = data.extra;
    if (typeof ex === 'string') {
      try { ex = JSON.parse(ex); } catch {}
    }
    if (ex && typeof ex === 'object') {
      extraFee = ex.processingFee || ex.processing_fee || '';
    }
  }
  const v = { ...EMPTY_VEHICLE, ...Object.fromEntries(Object.entries(data).map(([k, x]) => [k, x === null ? '' : x])), processingFee: extraFee };
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Link
          href={`/dealer/deals/new?vehicleId=${data.id}`}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
        >
          <FileSignature className="h-4 w-4" /> Sell car / Bill of Sale
        </Link>
      </div>
      <VehicleForm key={data.id} initial={v as never} focusField={focus} />
    </>
  );
}
