'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, auth, DEALER_PORTAL_URL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthCard } from '@/components/AuthCard';
import { Button, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { reload } = useSession();
  const portal = 'platform';
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [choices, setChoices] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/setup-status')
      .then((s) => {
        if (s.needsSetup) router.replace('/setup');
      })
      .catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent, tenantId?: string) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/auth/login', { body: { login, password, portal, tenantId } });
      auth.clear();
      auth.setToken(r.token);
      await reload();
      router.replace('/platform');
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.status === 409 && (e2.data as any)?.dealerships) setChoices((e2.data as any).dealerships);
      else setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Platform Admin"
      desc="For platform owners only."
      footer={
        <>
          Dealer?{' '}
          <a href={DEALER_PORTAL_URL} className="font-semibold text-white underline">
            Go to the Dealership Portal
          </a>
        </>
      }
    >
      {choices.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">This login belongs to several dealerships. Which one?</p>
          {choices.map((c) => (
            <Button key={c.id} variant="secondary" className="w-full" onClick={(e) => submit(e as unknown as React.FormEvent, c.id)}>
              {c.name}
            </Button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email or login">
            <Input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" loading={busy} className="w-full py-2.5">
            Log in
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
