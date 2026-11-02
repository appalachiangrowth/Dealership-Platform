'use client';

import { EMPTY_VEHICLE, VehicleForm } from '@/components/VehicleForm';

export default function NewVehicle() {
  return <VehicleForm initial={EMPTY_VEHICLE} />;
}
