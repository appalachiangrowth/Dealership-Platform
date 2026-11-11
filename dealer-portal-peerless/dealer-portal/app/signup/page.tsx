'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, auth } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthCard } from '@/components/AuthCard';
import { Button, Field, Input } from '@/components/ui';

export default function SignupPage() {
  const router = useRouter();
  const { reload } = useSession();
  const [f, setF] = useState({ dealershipName: '', name: '', email: '', phone: '', password: '', website: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/auth/signup', { body: f });
      if (r.token) {
        auth.clear();
        auth.setToken(r.token);
        await reload();
        router.replace('/dealer?welcome=1');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Create your dealership account"
      desc="Your website is ready in a minute. You can add your details, vehicles and design right after."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-white underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Dealership name">
          <Input value={f.dealershipName} onChange={set('dealershipName')} required placeholder="Blue Ridge Motors" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your name">
            <Input value={f.name} onChange={set('name')} required />
          </Field>
          <Field label="Phone (optional)">
            <Input value={f.phone} onChange={set('phone')} />
          </Field>
        </div>
        <Field label="Email" hint="You log in with this email. Inquiries are sent here too.">
          <Input type="email" value={f.email} onChange={set('email')} required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input type="password" value={f.password} onChange={set('password')} minLength={8} required />
        </Field>
        <input type="text" name="website" value={f.website} onChange={set('website')} className="hidden" tabIndex={-1} autoComplete="off" />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" loading={busy} variant="success" className="w-full py-2.5">
          Create my dealership
        </Button>
      </form>
    </AuthCard>
  );
}
