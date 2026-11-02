'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, auth } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthCard } from '@/components/AuthCard';
import { Button, Field, Input, Loading } from '@/components/ui';

/** First run: create the platform owner account. */
export default function SetupPage() {
  const router = useRouter();
  const { reload } = useSession();
  const [status, setStatus] = useState<{ needsSetup: boolean; setupKeyRequired: boolean } | null>(null);
  const [f, setF] = useState({ name: '', login: '', password: '', setupKey: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/setup-status').then((s) => {
      if (!s.needsSetup) router.replace('/login');
      else setStatus(s);
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/auth/setup', { body: f });
      auth.setToken(r.token);
      await reload();
      router.replace('/platform/dealers/new?first=1');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <Loading />;
  return (
    <AuthCard title="Welcome! Your platform is installed." desc="Create the owner account. You will use it to add dealerships and manage the platform.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label="Login (email)">
          <Input value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        </Field>
        {status.setupKeyRequired && (
          <Field label="Setup key" hint="The SETUP_KEY from the backend .env file.">
            <Input value={f.setupKey} onChange={(e) => setF({ ...f, setupKey: e.target.value })} required />
          </Field>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" loading={busy} className="w-full py-2.5">
          Create owner account
        </Button>
      </form>
    </AuthCard>
  );
}
