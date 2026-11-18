'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';
import { DealForm } from '@/components/deals/DealForm';
import { EMPTY_DEAL, type Deal } from '@/lib/deals';

/** Deals › one deal (edit, complete, print the forms) */
export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<{ deal: Deal; dealer: any } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api(`/dealer/deals/${id}`), api('/dealer/deals/new')])
      .then(([deal, pre]) => {
        const nul = Object.fromEntries(Object.entries(deal).map(([k, v]) => [k, v === null && k !== 'odometerReading' && k !== 'vehicleId' ? '' : v]));
        setState({ deal: { ...EMPTY_DEAL, ...nul } as Deal, dealer: pre.dealer });
      })
      .catch((e) => setError(e.message));
  }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!state) return <Loading />;
  return <DealForm key={id} initial={state.deal} dealer={state.dealer} />;
}
