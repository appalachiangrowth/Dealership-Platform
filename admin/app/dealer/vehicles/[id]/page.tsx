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
  const extraFee = data.extra && typeof data.extra === 'object' ? data.extra.processingFee || data.extra.processing_fee || '' : '';
  const v = { ...EMPTY_VEHICLE, processingFee: extraFee, ...Object.fromEntries(Object.entries(data).map(([k, x]) => [k, x === null ? '' : x])) };
  if (extraFee && !v.processingFee) v.processingFee = extraFee;
  return <VehicleForm key={data.id} initial={v as never} />;
}
