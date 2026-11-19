'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useToast } from './toast';
import { Button, Card, Field, Input, PageHeader } from './ui';

export function AccountForm() {
  const { me } = useSession();
  const toast = useToast();
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeader title="Your account" desc={`Logged in as ${me?.user.login}`} />
      <Card title="Change password" className="max-w-lg">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (f.password !== f.confirm) return toast.error('The new passwords do not match');
            setBusy(true);
            try {
              await api('/auth/change-password', { body: { current: f.current, password: f.password } });
              toast.ok('Password changed');
              setF({ current: '', password: '', confirm: '' });
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Current password">
            <Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <Input type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
          </Field>
          <Field label="Repeat new password">
            <Input type="password" minLength={8} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />
          </Field>
          <Button type="submit" loading={busy}>
            Change password
          </Button>
        </form>
      </Card>
    </>
  );
}
