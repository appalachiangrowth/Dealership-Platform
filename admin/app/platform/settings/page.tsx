'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Loading, PageHeader, Select, Tabs, Textarea, Toggle } from '@/components/ui';

export default function PlatformSettings() {
  const { data, setData, loading } = useApi('/platform/settings');
  const themes = useApi('/platform/themes');
  const [f, setF] = useState<any>(null);
  const [tab, setTab] = useState('mail');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (data) setF(JSON.parse(JSON.stringify(data)));
  }, [data]);
  if (loading || !f) return <Loading />;

  const set = (g: string, k: string, v: unknown) => setF({ ...f, [g]: { ...f[g], [k]: v } });
  const text = (g: string, k: string, label: string, hint?: string, type = 'text') => (
    <Field label={label} hint={hint}>
      <Input type={type} value={f[g][k] ?? ''} onChange={(e) => set(g, k, type === 'number' ? Number(e.target.value) : e.target.value)} />
    </Field>
  );
  const secret = (g: string, k: string, label: string) => {
    const v = f[g][k];
    const isSet = v && typeof v === 'object' && v.set;
    return (
      <Field label={label}>
        <div className="flex items-center gap-2">
          <Input type="password" placeholder={isSet ? '•••••••• saved — type to replace' : 'Not set'} value={typeof v === 'string' ? v : ''} onChange={(e) => set(g, k, e.target.value)} />
          {isSet && <Badge color="green">Saved</Badge>}
        </div>
      </Field>
    );
  };

  async function save(group: string) {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<any>(f[group])) if (!(v && typeof v === 'object' && 'set' in v)) patch[k] = v;
      setData(await api('/platform/settings', { method: 'PUT', body: { [group]: patch } }));
      toast.ok('Saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const SaveBtn = ({ g }: { g: string }) => (
    <Button size="sm" onClick={() => save(g)} loading={busy}>
      Save
    </Button>
  );

  return (
    <>
      <PageHeader title="Platform settings" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'mail', label: 'Mail server' },
          { id: 'signup', label: 'Sign-ups' },
          { id: 'feeds', label: 'Feeds' },
          { id: 'keys', label: 'Integrations' },
          { id: 'support', label: 'Support' },
        ]}
      />
      {tab === 'mail' && (
        <Card title="Mail server (SMTP)" actions={<SaveBtn g="smtp" />} className="max-w-3xl">
          <p className="mb-4 text-sm text-slate-500">Used for every dealership’s inquiries and replies, unless a dealer sets their own server.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {text('smtp', 'host', 'SMTP server', 'e.g. smtp.gmail.com')}
            {text('smtp', 'port', 'Port', undefined, 'number')}
            <Field label="Security">
              <Select value={f.smtp.secure} onChange={(e) => set('smtp', 'secure', e.target.value)}>
                <option value="ssl">SSL (465)</option>
                <option value="tls">STARTTLS (587)</option>
                <option value="none">None</option>
              </Select>
            </Field>
            {text('smtp', 'user', 'Username')}
            {secret('smtp', 'pass', 'Password / app password')}
            {text('smtp', 'from', 'From address', undefined, 'email')}
            {text('smtp', 'fromName', 'From name')}
          </div>
        </Card>
      )}
      {tab === 'signup' && (
        <Card title="New dealer sign-ups" actions={<SaveBtn g="signup" />} className="max-w-3xl">
          <div className="space-y-4">
            <Toggle checked={!!f.signup.enabled} onChange={(v) => set('signup', 'enabled', v)} label="Allow new dealers to create an account" />
            {text('signup', 'baseDomain', 'Sign-up domain', 'e.g. dealers.yourcompany.com — a new dealer gets <name>.dealers.yourcompany.com. Needs a wildcard DNS record and SSL.')}
            <Field label="Starting design">
              <Select value={f.signup.theme} onChange={(e) => set('signup', 'theme', e.target.value)}>
                {themes.data?.themes.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      )}
      {tab === 'feeds' && (
        <Card title="Feeds" actions={<SaveBtn g="feeds" />} className="max-w-3xl">
          <div className="space-y-4">
            <Toggle checked={!!f.feeds.inventoryXml} onChange={(v) => set('feeds', 'inventoryXml', v)} label="Public inventory.xml on every dealer website" />
            <Toggle checked={!!f.feeds.cargurusCron} onChange={(v) => set('feeds', 'cargurusCron', v)} label="Daily CarGurus FTP upload" desc="Time is set with CARGURUS_CRON_HOUR in the backend .env." />
            <Toggle checked={!!f.feeds.facebookPoster} onChange={(v) => set('feeds', 'facebookPoster', v)} label="Facebook poster downloads" />
          </div>
        </Card>
      )}
      {tab === 'keys' && (
        <Card title="Integrations" actions={<SaveBtn g="keys" />} className="max-w-3xl">
          <div className="grid gap-4 sm:grid-cols-2">
            {secret('keys', 'googleMaps', 'Google Maps API key')}
            {text('keys', 'facebookAppId', 'Facebook App ID')}
            {secret('keys', 'facebookAppSecret', 'Facebook App secret')}
            {text('keys', 'recaptchaSite', 'reCAPTCHA site key')}
            {secret('keys', 'recaptchaSecret', 'reCAPTCHA secret')}
          </div>
        </Card>
      )}
      {tab === 'support' && (
        <Card title="Support contact shown to dealers" actions={<SaveBtn g="support" />} className="max-w-3xl">
          <div className="grid gap-4 sm:grid-cols-2">
            {text('support', 'email', 'Email', undefined, 'email')}
            {text('support', 'phone', 'Phone')}
            <Field label="Note" className="sm:col-span-2">
              <Textarea value={f.support.note} onChange={(e) => set('support', 'note', e.target.value)} />
            </Field>
          </div>
        </Card>
      )}
    </>
  );
}
