'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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
  const v = { ...EMPTY_VEHICLE, ...Object.fromEntries(Object.entries(data).map(([k, x]) => [k, x === null ? '' : x])) };
  return <VehicleForm key={data.id} initial={v as never} focusField={focus} />;
}
