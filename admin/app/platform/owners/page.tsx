'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';
import { ago } from '@/lib/format';

export default function Owners() {
  const { data, setData, loading } = useApi('/platform/owners');
  const { me } = useSession();
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  if (loading || !data) return <Loading />;
  const run = async (fn: () => Promise<any>, msg: string) => {
    try {
      setData(await fn());
      toast.ok(msg);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <>
      <PageHeader
        title="Platform owners"
        desc="People who can open the Platform Admin and every dealership."
        actions={
          <Button onClick={() => setF({ login: '', name: '', email: '', password: '' })}>
            <Plus className="h-4 w-4" /> Add owner
          </Button>
        }
      />
      <Card pad={false}>
        <Table head={['Owner', 'Last login', 'Status', '']}>
          {data.map((o: any) => (
            <tr key={o.id}>
              <Td>
                <b>{o.name || o.login}</b> {o.id === me?.user.id && <Badge color="blue">You</Badge>}
                <div className="text-xs text-slate-500">{o.login}</div>
              </Td>
              <Td className="text-xs">{ago(o.lastLoginAt)}</Td>
              <Td>{o.disabled ? <Badge color="red">Disabled</Badge> : <Badge color="green">Active</Badge>}</Td>
              <Td className="text-right">
                {o.id !== me?.user.id && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => run(() => api(`/platform/owners/${o.id}`, { method: 'PATCH', body: { disabled: !o.disabled } }), 'Saved')}>
                      {o.disabled ? 'Enable' : 'Disable'}
                    </Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => confirm('Delete this owner?') && run(() => api(`/platform/owners/${o.id}`, { method: 'DELETE' }), 'Deleted')}>
                      Delete
                    </Button>
                  </>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal
        open={!!f}
        onClose={() => setF(null)}
        title="Add platform owner"
        footer={
          <Button onClick={() => run(() => api('/platform/owners', { body: f }), 'Owner added').then(() => setF(null))}>
            Add
          </Button>
        }
      >
        {f && (
          <div className="space-y-3">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Login (email)"><Input value={f.login} onChange={(e) => setF({ ...f, login: e.target.value, email: e.target.value })} /></Field>
            <Field label="Password"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
