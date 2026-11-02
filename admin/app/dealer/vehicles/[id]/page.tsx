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
  const v = { ...EMPTY_VEHICLE, ...Object.fromEntries(Object.entries(data).map(([k, x]) => [k, x === null ? '' : x])) };
  return <VehicleForm key={data.id} initial={v as never} />;
}
