'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthCard } from '@/components/AuthCard';
import { Loading } from '@/components/ui';

/**
 * Support mode hand-off. The Platform Admin (another app / address) opens
 *   <dealer portal>/support#token=<owner login token>&tenant=<dealership id>
 * The values are in the # part, so they are never sent to any server or written to logs.
 */
export default function SupportPage() {
  const router = useRouter();
  const { reload } = useSession();
  const [error, setError] = useState('');

  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = p.get('token') || '';
    const tenant = p.get('tenant') || '';
    history.replaceState(null, '', '/support');
    if (!token || !tenant) {
      setError('This support link is incomplete. Open the dealership again from the Platform Admin.');
      return;
    }
    auth.clear();
    auth.setToken(token);
    auth.setSupportTenant(tenant);
    void reload().then(() => router.replace('/dealer'));
  }, [reload, router]);

  if (!error) return <Loading />;
  return (
    <AuthCard title="Support mode" desc={error}>
      <p className="text-sm text-slate-500">You can close this tab.</p>
    </AuthCard>
  );
}
