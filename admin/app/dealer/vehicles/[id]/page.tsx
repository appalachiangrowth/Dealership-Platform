'use client';

import { useParams } from 'next/navigation';
import { useApi } from '@/lib/useApi';
import { ErrorBox, Loading } from '@/components/ui';
import { EMPTY_VEHICLE, VehicleForm } from '@/components/VehicleForm';

export default function EditVehicle() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useApi(`/dealer/vehicles/${id}`);
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
  return <VehicleForm key={data.id} initial={v as never} />;
}
