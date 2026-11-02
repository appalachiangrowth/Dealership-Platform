'use client';

import { useApi } from '@/lib/useApi';
import { API_URL } from '@/lib/api';
import { Badge, Card, ErrorBox, Loading, PageHeader } from '@/components/ui';

export default function SystemPage() {
  const { data, loading, error } = useApi('/platform/system');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const rows: [string, React.ReactNode][] = [
    ['Platform version', data.version],
    ['API', API_URL],
    ['Node.js', data.node],
    ['Uptime', `${Math.round(data.uptimeSeconds / 3600)} h`],
    ['Database', <Badge key="db" color="green">OK · {data.database.latencyMs} ms</Badge>],
    ['Dealerships', data.counts.tenants],
    ['Vehicles', data.counts.vehicles],
    ['Inquiries', data.counts.leads],
    ['Blog posts', data.counts.posts],
    ['Photos', `${data.counts.mediaFiles} files · ${(data.counts.mediaBytes / 1048576).toFixed(1)} MB`],
    ['CarGurus daily upload hour', data.cargurusCronHour === '' ? 'off' : `${data.cargurusCronHour}:00`],
  ];
  return (
    <>
      <PageHeader title="System" />
      <Card className="max-w-2xl">
        <dl className="divide-y divide-slate-100 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between py-2.5">
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
