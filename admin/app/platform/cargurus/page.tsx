'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, Loading, PageHeader, StatusBadge, Table, Td, cx } from '@/components/ui';
import { dateTime } from '@/lib/format';

export default function CargurusList() {
  const [status, setStatus] = useState('PENDING');
  const { data, loading } = useApi(`/platform/cargurus?status=${status}`);
  const toast = useToast();
  return (
    <>
      <PageHeader
        title="CarGurus Feeds & Ingestion Audit"
        desc="Nothing reaches CarGurus without your approval. Open an upload to check every row, then approve & sync or reject with feedback."
        actions={
          <Button
            variant="secondary"
            onClick={async () => {
              const r = await api('/platform/cargurus/run-all', { method: 'POST' });
              toast.ok(`Upload job ran for ${Object.keys(r).length} dealership(s)`);
            }}
          >
            Run daily upload now
          </Button>
        }
      />
      <Card pad={false}>
        <div className="flex gap-1 border-b border-slate-100 p-4">
          <div className="flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            {[
              ['PENDING', 'Waiting for approval'],
              ['APPROVED', 'Approved'],
              ['REJECTED', 'Rejected'],
              ['', 'All'],
            ].map(([k, l]) => (
              <button key={k} onClick={() => setStatus(k)} className={cx('rounded-md px-3 py-1.5', status === k ? 'bg-white shadow' : 'text-slate-500')}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <Loading />
        ) : (
          <Table head={['Dealership', 'Uploaded', 'Source', 'Vehicles', 'Issues', 'Status', '']} empty={!data?.length && <Empty title="Nothing here" />}>
            {data?.map((s: any) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td>
                  <b>{s.tenantName}</b>
                  <div className="font-mono text-xs text-slate-500">{s.dealerCode}</div>
                </Td>
                <Td className="text-xs">
                  {dateTime(s.createdAt)}
                  <div className="text-slate-400">{s.createdBy}</div>
                </Td>
                <Td className="text-xs">{s.source === 'inventory' ? 'Website inventory' : s.fileName}</Td>
                <Td>
                  {s.valid}/{s.total}
                </Td>
                <Td>{s.issues ? <Badge color="amber">{s.issues}</Badge> : <Badge color="green">0</Badge>}</Td>
                <Td>
                  <StatusBadge status={s.status} />
                </Td>
                <Td>
                  <Link href={`/platform/cargurus/${s.tenantId}/${s.id}`} className="text-sm font-semibold text-blue-700 hover:underline">
                    Audit →
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
