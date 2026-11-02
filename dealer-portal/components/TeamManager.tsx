'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { useToast } from './toast';
import { Badge, Button, Card, Drawer, ErrorBox, Field, Input, Loading, PageHeader, Select, Table, Td, Toggle } from './ui';
import { ago } from '@/lib/format';

/** Team & permissions — shared by the Dealership Portal and the Platform Admin dealer inspector. */
export function TeamManager({ title = true }: { title?: boolean }) {
  const { data, loading, error, reload } = useApi('/dealer/team');
  const { me } = useSession();
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !me) return null;
  const roles = data.roles as Record<string, { label: string; desc: string; perms: string[] }>;
  const perms = me.catalog.permissions;

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: edit.name, email: edit.email, phone: edit.phone, role: edit.role, perms: edit.perms };
      if (edit.password) body.password = edit.password;
      if (edit.id) {
        if (edit.id === me!.user.id) {
          delete body.role;
          delete body.perms;
        }
        await api(`/dealer/team/${edit.id}`, { method: 'PATCH', body });
      } else await api('/dealer/team', { body: { ...body, login: edit.login || edit.email } });
      toast.ok('Saved');
      setEdit(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {title && (
        <PageHeader
          title="Team & permissions"
          desc="Give each person their own login and choose what they can do."
          actions={
            <Button
              onClick={() => {
                const initialRole = 'STAFF';
                const defaultPerms = roles[initialRole]?.perms ? [...roles[initialRole].perms] : [];
                setEdit({ role: initialRole, perms: defaultPerms, name: '', email: '', login: '', password: '' });
              }}
            >
              <Plus className="h-4 w-4" /> Add person
            </Button>
          }
        />
      )}
      {!title && (
        <div className="mb-3 flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              const initialRole = 'STAFF';
              const defaultPerms = roles[initialRole]?.perms ? [...roles[initialRole].perms] : [];
              setEdit({ role: initialRole, perms: defaultPerms, name: '', email: '', login: '', password: '' });
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add login
          </Button>
        </div>
      )}
      <Card pad={false}>
        <Table head={['Person', 'Role', 'Last login', 'Status', '']}>
          {data.users.map((u: any) => (
            <tr key={u.id}>
              <Td>
                <div className="font-semibold text-slate-900">{u.name || u.login}</div>
                <div className="text-xs text-slate-500">{u.login}</div>
              </Td>
              <Td>
                <div className="font-medium text-slate-900">{roles[u.role]?.label || u.role}</div>
                {u.perms && u.perms.length > 0 && (
                  <div className="text-xs text-slate-500">{u.perms.map((p: string) => perms[p]?.label || p).join(', ')}</div>
                )}
              </Td>
              <Td className="text-xs">{ago(u.lastLoginAt)}</Td>
              <Td>{u.disabled ? <Badge color="red">Disabled</Badge> : <Badge color="green">Active</Badge>}</Td>
              <Td className="text-right">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const userPerms = Array.isArray(u.perms) && u.perms.length > 0
                      ? [...u.perms]
                      : (roles[u.role]?.perms ? [...roles[u.role].perms] : []);
                    setEdit({ ...u, password: '', perms: userPerms });
                  }}
                >
                  Edit
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Drawer
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? `Edit ${edit.name || edit.login}` : 'Add person'}
        footer={
          <>
            {edit?.id && edit.id !== me.user.id && (
              <Button
                variant="ghost"
                className="mr-auto text-red-600"
                onClick={async () => {
                  if (!confirm('Delete this login?')) return;
                  try {
                    await api(`/dealer/team/${edit.id}`, { method: 'DELETE' });
                    setEdit(null);
                    reload();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Delete
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy}>
              Save
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              </Field>
              {!edit.id && (
                <Field label="Login" hint="Empty = the email">
                  <Input value={edit.login} onChange={(e) => setEdit({ ...edit, login: e.target.value })} />
                </Field>
              )}
              <Field label={edit.id ? 'New password' : 'Password'} hint={edit.id ? 'Leave empty to keep the current one.' : 'At least 8 characters.'}>
                <Input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
              </Field>
            </div>
            {edit.id === me.user.id ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">You cannot change your own role or permissions.</p>
            ) : (
              <>
                <Field label="Role">
                  <Select
                    value={edit.role}
                    onChange={(e) => {
                      const nextRole = e.target.value;
                      const nextPerms = roles[nextRole]?.perms ? [...roles[nextRole].perms] : [];
                      setEdit({ ...edit, role: nextRole, perms: nextPerms });
                    }}
                  >
                    {Object.entries(roles)
                      .filter(([k]) => k !== 'CUSTOM')
                      .map(([k, r]) => (
                        <option key={k} value={k}>
                          {r.label} — {r.desc}
                        </option>
                      ))}
                  </Select>
                </Field>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">What this person can do</div>
                  <p className="mb-3 text-xs text-slate-500">
                    Default permissions for <b>{roles[edit.role]?.label || edit.role}</b> are pre-selected. You can toggle any permission on or off.
                  </p>
                  <div className="space-y-3">
                    {Object.entries(perms).map(([k, p]) => {
                      const allowed = edit.role === 'ADMIN' || me.catalog.customAllowed.includes(k);
                      const on = (edit.perms || []).includes(k);
                      return (
                        <div key={k} className={!allowed ? 'opacity-50 pointer-events-none' : ''}>
                          <Toggle
                            checked={on}
                            onChange={(v) => {
                              if (!allowed) return;
                              const cur = edit.perms || [];
                              const next = v ? Array.from(new Set([...cur, k])) : cur.filter((x: string) => x !== k);
                              setEdit({ ...edit, perms: next });
                            }}
                            label={p.label}
                            desc={p.desc}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                {edit.id && <Toggle checked={!!edit.disabled} onChange={(v) => setEdit({ ...edit, disabled: v })} label="Disable this login" />}
              </>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}

