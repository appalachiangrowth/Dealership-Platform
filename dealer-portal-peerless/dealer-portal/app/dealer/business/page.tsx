'use client';

import { useRef, useState } from 'react';
import {
  Building2,
  MapPin,
  Clock,
  Share2,
  Search,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Image as ImageIcon,
  Globe,
} from 'lucide-react';
import { useSettings } from '@/lib/useSettings';
import { useTenant } from '@/components/DealerShell';
import { Button, Card, ErrorBox, Field, Input, Loading } from '@/components/ui';
import { SingleImage } from '@/components/ImageUploader';
import { HoursEditor } from '@/components/HoursEditor';
import { MapPicker } from '@/components/MapPicker';

const KEYS = [
  'name', 'legalName', 'tagline', 'logo', 'phone', 'email', 'siteUrl', 'themeColor',
  'street', 'city', 'state', 'stateName', 'zip', 'country', 'lat', 'lng',
  'hours', 'hoursShort',
  'facebook', 'instagram', 'google', 'googleReviews', 'youtube', 'tiktok', 'messenger',
  'feedOperation',
];

interface OsmItem {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    house_number?: string;
    road?: string;
    street?: string;
    pedestrian?: string;
    footway?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    state_code?: string;
    'ISO3166-2-lvl4'?: string;
    postcode?: string;
    country?: string;
  };
}

export default function BusinessPage() {
  const { form, set, save, saving, dirty, error } = useSettings(KEYS);
  const { tenant, refreshTenant } = useTenant();

  // OpenStreetMap search state
  const [osmQuery, setOsmQuery] = useState('');
  const [osmSearching, setOsmSearching] = useState(false);
  const [osmResults, setOsmResults] = useState<OsmItem[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [manualEdit, setManualEdit] = useState(false);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  if (error) return <ErrorBox error={error} />;
  if (!form) return <Loading />;

  const searchOsm = async (query: string) => {
    if (!query || query.trim().length < 3) {
      setOsmResults([]);
      setShowResults(false);
      return;
    }
    setOsmSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query.trim())}&addressdetails=1&limit=5`,
        { headers: { Accept: 'application/json' } },
      );
      if (res.ok) {
        const data = await res.json();
        setOsmResults(data || []);
        setShowResults(true);
      }
    } catch {
      // ignore
    } finally {
      setOsmSearching(false);
    }
  };

  const onSearchChange = (val: string) => {
    setOsmQuery(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchOsm(val), 400);
  };

  const selectOsmPlace = (item: OsmItem) => {
    const a = item.address || {};
    const house = a.house_number ? `${a.house_number} ` : '';
    const street = house + (a.road || a.street || a.pedestrian || a.footway || item.display_name.split(',')[0]);
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    const stateCode = a['ISO3166-2-lvl4'] ? a['ISO3166-2-lvl4'].split('-')[1] : a.state_code || a.state || '';
    const stateName = a.state || '';
    const zip = a.postcode || '';
    const country = a.country || '';
    const lat = String(parseFloat(item.lat).toFixed(6));
    const lng = String(parseFloat(item.lon).toFixed(6));

    set('street', street);
    set('city', city);
    set('state', stateCode);
    set('stateName', stateName);
    set('zip', zip);
    set('country', country);
    set('lat', lat);
    set('lng', lng);

    setShowResults(false);
    setOsmQuery(item.display_name);
  };

  const handleLocationPickedOnMap = (loc: {
    lat: string;
    lng: string;
    street?: string;
    city?: string;
    state?: string;
    stateName?: string;
    zip?: string;
    country?: string;
    displayName?: string;
  }) => {
    set('lat', loc.lat);
    set('lng', loc.lng);
    if (loc.street !== undefined) set('street', loc.street);
    if (loc.city !== undefined) set('city', loc.city);
    if (loc.state !== undefined) set('state', loc.state);
    if (loc.stateName !== undefined) set('stateName', loc.stateName);
    if (loc.zip !== undefined) set('zip', loc.zip);
    if (loc.country !== undefined) set('country', loc.country);
    if (loc.displayName) setOsmQuery(loc.displayName);
  };

  const currentAddressFormatted = [form.street, form.city, form.state ? `${form.state} ${form.zip || ''}`.trim() : form.zip, form.country]
    .filter(Boolean)
    .join(', ');

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save()) refreshTenant();
      }}
      className="space-y-4 pb-12"
    >
      {/* Header with Title and Save changes */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-5">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-blue-700">Set up your website · Step 1 of 3</div>
          <h1 className="font-heading text-lg font-bold text-slate-900 sm:text-xl">Business details</h1>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="hidden text-xs font-semibold text-amber-600 sm:inline">Unsaved changes</span>}
          <Button type="submit" loading={saving} disabled={!dirty} size="sm">
            Save changes
          </Button>
        </div>
      </div>

      {/* 2-column layout on desktop: Left=Details/Address/Hours, Right=Logo/Social */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left Column (Span 2) */}
        <div className="space-y-4 lg:col-span-2">
          {/* Dealership Details (legalName removed) */}
          <Card
            title={
              <div className="flex items-center gap-2 text-slate-900">
                <Building2 className="h-4 w-4 text-blue-600" />
                <span>Dealership details</span>
              </div>
            }
            pad={false}
          >
            <div className="space-y-3 p-4 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Dealership name">
                  <Input
                    value={form.name ?? ''}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Blue Motors"
                    className="h-9 text-xs sm:text-sm"
                  />
                </Field>

                <Field label="Phone number">
                  <Input
                    type="tel"
                    value={form.phone ?? ''}
                    onChange={(e) => set('phone', e.target.value)}
                    placeholder="(555) 234-5678"
                    className="h-9 text-xs sm:text-sm"
                  />
                </Field>

                <div className="sm:col-span-2">
                  <Field label="Tagline / Short description" hint="One line shown in your website hero or header.">
                    <Input
                      value={form.tagline ?? ''}
                      onChange={(e) => set('tagline', e.target.value)}
                      placeholder="e.g. Quality Pre-Owned Vehicles in Salem, VA"
                      className="h-9 text-xs sm:text-sm"
                    />
                  </Field>
                </div>

                <div className="sm:col-span-2">
                  <Field label="Public email">
                    <Input
                      type="email"
                      value={form.email ?? ''}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="sales@bluemotors.com"
                      className="h-9 text-xs sm:text-sm"
                    />
                  </Field>
                </div>
              </div>
            </div>
          </Card>

          {/* Address & Leaflet OpenStreetMap */}
          <Card
            title={
              <div className="flex items-center gap-2 text-slate-900">
                <MapPin className="h-4 w-4 text-emerald-600" />
                <span>Address & OpenStreetMap Navigation</span>
              </div>
            }
            pad={false}
          >
            <div className="space-y-3.5 p-4 sm:p-5">
              {/* OpenStreetMap Search Bar */}
              <div className="relative">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Search address on OpenStreetMap
                </label>
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
                  <Input
                    value={osmQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    onFocus={() => osmResults.length > 0 && setShowResults(true)}
                    placeholder="Type address or landmark to search on map…"
                    className="h-9 pl-9 pr-9 text-xs sm:text-sm"
                  />
                  {osmSearching && <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-blue-600" />}
                </div>

                {/* Dropdown Results */}
                {showResults && osmResults.length > 0 && (
                  <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    {osmResults.map((item) => (
                      <button
                        key={item.place_id}
                        type="button"
                        onClick={() => selectOsmPlace(item)}
                        className="flex w-full items-start gap-2.5 rounded-lg p-2 text-left text-xs transition hover:bg-blue-50"
                      >
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                        <span className="truncate text-slate-700">{item.display_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Interactive Leaflet Map showing OpenStreetMap */}
              <MapPicker
                lat={form.lat}
                lng={form.lng}
                onLocationSelect={handleLocationPickedOnMap}
              />

              {/* Current address badge */}
              {currentAddressFormatted ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div className="min-w-0 text-xs text-slate-800">
                      <span className="font-bold text-emerald-950">Pinned Address: </span>
                      <span>{currentAddressFormatted}</span>
                      {form.lat && form.lng && (
                        <span className="ml-1.5 text-[11px] text-slate-500">
                          ({form.lat}, {form.lng})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Collapsible Manual Address Adjustment (No Lat/Lng inputs) */}
              <div className="border-t border-slate-100 pt-2">
                <button
                  type="button"
                  onClick={() => setManualEdit(!manualEdit)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  {manualEdit ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {manualEdit ? 'Hide address details' : 'Adjust address lines manually (street, suite, zip)'}
                </button>

                {manualEdit && (
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-6">
                    <div className="sm:col-span-6">
                      <Field label="Street address">
                        <Input
                          value={form.street ?? ''}
                          onChange={(e) => set('street', e.target.value)}
                          placeholder="e.g. 1204 W Main St"
                          className="h-8 text-xs"
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-3">
                      <Field label="City">
                        <Input
                          value={form.city ?? ''}
                          onChange={(e) => set('city', e.target.value)}
                          placeholder="Salem"
                          className="h-8 text-xs"
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-1">
                      <Field label="State">
                        <Input
                          value={form.state ?? ''}
                          onChange={(e) => set('state', e.target.value)}
                          placeholder="VA"
                          className="h-8 text-xs uppercase"
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field label="ZIP code">
                        <Input
                          value={form.zip ?? ''}
                          onChange={(e) => set('zip', e.target.value)}
                          placeholder="24153"
                          className="h-8 text-xs"
                        />
                      </Field>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Opening Hours */}
          <Card
            title={
              <div className="flex items-center gap-2 text-slate-900">
                <Clock className="h-4 w-4 text-amber-600" />
                <span>Opening hours</span>
              </div>
            }
            pad={false}
          >
            <div className="p-4 sm:p-5">
              <HoursEditor value={form.hours || {}} onChange={(h) => set('hours', h)} />
            </div>
          </Card>
        </div>

        {/* Right Side Column (Website Address, Logo & Social Links) */}
        <div className="space-y-4">
          {/* Main Website Address Card (Relocated from Advanced settings) */}
          <Card
            title={
              <div className="flex items-center gap-2 text-slate-900">
                <Globe className="h-4 w-4 text-blue-600" />
                <span>Website address</span>
              </div>
            }
            pad={false}
          >
            <div className="space-y-3 p-4 sm:p-5">
              <Field
                label="Main website address"
                hint="e.g. https://www.bluemotors.com — every vehicle link and feed uses it."
              >
                <Input
                  type="url"
                  value={form.siteUrl ?? ''}
                  onChange={(e) => set('siteUrl', e.target.value)}
                  placeholder="https://www.yourdealership.com"
                  className="h-9 text-xs sm:text-sm"
                />
              </Field>

              <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 space-y-1">
                <div>
                  <span className="font-semibold text-slate-700">Dealer ID: </span>
                  <b>{tenant?.dealerCode || '—'}</b>
                </div>
                <div>
                  <span className="font-semibold text-slate-700">Connected domains: </span>
                  <span>{tenant?.domains?.length ? tenant.domains.join(', ') : 'None yet'}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Logo Card */}
          <Card
            title={
              <div className="flex items-center gap-2 text-slate-900">
                <ImageIcon className="h-4 w-4 text-blue-600" />
                <span>Logo</span>
              </div>
            }
            pad={false}
          >
            <div className="p-4 sm:p-5">
              <SingleImage value={form.logo || ''} onChange={(v) => set('logo', v)} label="Upload logo" />
              <p className="mt-2.5 text-xs text-slate-400">A PNG with a transparent background looks best.</p>
            </div>
          </Card>

          {/* Social Links Card with Dummy URLs */}
          <Card
            title={
              <div className="flex items-center gap-2 text-slate-900">
                <Share2 className="h-4 w-4 text-blue-600" />
                <span>Social links</span>
              </div>
            }
            pad={false}
          >
            <div className="space-y-2.5 p-4 sm:p-5">
              <Field label="Facebook">
                <Input
                  value={form.facebook ?? ''}
                  onChange={(e) => set('facebook', e.target.value)}
                  placeholder="https://facebook.com/yourdealership"
                  className="h-8 text-xs sm:text-sm"
                />
              </Field>

              <Field label="Instagram">
                <Input
                  value={form.instagram ?? ''}
                  onChange={(e) => set('instagram', e.target.value)}
                  placeholder="https://instagram.com/yourdealership"
                  className="h-8 text-xs sm:text-sm"
                />
              </Field>

              <Field label="YouTube">
                <Input
                  value={form.youtube ?? ''}
                  onChange={(e) => set('youtube', e.target.value)}
                  placeholder="https://youtube.com/@yourdealership"
                  className="h-8 text-xs sm:text-sm"
                />
              </Field>

              <Field label="TikTok">
                <Input
                  value={form.tiktok ?? ''}
                  onChange={(e) => set('tiktok', e.target.value)}
                  placeholder="https://tiktok.com/@yourdealership"
                  className="h-8 text-xs sm:text-sm"
                />
              </Field>

              <Field label="Messenger">
                <Input
                  value={form.messenger ?? ''}
                  onChange={(e) => set('messenger', e.target.value)}
                  placeholder="https://m.me/yourdealership"
                  className="h-8 text-xs sm:text-sm"
                />
              </Field>

              <Field label="Google Business Profile">
                <Input
                  value={form.google ?? ''}
                  onChange={(e) => set('google', e.target.value)}
                  placeholder="https://maps.google.com/?cid=123456789"
                  className="h-8 text-xs sm:text-sm"
                />
              </Field>

              <Field label="Google Reviews Link">
                <Input
                  value={form.googleReviews ?? ''}
                  onChange={(e) => set('googleReviews', e.target.value)}
                  placeholder="https://g.page/r/yourdealership/review"
                  className="h-8 text-xs sm:text-sm"
                />
              </Field>
            </div>
          </Card>

          {/* Syndication & Destination Platforms */}
          <Card title="Destination Platforms">
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Configure which platforms inventory should be validated and prepared for by default (CarGurus, Facebook Marketplace, or both). When adding vehicles or importing CSV feeds, validation requirements and fix checklists automatically adapt to this configuration without needing to select them each time.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {(['cargurus', 'marketplace'] as const).map((p) => {
                  const currentStr = form.feedOperation || 'cargurus,marketplace';
                  const activePlatforms = currentStr.split(',').map((s: string) => s.trim()).filter(Boolean);
                  const active = activePlatforms.includes(p);
                  const label = p === 'cargurus' ? 'CarGurus' : 'Facebook Marketplace';

                  const togglePlatform = () => {
                    let next: string[];
                    if (active) {
                      next = activePlatforms.filter((x: string) => x !== p);
                      if (next.length === 0) return; // keep at least one
                    } else {
                      next = [...activePlatforms, p];
                    }
                    set('feedOperation', next.join(','));
                  };

                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={togglePlatform}
                      className={`flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-semibold transition ${
                        active
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-flex h-4 w-4 items-center justify-center rounded border-2 ${
                          active ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                        }`}
                      >
                        {active && (
                          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
                            <path d="M1.5 5.5L4 8L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Save Button for Mobile */}
      <div className="pt-2 sm:hidden">
        <Button type="submit" loading={saving} disabled={!dirty} className="w-full">
          Save changes
        </Button>
      </div>
    </form>
  );
}
