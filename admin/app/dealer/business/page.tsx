'use client';

import { useSettings } from '@/lib/useSettings';
import { useTenant } from '@/components/DealerShell';
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader } from '@/components/ui';
import { SingleImage } from '@/components/ImageUploader';
import { HoursEditor } from '@/components/HoursEditor';

const KEYS = [
  'name', 'legalName', 'tagline', 'logo', 'phone', 'email', 'street', 'city', 'state', 'stateName', 'zip', 'country', 'lat', 'lng', 'hours',
  'facebook', 'instagram', 'google', 'googleReviews', 'youtube', 'tiktok', 'messenger',
];

export default function BusinessPage() {
  const { form, set, save, saving, dirty, error } = useSettings(KEYS);
  const { refreshTenant } = useTenant();
  if (error) return <ErrorBox error={error} />;
  if (!form) return <Loading />;
  const text = (k: string, label: string, hint?: string, type = 'text') => (
    <Field label={label} hint={hint}>
      <Input type={type} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save()) refreshTenant();
      }}
    >
      <PageHeader
        title="① Business details"
        desc="Used by every design, in emails and in feeds. Empty details show friendly placeholders on your website until you fill them in."
        actions={
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save changes
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Your dealership">
            <div className="grid gap-4 sm:grid-cols-2">
              {text('name', 'Dealership name')}
              {text('legalName', 'Legal name', 'If different, e.g. “Blue Motors LLC”.')}
              <div className="sm:col-span-2">{text('tagline', 'Short description', 'One line, e.g. “Quality used cars in Salem, VA”.')}</div>
              {text('phone', 'Phone number')}
              {text('email', 'Public email', undefined, 'email')}
            </div>
          </Card>
          <Card title="Address">
            <div className="grid gap-4 sm:grid-cols-6">
              <div className="sm:col-span-6">{text('street', 'Street address')}</div>
              <div className="sm:col-span-3">{text('city', 'City')}</div>
              <div className="sm:col-span-1">{text('state', 'State', 'e.g. VA')}</div>
              <div className="sm:col-span-2">{text('zip', 'ZIP / postcode')}</div>
              <div className="sm:col-span-3">{text('stateName', 'State (full name)')}</div>
              <div className="sm:col-span-3">{text('country', 'Country')}</div>
              <div className="sm:col-span-3">{text('lat', 'Latitude', 'Optional, for maps and CarGurus.')}</div>
              <div className="sm:col-span-3">{text('lng', 'Longitude')}</div>
            </div>
          </Card>
          <Card title="Opening hours">
            <HoursEditor value={form.hours || {}} onChange={(h) => set('hours', h)} />
            {form.hoursShort && <p className="mt-3 text-xs text-slate-500">Shown on your website as: {form.hoursShort}</p>}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Logo">
            <SingleImage value={form.logo || ''} onChange={(v) => set('logo', v)} label="Upload logo" />
            <p className="mt-3 text-xs text-slate-500">A PNG with a transparent background looks best.</p>
          </Card>
          <Card title="Social links">
            <div className="space-y-3">
              {text('facebook', 'Facebook')}
              {text('instagram', 'Instagram')}
              {text('youtube', 'YouTube')}
              {text('tiktok', 'TikTok')}
              {text('messenger', 'Messenger')}
              {text('google', 'Google Business profile')}
              {text('googleReviews', 'Google reviews link')}
            </div>
          </Card>
        </div>
      </div>
    </form>
  );
}
