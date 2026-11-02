'use client';

import { useSettings } from '@/lib/useSettings';
import { useTenant } from '@/components/DealerShell';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, Toggle } from '@/components/ui';

const KEYS = [
  'siteUrl', 'leadTo', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFrom', 'smtpFromName', 'maxUploadMb', 'brandImages', 'brandBandColor',
  'dealerCrmEmail', 'dealerCrmFormat', 'dealerRadius', 'feedOperation', 'feedCompleteBatch', 'feedToken', 'cargurusFtpHost', 'cargurusFtpUser', 'cargurusFtpPass',
  'cargurusFtpPort', 'cargurusFtpSsl', 'cargurusRemoteDir', 'cargurusRemoteName', 'themeColor',
];

export default function AdvancedPage() {
  const { form, set, save, saving, dirty, error } = useSettings(KEYS);
  const { tenant } = useTenant();
  if (error) return <ErrorBox error={error} />;
  if (!form) return <Loading />;
  const text = (k: string, label: string, hint?: string, type = 'text') => (
    <Field label={label} hint={hint}>
      <Input type={type} value={form[k] ?? ''} onChange={(e) => set(k, type === 'number' ? Number(e.target.value) : e.target.value)} />
    </Field>
  );
  const secret = (k: string, label: string, hint?: string) => {
    const v = form[k];
    const isSet = v && typeof v === 'object' && v.set;
    return (
      <Field label={label} hint={hint}>
        <div className="flex items-center gap-2">
          <Input type="password" placeholder={isSet ? '•••••••• (saved — type to replace)' : 'Not set'} value={typeof v === 'string' ? v : ''} onChange={(e) => set(k, e.target.value)} />
          {isSet && <Badge color="green">Saved</Badge>}
        </div>
      </Field>
    );
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await save();
      }}
    >
      <PageHeader
        title="Advanced settings"
        desc="Website address, your own email server, feeds and CarGurus FTP. Passwords are never shown again after saving."
        actions={
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save changes
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Website address">
          <div className="space-y-4">
            {text('siteUrl', 'Main website address', 'e.g. https://www.bluemotors.com — every image and vehicle link in your feeds uses it.')}
            <p className="text-xs text-slate-500">Dealer ID: <b>{tenant?.dealerCode}</b> (set by the platform). Connected domains: {tenant?.domains.join(', ') || 'none yet'}.</p>
            <Field label="Browser theme colour" hint="Colour of the address bar on phones.">
              <Input type="color" value={form.themeColor || '#062B49'} onChange={(e) => set('themeColor', e.target.value)} className="h-10 w-24 p-1" />
            </Field>
          </div>
        </Card>
        <Card title="Own email server (optional)">
          <p className="mb-4 text-xs text-slate-500">Leave empty to use the platform mail server. Inquiries are sent to {form.leadTo || 'your inquiry email'}.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {text('smtpHost', 'SMTP server')}
            {text('smtpPort', 'Port', undefined, 'number')}
            <Field label="Security">
              <Select value={form.smtpSecure} onChange={(e) => set('smtpSecure', e.target.value)}>
                <option value="SSL">SSL (port 465)</option>
                <option value="TLS">STARTTLS (port 587)</option>
                <option value="NONE">None</option>
              </Select>
            </Field>
            {text('smtpUser', 'Username')}
            {secret('smtpPass', 'Password')}
            {text('smtpFrom', 'From address', undefined, 'email')}
            {text('smtpFromName', 'From name')}
          </div>
        </Card>
        <Card title="Feeds">
          <div className="grid gap-4 sm:grid-cols-2">
            {text('dealerCrmEmail', 'CRM email for leads', 'CarGurus sends leads here. Empty = your inquiry email.', 'email')}
            <Field label="CRM format">
              <Select value={form.dealerCrmFormat} onChange={(e) => set('dealerCrmFormat', e.target.value)}>
                <option value="text">Plain text</option>
                <option value="adf">ADF / XML</option>
              </Select>
            </Field>
            {text('dealerRadius', 'Dealer radius (miles)')}
            {text('feedOperation', 'Operation', 'Empty unless CarGurus asks for a value.')}
            <Field label="Complete inventory batch">
              <Select value={form.feedCompleteBatch} onChange={(e) => set('feedCompleteBatch', e.target.value)}>
                <option value="Y">Yes — every feed is my full inventory</option>
                <option value="N">No</option>
              </Select>
            </Field>
            {secret('feedToken', 'Private CSV link key', 'Needed for the private CarGurus CSV link.')}
          </div>
        </Card>
        <Card title="CarGurus FTP">
          <p className="mb-4 text-xs text-slate-500">From your CarGurus account. The approved feed is uploaded here after Platform Admin approval and once a day.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {text('cargurusFtpHost', 'FTP host')}
            {text('cargurusFtpPort', 'Port', undefined, 'number')}
            {text('cargurusFtpUser', 'Username')}
            {secret('cargurusFtpPass', 'Password')}
            {text('cargurusRemoteDir', 'Remote folder')}
            {text('cargurusRemoteName', 'Remote file name')}
            <div className="sm:col-span-2">
              <Toggle checked={!!form.cargurusFtpSsl} onChange={(v) => set('cargurusFtpSsl', v)} label="Use FTPS (secure FTP)" />
            </div>
          </div>
        </Card>
        <Card title="Photos">
          <div className="grid gap-4 sm:grid-cols-2">
            {text('maxUploadMb', 'Largest photo (MB)', undefined, 'number')}
            <Field label="Branding band colour">
              <Input type="color" value={form.brandBandColor || '#EAF0F8'} onChange={(e) => set('brandBandColor', e.target.value)} className="h-10 w-24 p-1" />
            </Field>
            <div className="sm:col-span-2">
              <Toggle checked={!!form.brandImages} onChange={(v) => set('brandImages', v)} label="Photo branding" desc="Reserved for header/footer bands on vehicle photos." />
            </div>
          </div>
        </Card>
      </div>
    </form>
  );
}
