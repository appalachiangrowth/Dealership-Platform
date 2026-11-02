'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Input, Loading, PageHeader, Table, Td, cx } from '@/components/ui';
import { ago, dateTime } from '@/lib/format';

function AccountDrawer({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { data, setData, loading } = useApi(`/platform/accounts/${id}`);
  const [pw, setPw] = useState('');
  const toast = useToast();
  const patch = async (body: Record<string, unknown>, msg: string) => {
    try {
      setData(await api(`/platform/accounts/${id}`, { method: 'PATCH', body }));
      toast.ok(msg);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Drawer open onClose={onClose} title={data ? data.name || data.login : 'Account'}>
      {loading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <dt className="text-slate-500">Login</dt>
            <dd>{data.login}</dd>
            <dt className="text-slate-500">Dealership</dt>
            <dd>
              <Link className="text-blue-700 underline" href={`/platform/dealers/${data.tenant.id}`}>
                {data.tenant.name}
              </Link>
            </dd>
            <dt className="text-slate-500">Role</dt>
            <dd>{data.role}</dd>
            <dt className="text-slate-500">Phone</dt>
            <dd>{data.phone || '—'}</dd>
            <dt className="text-slate-500">Created</dt>
            <dd>
              {dateTime(data.createdAt)} ({data.source.toLowerCase()})
            </dd>
            <dt className="text-slate-500">Sign-up IP</dt>
            <dd>{data.signupIp || '—'}</dd>
          </dl>
          <div className="flex items-end gap-2">
            <Field label="Set a new password" className="flex-1">
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Button disabled={pw.length < 8} onClick={() => patch({ password: pw }, 'Password changed').then(() => setPw(''))}>
              Save
            </Button>
          </div>
          <Button variant={data.disabled ? 'success' : 'danger'} onClick={() => patch({ disabled: !data.disabled }, data.disabled ? 'Login enabled' : 'Login disabled')}>
            {data.disabled ? 'Enable login' : 'Disable login'}
          </Button>
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase text-slate-500">Login history</h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {data.history.map((h: any) => (
                <li key={h.id} className="flex justify-between px-3 py-2 text-xs">
                  <span>{dateTime(h.createdAt)}</span>
                  <span className="text-slate-500">{h.ip}</span>
                  {h.success ? <Badge color="green">OK</Badge> : <Badge color="red">Failed</Badge>}
                </li>
              ))}
              {!data.history.length && <li className="px-3 py-2 text-xs text-slate-500">No logins yet</li>}
            </ul>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Accounts() {
  const params = useSearchParams();
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(params.get('open') || '');
  const { data, loading, error, reload } = useApi(`/platform/accounts?filter=${filter}&q=${encodeURIComponent(term)}`);
  const filters = [
    ['', 'All'],
    ['signup', 'Self sign-ups'],
    ['active', 'Active this week'],
    ['never', 'Never logged in'],
    ['failed', 'Failed logins'],
    ['disabled', 'Disabled'],
  ];
  return (
    <>
      <PageHeader title="Dealer accounts" desc="Every login of every dealership." />
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="flex flex-wrap rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            {filters.map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={cx('rounded-md px-3 py-1.5', filter === k ? 'bg-white shadow' : 'text-slate-500')}>
                {l}
              </button>
            ))}
          </div>
          <form
            className="relative min-w-[200px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setTerm(q);
            }}
          >
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} />
          </div>
        ) : (
          <Table head={['Person', 'Dealership', 'Role', 'Created', 'Last login', 'Logins 30d', 'Failed 30d', 'Status']} empty={!data?.length && <Empty title="Nobody found" />}>
            {data?.map((u: any) => (
              <tr key={u.id} onClick={() => setOpen(u.id)} className="cursor-pointer hover:bg-slate-50">
                <Td>
                  <b>{u.name || u.login}</b>
                  <div className="text-xs text-slate-500">
                    {u.login} {u.phone && `· ${u.phone}`}
                  </div>
                </Td>
                <Td>{u.tenant.name}</Td>
                <Td className="text-xs">{u.role}</Td>
                <Td className="text-xs">
                  {ago(u.createdAt)} <div className="text-slate-400">{u.source.toLowerCase()}</div>
                </Td>
                <Td className="text-xs">{ago(u.lastLoginAt)}</Td>
                <Td>{u.logins30}</Td>
                <Td>{u.failed30 ? <Badge color="red">{u.failed30}</Badge> : 0}</Td>
                <Td>{u.disabled ? <Badge color="red">Disabled</Badge> : <Badge color="green">Active</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {open && <AccountDrawer id={open} onClose={() => setOpen('')} onChange={reload} />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Accounts />
    </Suspense>
  );
}
