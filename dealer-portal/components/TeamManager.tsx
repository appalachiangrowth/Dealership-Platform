'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Info, KeyRound, MoreVertical, Pencil, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { useToast } from './toast';
import { Button, Drawer, ErrorBox, Field, Input, Loading, Select, Toggle, cx } from './ui';
import { ago } from '@/lib/format';

/** Team & permissions — shared by the Dealership Portal and the Platform Admin dealer inspector. */
/* look of the new design */
const CARD = 'rounded-[14px] border border-[#E5E9F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]';
const FLD = 'flex min-h-[42px] items-stretch overflow-hidden rounded-lg border border-[#CBD5E1] bg-white focus-within:border-[#2563EB] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.18)]';
const CTRL = 'min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-[#0F172A] outline-none placeholder:text-[#7A8599]';
const TH = 'whitespace-nowrap px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.04em] text-[#526077]';
const TD = 'border-t border-[#EEF1F6] p-3.5 align-middle';
const BTN_P = 'inline-flex min-h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#2563EB] px-[18px] text-sm font-semibold text-white transition hover:bg-[#1D4ED8]';
const BTN_S =
  'inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#CBD5E1] bg-white px-3 text-[13px] font-semibold text-[#0F172A] transition hover:bg-[#F8FAFC]';
const ROLE_CHIP: Record<string, string> = {
  ADMIN: 'bg-[#EAF1FF] text-[#1D4ED8]',
  STAFF: 'bg-[#E8F7EE] text-[#15803D]',
  CUSTOM: 'bg-[#F1EDFF] text-[#5B3FD6]',
};

function Tip({ text, label }: { text: string; label: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button type="button" aria-label={`What is ${label}?`} className="inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full text-[#64748B] outline-none hover:bg-[#EAF1FF] hover:text-[#1D4ED8]">
        <Info className="h-[15px] w-[15px]" />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+8px)] left-[-10px] z-40 hidden w-[260px] rounded-lg bg-[#0F172A] px-3 py-2.5 text-[12.5px] font-normal normal-case leading-normal tracking-normal text-[#F1F5F9] shadow-[0_8px_24px_rgba(15,23,42,0.25)] group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

/** Team & permissions — shared by the Dealership Portal and the Platform Admin dealer inspector. */
export function TeamManager({ title = true }: { title?: boolean }) {
  const { data, loading, error, reload } = useApi('/dealer/team');
  const { me } = useSession();
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'members' | 'roles'>('members');
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [menu, setMenu] = useState<string | null>(null);

  // the "…" menu closes on any outside click
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const t = setTimeout(() => window.addEventListener('click', close), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('click', close);
    };
  }, [menu]);

  const roles = (data?.roles || {}) as Record<string, { label: string; desc: string; perms: string[] }>;
  const users: any[] = data?.users || [];
  /** what a person can actually use: their own list, or the preset of their role */
  const effective = (u: any): string[] => (Array.isArray(u.perms) && u.perms.length ? u.perms : roles[u.role]?.perms || []);
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const isCustom = (u: any) => u.role === 'CUSTOM' || (u.role !== 'ADMIN' && !sameSet(effective(u), roles[u.role]?.perms || []));
  const roleLabel = (u: any) => (isCustom(u) ? 'Custom' : roles[u.role]?.label || u.role);
  const roleKey = (u: any) => (isCustom(u) ? 'CUSTOM' : u.role);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return users.filter((u) => (!t || [u.name, u.login, u.email].some((x) => String(x || '').toLowerCase().includes(t))) && (!roleFilter || roleKey(u) === roleFilter));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, q, roleFilter, data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !me) return null;
  const perms = me.catalog.permissions as Record<string, { label: string; desc: string }>;
  const canUse = (u: any) =>
    u.role === 'ADMIN' && !isCustom(u)
      ? 'Everything, including website setup and team'
      : effective(u)
          .map((p: string) => perms[p]?.label || p)
          .join(', ') || 'Nothing yet';

  const startAdd = () => {
    const initialRole = 'STAFF';
    const defaultPerms = roles[initialRole]?.perms ? [...roles[initialRole].perms] : [];
    setEdit({ role: initialRole, perms: defaultPerms, name: '', email: '', login: '', password: '' });
  };
  const startEdit = (u: any) => {
    const userPerms = Array.isArray(u.perms) && u.perms.length > 0 ? [...u.perms] : roles[u.role]?.perms ? [...roles[u.role].perms] : [];
    setEdit({ ...u, password: '', perms: userPerms });
  };

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: edit.name, email: edit.email, phone: edit.phone, role: edit.role, perms: edit.perms };
      if (edit.password) body.password = edit.password;
      if (edit.id) {
        if (edit.id === me!.user.id) {
          delete body.role;
          delete body.perms;
        } else body.disabled = !!edit.disabled;
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
  async function setDisabled(u: any, disabled: boolean) {
    try {
      await api(`/dealer/team/${u.id}`, { method: 'PATCH', body: { disabled } });
      toast.ok(disabled ? `${u.name || u.login} can no longer log in.` : `${u.name || u.login} can log in again.`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function remove(u: any) {
    if (!confirm(`Delete the login of ${u.name || u.login}? This cannot be undone.`)) return;
    try {
      await api(`/dealer/team/${u.id}`, { method: 'DELETE' });
      setEdit(null);
      toast.ok('Login deleted');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // Roles tab: the preset roles, then each person with their own custom set
  const presetCols = Object.entries(roles)
    .filter(([k]) => k !== 'CUSTOM')
    .map(([k, r]) => ({ key: k, label: r.label, list: k === 'ADMIN' ? Object.keys(perms) : r.perms }));
  const customCols = users.filter((u) => isCustom(u)).map((u) => ({ key: `u:${u.id}`, label: `Custom (${u.name || u.login})`, list: effective(u) }));
  const cols = [...presetCols, ...customCols];

  const tabs: ['members' | 'roles', string][] = [
    ['members', `Members (${users.length})`],
    ['roles', 'Roles & permissions'],
  ];

  return (
    <>
      {title ? (
        <header className="-mx-4 -mt-6 mb-6 border-b border-[#E5E9F0] bg-white px-4 pt-5 sm:-mx-7 sm:-mt-7 sm:px-7">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex min-w-[280px] flex-1 flex-col gap-1">
              <h1 className="m-0 text-[26px] font-bold tracking-[-0.02em] text-[#0F172A]">Team &amp; permissions</h1>
              <p className="m-0 text-sm text-[#526077]">Add your staff and choose what each person can see and change.</p>
            </div>
            <button type="button" className={BTN_P} onClick={startAdd}>
              <UserPlus className="h-4 w-4" /> Add team member
            </button>
          </div>
          <nav aria-label="Team sections" className="mt-3.5 flex gap-6">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-current={tab === k ? 'page' : undefined}
                onClick={() => setTab(k)}
                className={cx(
                  'inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-0.5 text-sm font-semibold transition',
                  tab === k ? 'border-[#2563EB] text-[#1D4ED8]' : 'border-transparent text-[#526077] hover:text-[#0F172A]',
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>
      ) : (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-[10px] bg-[#EEF1F6] p-1">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cx('min-h-8 rounded-[7px] px-3 text-[13px] font-semibold', tab === k ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#334155]')}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className={cx(BTN_P, 'ml-auto min-h-9 px-3 text-[13px]')} onClick={startAdd}>
            <UserPlus className="h-3.5 w-3.5" /> Add login
          </button>
        </div>
      )}

      {tab === 'members' ? (
        <div className="flex flex-col gap-5">
          <div className={cx(CARD, 'overflow-x-auto')}>
            <div className="flex flex-wrap gap-3 border-b border-[#E5E9F0] p-3">
              <div className={cx(FLD, 'flex-[1_1_260px]')}>
                <span className="flex items-center pl-3 text-[#64748B]">
                  <Search className="h-4 w-4" />
                </span>
                <label htmlFor="tm-q" className="sr-only">
                  Search team
                </label>
                <input id="tm-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" className={CTRL} />
              </div>
              <div className={cx(FLD, 'flex-[0_1_220px]')}>
                <label htmlFor="tm-role" className="sr-only">
                  Filter by role
                </label>
                <select id="tm-role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={cx(CTRL, 'cursor-pointer')}>
                  <option value="">All roles</option>
                  {Object.entries(roles).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  <th className={TH}>Team member</th>
                  <th className={TH}>
                    <span className="inline-flex items-center gap-0.5">
                      Role <Tip label="Role" text="A role is a ready-made set of permissions. Open the Roles & permissions tab to see exactly what each role can do." />
                    </span>
                  </th>
                  <th className={TH}>Can use</th>
                  <th className={TH}>Last active</th>
                  <th className={TH}>Status</th>
                  <th className={cx(TH, 'text-right')}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => {
                  const self = u.id === me.user.id;
                  return (
                    <tr key={u.id} className="hover:bg-[#F8FAFC]">
                      <td className={TD}>
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EAF1FF] font-bold text-[#1D4ED8]">
                            {(u.name || u.login || '?').charAt(0).toUpperCase()}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="text-sm font-semibold text-[#0F172A]">
                              {u.name || u.login} {self && <span className="font-medium text-[#526077]">(you)</span>}
                            </span>
                            <span className="truncate text-[13px] text-[#526077]">{u.email || u.login}</span>
                          </span>
                        </div>
                      </td>
                      <td className={TD}>
                        <span className={cx('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-semibold', ROLE_CHIP[roleKey(u)] || 'bg-[#F1F5F9] text-[#475569]')}>{roleLabel(u)}</span>
                      </td>
                      <td className={cx(TD, 'max-w-[280px] text-[13px] text-[#334155]')}>{canUse(u)}</td>
                      <td className={cx(TD, 'whitespace-nowrap text-[13px] text-[#334155]')}>{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
                      <td className={TD}>
                        {u.disabled ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#FEE2E2] px-2.5 py-[3px] text-xs font-semibold text-[#B91C1C]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#DC2626]" />
                            Disabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#E8F7EE] px-2.5 py-[3px] text-xs font-semibold text-[#15803D]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
                            Active
                          </span>
                        )}
                      </td>
                      <td className={cx(TD, 'text-right')}>
                        <div className="relative inline-flex gap-1.5">
                          <button type="button" className={BTN_S} onClick={() => startEdit(u)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit access
                          </button>
                          {!self && (
                            <button
                              type="button"
                              aria-label={`More actions for ${u.name || u.login}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenu(menu === u.id ? null : u.id);
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#E5E9F0] bg-white text-[#334155] hover:bg-[#F8FAFC]"
                            >
                              <MoreVertical className="h-[18px] w-[18px]" />
                            </button>
                          )}
                          {menu === u.id && (
                            <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-xl border border-[#E5E9F0] bg-white py-1 text-left shadow-[0_8px_24px_rgba(15,23,42,0.15)]">
                              <button type="button" onClick={() => startEdit(u)} className="flex w-full items-center gap-2 px-3 py-2 text-[13px] hover:bg-[#F8FAFC]">
                                <KeyRound className="h-4 w-4 text-[#526077]" /> Change password
                              </button>
                              <button type="button" onClick={() => setDisabled(u, !u.disabled)} className="flex w-full items-center gap-2 px-3 py-2 text-[13px] hover:bg-[#F8FAFC]">
                                <ShieldCheck className="h-4 w-4 text-[#526077]" /> {u.disabled ? 'Enable login' : 'Disable login'}
                              </button>
                              <button type="button" onClick={() => remove(u)} className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#B91C1C] hover:bg-[#FEF2F2]">
                                <Trash2 className="h-4 w-4" /> Delete login
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={6} className={cx(TD, 'py-8 text-center text-sm text-[#526077]')}>
                      Nobody matches your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-start gap-2.5 rounded-[10px] border border-[#DBE7FE] bg-[#EFF6FF] px-3.5 py-3 text-[13px] text-[#1E3A8A]">
            <Info className="mt-px h-4 w-4 shrink-0" />
            <span>
              New team members log in with the login and password you set for them. Only <b>Dealership admins</b> can add or remove team members.
            </span>
          </div>
        </div>
      ) : (
        <div className={cx(CARD, 'overflow-x-auto')}>
          <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E9F0] px-5 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#EAF1FF] text-[#1D4ED8]">
              <KeyRound className="h-[18px] w-[18px]" />
            </span>
            <div className="flex flex-1 flex-col">
              <h2 className="m-0 text-base font-bold text-[#0F172A]">What each role can do</h2>
              <span className="text-[13px] text-[#526077]">Custom access can be set person by person with “Edit access”.</span>
            </div>
            <button type="button" className={BTN_S} onClick={startAdd}>
              <UserPlus className="h-4 w-4" /> Add a person with custom access
            </button>
          </div>
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC]">
                <th className={TH}>Area of the portal</th>
                {cols.map((c) => (
                  <th key={c.key} className={cx(TH, 'text-center')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(perms).map(([k, p]) => (
                <tr key={k} className="hover:bg-[#F8FAFC]">
                  <td className={TD}>
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold text-[#0F172A]">{p.label}</span>
                      <span className="text-[12.5px] text-[#526077]">{p.desc}</span>
                    </span>
                  </td>
                  {cols.map((c) => {
                    const on = c.list.includes(k);
                    return (
                      <td key={c.key} className={cx(TD, 'text-center')}>
                        {on ? (
                          <span role="img" aria-label="Allowed" className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#E8F7EE] text-[#15803D]">
                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          </span>
                        ) : (
                          <span role="img" aria-label="Not allowed" className="font-bold text-[#94A3B8]">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Drawer
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? `Edit access · ${edit.name || edit.login}` : 'Add team member'}
        footer={
          <>
            {edit?.id && edit.id !== me.user.id && (
              <Button variant="ghost" className="mr-auto text-red-600" onClick={() => remove(edit)}>
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

