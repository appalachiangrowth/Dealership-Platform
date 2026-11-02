'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';

export default function NewDealer() {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ name: '', id: '', domains: '', themeId: 'classic', notes: '', login: '', password: '', adminName: '', email: '' });
  const [themes, setThemes] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api('/platform/themes').then((r) => setThemes(r.themes)).catch(() => {});
    if (typeof window !== 'undefined' && location.hostname && !location.hostname.startsWith('admin.') && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      setF((x) => ({ ...x, domains: location.hostname }));
    }
  }, []);

  return (
    <>
      <PageHeader back="/platform/dealers" title="Add dealership" desc="Creates the dealership, its website and its first Dealership admin login." />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const t = await api('/platform/tenants', {
              body: {
                name: f.name,
                id: f.id || undefined,
                domains: f.domains,
                themeId: f.themeId,
                notes: f.notes,
                admin: f.login ? { login: f.login, password: f.password, name: f.adminName, email: f.email || f.login } : undefined,
              },
            });
            toast.ok('Dealership created');
            router.replace(`/platform/dealers/${t.id}`);
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className="grid max-w-4xl gap-6 lg:grid-cols-2"
      >
        <Card title="Dealership">
          <div className="space-y-4">
            <Field label="Dealership name">
              <Input value={f.name} onChange={set('name')} required />
            </Field>
            <Field label="Id (optional)" hint="Lower-case letters, digits, dashes. Used in addresses like <id>.localhost. Empty = from the name.">
              <Input value={f.id} onChange={set('id')} />
            </Field>
            <Field label="Domains" hint="e.g. bluemotors.com, www.bluemotors.com — point them at the frontend server.">
              <Input value={f.domains} onChange={set('domains')} />
            </Field>
            <Field label="Design">
              <Select value={f.themeId} onChange={set('themeId')}>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Internal note">
              <Input value={f.notes} onChange={set('notes')} />
            </Field>
          </div>
        </Card>
        <Card title="First Dealership admin (optional)">
          <div className="space-y-4">
            <Field label="Name">
              <Input value={f.adminName} onChange={set('adminName')} />
            </Field>
            <Field label="Login (email)">
              <Input value={f.login} onChange={set('login')} />
            </Field>
            <Field label="Password" hint="At least 8 characters. Give it to the dealer with the admin link.">
              <Input type="password" value={f.password} onChange={set('password')} minLength={f.login ? 8 : 0} required={!!f.login} />
            </Field>
          </div>
        </Card>
        <div className="lg:col-span-2">
          <Button type="submit" loading={busy}>
            Create dealership
          </Button>
        </div>
      </form>
    </>
  );
}
