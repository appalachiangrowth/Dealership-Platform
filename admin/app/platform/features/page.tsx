'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Card, Loading, PageHeader, Table, Td, Toggle } from '@/components/ui';

const FEATURES = [
  ['facebook', 'FB Poster', 'FB Poster menu in the Dealership Portal: posting to Facebook groups / Pages and Marketplace vehicle listings.'],
  ['cargurus', 'CarGurus', 'CarGurus feed uploads and the daily FTP upload.'],
  ['blog', 'Blog & news', 'Blog menu in the Dealership Portal and the blog on the website.'],
];

export default function FeaturesPage() {
  const settings = useApi('/platform/settings');
  const tenants = useApi('/platform/tenants');
  const toast = useToast();
  if (!settings.data || !tenants.data) return <Loading />;
  const def = settings.data.features;
  return (
    <>
      <PageHeader title="Feature flags" desc="Platform defaults. A dealership can override them in its Settings tab." />
      <Card title="Defaults for every dealership" className="mb-6 max-w-2xl">
        <div className="space-y-4">
          {FEATURES.map(([k, l, d]) => (
            <Toggle
              key={k}
              checked={!!def[k]}
              label={l}
              desc={d}
              onChange={async (v) => {
                settings.setData(await api('/platform/settings', { method: 'PUT', body: { features: { [k]: v } } }));
                toast.ok('Saved');
              }}
            />
          ))}
        </div>
      </Card>
      <Card title="Dealership overrides" pad={false}>
        <Table head={['Dealership', ...FEATURES.map((f) => f[1])]}>
          {tenants.data.map((t: any) => (
            <tr key={t.id}>
              <Td>
                <Link className="font-semibold hover:underline" href={`/platform/dealers/${t.id}`}>
                  {t.name}
                </Link>
              </Td>
              {FEATURES.map(([k]) => {
                const o = t.features?.[k];
                return <Td key={k}>{o === undefined ? <span className="text-xs text-slate-400">default</span> : o ? <Badge color="green">On</Badge> : <Badge color="red">Off</Badge>}</Td>;
              })}
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
