'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  CheckCircle2,
  AlertTriangle,
  Download,
  Wifi,
  Play,
  Settings,
  ShieldAlert,
  FileCheck2,
  Server,
  Lock,
  Eye,
  EyeOff,
  Check,
  XCircle,
  HelpCircle,
  Info,
} from 'lucide-react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  Drawer,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  StatusBadge,
  Textarea,
  Toggle,
  cx,
} from '@/components/ui';
import { dateTime } from '@/lib/format';

type DryRunReport = {
  status: 'READY_TO_SYNC' | 'ACTION_REQUIRED';
  summary: {
    totalEvaluated: number;
    validCount: number;
    blockedCount: number;
    allPassed: boolean;
    dealershipProfileComplete: boolean;
    profileIssues: string[];
  };
  fileGeneration: {
    success: boolean;
    error: string | null;
    format: string;
    estimatedSizeBytes: number;
    rowsCount: number;
  };
  sftpStaging: {
    targetHost: string;
    targetPort: number;
    targetFileName: string;
    targetDirectory: string;
    simulatedPayloadSizeBytes: number;
    configured: boolean;
  };
  flaggedList: {
    row: number;
    vin: string;
    stock: string;
    name: string;
    reasons: string[];
  }[];
  timestamp: string;
};

type ConnectionStatus = {
  tested: boolean;
  success: boolean;
  latencyMs?: number;
  message?: string;
  reason?: string;
  timestamp?: string;
};

export default function CargurusAudit() {
  const { tenantId, id } = useParams<{ tenantId: string; id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/platform/cargurus/${tenantId}/${id}`);

  const [filter, setFilter] = useState<'all' | 'issues' | 'ready'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [row, setRow] = useState<any>(null);
  const [approve, setApprove] = useState(false);
  const [reject, setReject] = useState(false);
  const [note, setNote] = useState('');
  const [includeInvalid, setIncludeInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  // SFTP Connection Modal & Form States
  const [connModalOpen, setConnModalOpen] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [sftpForm, setSftpForm] = useState({
    host: 'ftp.cargurus.com',
    port: 2122,
    username: '',
    password: '',
    passphrase: '',
    privateKey: '',
  });
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    tested: false,
    success: false,
  });

  // Dry-Run Modal & Report States
  const [dryRunModalOpen, setDryRunModalOpen] = useState(false);
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [dryRunReport, setDryRunReport] = useState<DryRunReport | null>(null);

  // Auto-populate SFTP form once data is loaded
  useEffect(() => {
    if (data?.sftpSettings) {
      setSftpForm((prev) => ({
        ...prev,
        host: data.sftpSettings.host || 'ftp.cargurus.com',
        port: data.sftpSettings.port || 2122,
        username: data.sftpSettings.username || '',
      }));
    }
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r: any) => {
      const vehicleIssues = Object.keys(r.issues).some((k) => !k.startsWith('dealer_'));
      if (filter === 'issues' && !vehicleIssues) return false;
      if (filter === 'ready' && vehicleIssues) return false;
      return !q || r.values.join(' ').toLowerCase().includes(q.toLowerCase());
    });
  }, [data, filter, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;
  const s = data.summary;
  const sub = data.submission;
  const pageRows = rows.slice((page - 1) * 25, page * 25);

  // Guard condition for "Approve & Sync"
  const isConnOk = connectionStatus.tested && connectionStatus.success;
  const isDryRunOk = dryRunReport !== null && dryRunReport.status === 'READY_TO_SYNC' && dryRunReport.summary.blockedCount === 0;
  const canApproveAndSync = isConnOk && isDryRunOk && s.profile.complete;

  const handleTestConnection = async () => {
    setTestingConn(true);
    try {
      const res = await api('/api/cargurus/test-connection', {
        method: 'POST',
        body: {
          tenantId,
          host: sftpForm.host,
          port: Number(sftpForm.port) || 2122,
          username: sftpForm.username,
          password: sftpForm.password || undefined,
          passphrase: sftpForm.passphrase || undefined,
          privateKey: sftpForm.privateKey || undefined,
        },
      });

      if (res.success) {
        setConnectionStatus({
          tested: true,
          success: true,
          latencyMs: res.latencyMs,
          message: res.message || 'Connection & authentication verified successfully',
          timestamp: new Date().toLocaleTimeString(),
        });
        toast.ok(res.message || 'SFTP connection verified');
      } else {
        setConnectionStatus({
          tested: true,
          success: false,
          reason: res.reason || 'Authentication or connection handshake failed',
          timestamp: new Date().toLocaleTimeString(),
        });
        toast.error(res.reason || 'SFTP connection failed');
      }
    } catch (e: any) {
      const reason = e?.message || 'Connection error';
      setConnectionStatus({
        tested: true,
        success: false,
        reason,
        timestamp: new Date().toLocaleTimeString(),
      });
      toast.error(reason);
    } finally {
      setTestingConn(false);
    }
  };

  const handleRunDryRun = async () => {
    setRunningDryRun(true);
    try {
      const report: DryRunReport = await api('/api/cargurus/dry-run', {
        method: 'POST',
        body: {
          tenantId,
          submissionId: id,
        },
      });
      setDryRunReport(report);
      setDryRunModalOpen(true);
      if (report.status === 'READY_TO_SYNC') {
        toast.ok(`Dry-run passed: ${report.summary.validCount} vehicle(s) ready`);
      } else {
        toast.error(`Dry-run requires attention: ${report.summary.blockedCount} issue(s) detected`);
      }
    } catch (e: any) {
      toast.error(`Dry-run failed: ${e?.message || 'Validation error'}`);
    } finally {
      setRunningDryRun(false);
    }
  };

  return (
    <>
      <PageHeader
        back="/platform/cargurus"
        title={`${sub.tenantName} · CarGurus upload`}
        desc={
          <>
            {sub.dealerCode} · {sub.source === 'inventory' ? 'Website inventory' : sub.fileName} · {dateTime(sub.createdAt)} by {sub.createdBy} · <StatusBadge status={sub.status} />
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => download(`/platform/cargurus/${tenantId}/${id}/master.csv`, `cargurus-${tenantId}.csv`)}>
              <Download className="h-4 w-4" /> Download CarGurus Master CSV
            </Button>

            {/* Test Connection Button */}
            <Button
              variant={connectionStatus.tested ? (connectionStatus.success ? 'secondary' : 'danger') : 'secondary'}
              onClick={() => setConnModalOpen(true)}
              className="relative"
            >
              <Wifi className="h-4 w-4" />
              Test Connection
              {connectionStatus.tested && (
                <span
                  className={cx(
                    'ml-1.5 inline-block h-2 w-2 rounded-full',
                    connectionStatus.success ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-red-500 ring-2 ring-red-200'
                  )}
                />
              )}
            </Button>

            {/* Dry Run Button */}
            <Button
              variant={dryRunReport ? (dryRunReport.status === 'READY_TO_SYNC' ? 'secondary' : 'secondary') : 'secondary'}
              loading={runningDryRun}
              onClick={handleRunDryRun}
            >
              <Play className="h-4 w-4" />
              Dry Run Check
              {dryRunReport && (
                <span
                  className={cx(
                    'ml-1.5 inline-block h-2 w-2 rounded-full',
                    dryRunReport.status === 'READY_TO_SYNC' ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-amber-500 ring-2 ring-amber-200'
                  )}
                />
              )}
            </Button>

            {sub.status === 'PENDING' && (
              <>
                <Button variant="danger" onClick={() => setReject(true)}>
                  Reject
                </Button>
                <div className="relative inline-block">
                  <Button
                    variant="success"
                    onClick={() => setApprove(true)}
                    disabled={!canApproveAndSync}
                    title={
                      !isConnOk
                        ? 'Requires successful SFTP connection test'
                        : !isDryRunOk
                        ? 'Requires passing Dry Run check with 0 critical feed errors'
                        : !s.profile.complete
                        ? 'Dealership profile is incomplete'
                        : 'Ready to approve & sync'
                    }
                  >
                    Approve & Sync to CarGurus
                  </Button>
                </div>
              </>
            )}

            {sub.status === 'APPROVED' && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const r = await api(`/platform/cargurus/${tenantId}/resend`, { method: 'POST' });
                  r.sent ? toast.ok('Feed sent to CarGurus') : toast.error(r.reason);
                }}
              >
                Re-send
              </Button>
            )}
          </>
        }
      />

      {/* Pre-Flight Guard Status Banner for Pending Submissions */}
      {sub.status === 'PENDING' && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Pre-Flight Guard & Validation Pipeline</h2>
              <p className="text-xs text-slate-500">
                To safeguard feeds before upload to <span className="font-mono text-slate-700">ftp.cargurus.com:2122</span>, both SFTP authentication and pre-flight feed simulation must pass.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Sync Readiness:</span>
              {canApproveAndSync ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> READY TO SYNC
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-600" /> ACTION REQUIRED
                </span>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* 1. SFTP Connection Guard */}
            <div
              className={cx(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition hover:shadow-sm',
                connectionStatus.tested
                  ? connectionStatus.success
                    ? 'border-emerald-200 bg-emerald-50/50'
                    : 'border-red-200 bg-red-50/50'
                  : 'border-slate-200 bg-slate-50/50'
              )}
              onClick={() => setConnModalOpen(true)}
            >
              <div
                className={cx(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                  connectionStatus.tested
                    ? connectionStatus.success
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-600 text-white'
                    : 'bg-slate-300 text-slate-700'
                )}
              >
                <Wifi className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <b className="text-xs font-bold text-slate-800">1. SFTP Auth Check</b>
                  <Badge color={connectionStatus.tested ? (connectionStatus.success ? 'green' : 'red') : 'slate'}>
                    {connectionStatus.tested ? (connectionStatus.success ? 'STATUS: OK' : 'FAILED') : 'NOT TESTED'}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-slate-600">
                  {connectionStatus.tested
                    ? connectionStatus.success
                      ? `${connectionStatus.latencyMs}ms · Verified`
                      : connectionStatus.reason
                    : 'Verify credentials & port 2122 handshake'}
                </p>
              </div>
            </div>

            {/* 2. Dry Run Simulation Guard */}
            <div
              className={cx(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition hover:shadow-sm',
                dryRunReport
                  ? dryRunReport.status === 'READY_TO_SYNC'
                    ? 'border-emerald-200 bg-emerald-50/50'
                    : 'border-amber-200 bg-amber-50/50'
                  : 'border-slate-200 bg-slate-50/50'
              )}
              onClick={handleRunDryRun}
            >
              <div
                className={cx(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                  dryRunReport
                    ? dryRunReport.status === 'READY_TO_SYNC'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-600 text-white'
                    : 'bg-slate-300 text-slate-700'
                )}
              >
                <Play className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <b className="text-xs font-bold text-slate-800">2. Dry Run Check</b>
                  <Badge color={dryRunReport ? (dryRunReport.status === 'READY_TO_SYNC' ? 'green' : 'amber') : 'slate'}>
                    {dryRunReport ? dryRunReport.status : 'PENDING'}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-slate-600">
                  {dryRunReport
                    ? `${dryRunReport.summary.validCount} valid · ${dryRunReport.summary.blockedCount} blocked`
                    : 'Simulate full schema, images & feed builder'}
                </p>
              </div>
            </div>

            {/* 3. Dealership Profile Guard */}
            <div
              className={cx(
                'flex items-start gap-3 rounded-xl border p-3',
                s.profile.complete ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'
              )}
            >
              <div
                className={cx(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                  s.profile.complete ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                )}
              >
                <FileCheck2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <b className="text-xs font-bold text-slate-800">3. Dealership Profile</b>
                  <Badge color={s.profile.complete ? 'green' : 'red'}>
                    {s.profile.complete ? 'COMPLETE' : `${s.profile.percent}%`}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-slate-600">
                  {s.profile.complete
                    ? 'All 7 profile attributes verified'
                    : `${s.profile.missing?.length || 0} missing field(s)`}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-3xl font-extrabold">{s.total}</span> <span className="text-sm text-slate-500">vehicles ingested</span>
            {s.allPassed ? (
              <Badge color="green">
                <CheckCircle2 className="h-3 w-3" /> All {s.checks.length} mandatory vehicle checks passed
              </Badge>
            ) : (
              <Badge color="amber">
                <AlertTriangle className="h-3 w-3" /> {s.issues} issues detected
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {s.checks.map((c: any) => (
              <Badge key={c.key} color={c.failed ? 'red' : 'green'}>
                {c.label}
                {c.failed ? `: ${c.failed}` : ' ✓'}
              </Badge>
            ))}
          </div>
        </Card>
        <Card title={`Dealership profile · ${s.profile.percent}%`}>
          {s.profile.complete ? (
            <p className="text-sm text-emerald-700">Complete — dealer columns are auto-enriched into every row.</p>
          ) : (
            <ul className="space-y-1 text-xs text-red-700">
              {s.profile.missing.map((m: any) => (
                <li key={m.field}>• {m.issue}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {sub.reviewNote && <p className="mb-4 rounded-lg bg-slate-100 p-3 text-sm">Review note: {sub.reviewNote}</p>}

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            {(['all', 'issues', 'ready'] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setFilter(k);
                  setPage(1);
                }}
                className={cx('rounded-md px-3 py-1.5 capitalize', filter === k ? 'bg-white shadow' : 'text-slate-500')}
              >
                {k === 'issues' ? 'With issues' : k}
              </button>
            ))}
          </div>
          <Input
            placeholder="Search…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="max-w-xs"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Row</th>
                {data.columns.map((c: any) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2">
                    {c.label} {c.source === 'dealer' && <Badge color="violet">Auto-enriched</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageRows.map((r: any) => (
                <tr key={r.row} onClick={() => setRow(r)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold">{r.row}</td>
                  {data.columns.map((c: any, i: number) => {
                    const iss = r.issues[c.key];
                    return (
                      <td
                        key={c.key}
                        title={iss?.join('\n')}
                        className={cx('max-w-[180px] truncate px-3 py-2', iss && 'bg-red-50 text-red-700')}
                      >
                        {r.values[i] || (iss ? '—' : '')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={25} total={rows.length} onPage={setPage} />
      </Card>

      {/* Row Detail Drawer */}
      <Drawer open={!!row} onClose={() => setRow(null)} title={`Row ${row?.row}`} wide>
        {row && (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Column</th>
                <th className="py-2 text-left">Dealer’s file</th>
                <th className="py-2 text-left">CarGurus export</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.columns.map((c: any, i: number) => (
                <tr key={c.key} className={row.issues[c.key] ? 'bg-red-50' : ''}>
                  <td className="py-2 pr-3 font-semibold">{c.label}</td>
                  <td className="py-2 pr-3 text-slate-500">{c.source === 'dealer' ? <i>profile</i> : row.raw[c.key]}</td>
                  <td className="py-2">
                    {row.values[i]}
                    {row.issues[c.key]?.map((m: string) => (
                      <div key={m} className="text-xs text-red-700">
                        {m}
                      </div>
                    ))}
                    {row.warnings[c.key]?.map((m: string) => (
                      <div key={m} className="text-xs text-amber-700">
                        {m}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Drawer>

      {/* ─────────────────── SFTP Connection Test Modal ─────────────────── */}
      <Modal
        open={connModalOpen}
        onClose={() => setConnModalOpen(false)}
        title="SFTP Connection & Auth Verification"
        footer={
          <div className="flex w-full items-center justify-between">
            <div className="text-xs text-slate-500">
              Target: <span className="font-mono font-semibold">{sftpForm.host}:{sftpForm.port}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setConnModalOpen(false)}>
                Close
              </Button>
              <Button variant="primary" loading={testingConn} onClick={handleTestConnection}>
                <Wifi className="h-4 w-4" /> Run Connection Test
              </Button>
            </div>
          </div>
        }
      >
        <p className="mb-4 text-xs text-slate-600">
          Verify SSH/SFTP handshake with CarGurus endpoints before pushing live inventory. You may test with existing database credentials or test custom SSH credentials below.
        </p>

        {connectionStatus.tested && (
          <div
            className={cx(
              'mb-4 rounded-xl border p-4 text-xs',
              connectionStatus.success ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
            )}
          >
            <div className="flex items-center gap-2">
              {connectionStatus.success ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600" />
              )}
              <b className="font-semibold">
                {connectionStatus.success ? 'SFTP Connection Verified (STATUS: OK)' : 'SFTP Connection Failed'}
              </b>
              {connectionStatus.timestamp && (
                <span className="ml-auto text-[10px] text-slate-400">Tested at {connectionStatus.timestamp}</span>
              )}
            </div>
            <p className="mt-1 pl-6">
              {connectionStatus.success ? connectionStatus.message : connectionStatus.reason}
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Hostname">
              <Input
                value={sftpForm.host}
                onChange={(e) => setSftpForm({ ...sftpForm, host: e.target.value })}
                placeholder="ftp.cargurus.com"
              />
            </Field>
          </div>
          <div>
            <Field label="Port">
              <Input
                type="number"
                value={sftpForm.port}
                onChange={(e) => setSftpForm({ ...sftpForm, port: Number(e.target.value) })}
                placeholder="2122"
              />
            </Field>
          </div>
        </div>

        <div className="mt-3">
          <Field label="Username">
            <Input
              value={sftpForm.username}
              onChange={(e) => setSftpForm({ ...sftpForm, username: e.target.value })}
              placeholder="e.g. appalachian_growth"
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Password / Passphrase" hint="Used for SFTP account password or to decrypt the private key">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={sftpForm.password}
                onChange={(e) => setSftpForm({ ...sftpForm, password: e.target.value })}
                placeholder="SFTP account password (or leave blank if using saved database password)"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
        </div>

        <div className="mt-3">
          <Field label="SSH Private Key (Optional)" hint="Paste PEM or OpenSSH private key for key-based authentication">
            <Textarea
              rows={3}
              value={sftpForm.privateKey}
              onChange={(e) => setSftpForm({ ...sftpForm, privateKey: e.target.value })}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
              className="font-mono text-xs"
            />
          </Field>
        </div>

        {sftpForm.privateKey.trim() && (
          <div className="mt-3">
            <Field label="SSH Key Passphrase (Optional)">
              <div className="relative">
                <Input
                  type={showPassphrase ? 'text' : 'password'}
                  value={sftpForm.passphrase}
                  onChange={(e) => setSftpForm({ ...sftpForm, passphrase: e.target.value })}
                  placeholder="Passphrase for encrypted private key"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
          </div>
        )}
      </Modal>

      {/* ─────────────────── Dry Run Simulation Modal ─────────────────── */}
      <Modal
        open={dryRunModalOpen}
        onClose={() => setDryRunModalOpen(false)}
        title="Pre-Flight Dry Run Simulation Report"
        footer={
          <div className="flex w-full items-center justify-between">
            <div className="text-xs text-slate-500">
              Audit Readiness Status:{' '}
              <b className={dryRunReport?.status === 'READY_TO_SYNC' ? 'text-emerald-700' : 'text-amber-700'}>
                {dryRunReport?.status || 'UNKNOWN'}
              </b>
            </div>
            <Button variant="secondary" onClick={() => setDryRunModalOpen(false)}>
              Close
            </Button>
          </div>
        }
      >
        {dryRunReport && (
          <div className="space-y-4">
            {/* Status Header Tile */}
            <div
              className={cx(
                'rounded-xl border p-4 text-xs',
                dryRunReport.status === 'READY_TO_SYNC'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : 'border-amber-200 bg-amber-50 text-amber-950'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-bold">
                  {dryRunReport.status === 'READY_TO_SYNC' ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      READY TO SYNC: All validation & feed generation checks passed!
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                      ACTION REQUIRED: Critical feed or schema issues detected!
                    </>
                  )}
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  {dateTime(dryRunReport.timestamp)}
                </span>
              </div>
              <p className="mt-1 text-xs opacity-90">
                {dryRunReport.status === 'READY_TO_SYNC'
                  ? 'Simulated payload generated cleanly and conforms to CarGurus specifications without errors.'
                  : 'Vehicles missing mandatory CarGurus fields or dealership profile gaps must be reviewed before sync.'}
              </p>
            </div>

            {/* Itemized Stats Breakdown */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Evaluated</span>
                <b className="mt-1 block text-2xl font-extrabold text-slate-900">
                  {dryRunReport.summary.totalEvaluated}
                </b>
                <span className="text-[11px] text-slate-500">Cars in submission</span>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Valid Count</span>
                <b className="mt-1 block text-2xl font-extrabold text-emerald-700">
                  {dryRunReport.summary.validCount}
                </b>
                <span className="text-[11px] text-emerald-600">Passed all checks</span>
              </div>

              <div
                className={cx(
                  'rounded-xl border p-3',
                  dryRunReport.summary.blockedCount > 0
                    ? 'border-red-200 bg-red-50/50 text-red-700'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                )}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider">Blocked / Flagged</span>
                <b className="mt-1 block text-2xl font-extrabold">
                  {dryRunReport.summary.blockedCount}
                </b>
                <span className="text-[11px] opacity-80">Missing mandatory fields</span>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Simulated Payload</span>
                <b className="mt-1 block text-2xl font-extrabold text-blue-700">
                  {(dryRunReport.fileGeneration.estimatedSizeBytes / 1024).toFixed(1)} KB
                </b>
                <span className="text-[11px] text-blue-600">{dryRunReport.fileGeneration.format}</span>
              </div>
            </div>

            {/* Dealership Profile Issues if any */}
            {!dryRunReport.summary.dealershipProfileComplete && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <b className="block font-bold">Dealership Profile Needs Attention:</b>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {dryRunReport.summary.profileIssues.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Staging Destination Info */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
              <b className="text-slate-800">Simulated SFTP Staging Target:</b>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-600">
                <span>Endpoint: {dryRunReport.sftpStaging.targetHost}:{dryRunReport.sftpStaging.targetPort}</span>
                <span>Target File: {dryRunReport.sftpStaging.targetFileName}</span>
                <span>Payload Size: {dryRunReport.sftpStaging.simulatedPayloadSizeBytes} bytes</span>
                <span>
                  Status:{' '}
                  {dryRunReport.sftpStaging.configured ? (
                    <span className="text-emerald-700">Configured in Dealership Settings</span>
                  ) : (
                    <span className="text-amber-700">Using Default CarGurus Endpoint</span>
                  )}
                </span>
              </div>
            </div>

            {/* Detailed Flag List */}
            <div>
              <b className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-700">
                Itemized Flag List ({dryRunReport.flaggedList.length})
              </b>
              {dryRunReport.flaggedList.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-center text-xs text-emerald-800">
                  <CheckCircle2 className="mx-auto mb-1 h-5 w-5 text-emerald-600" />
                  No vehicles flagged. Every vehicle satisfies the CarGurus 12 mandatory attribute schema.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 text-xs">
                  {dryRunReport.flaggedList.map((item, idx) => (
                    <div key={idx} className="p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">
                          {item.name} <span className="text-slate-400 font-normal">· Row #{item.row}</span>
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          VIN: {item.vin || 'MISSING'} · Stock: {item.stock || 'MISSING'}
                        </span>
                      </div>
                      <ul className="mt-1.5 space-y-0.5">
                        {item.reasons.map((r, ri) => (
                          <li key={ri} className="flex items-start gap-1.5 text-red-700">
                            <span className="text-red-500 font-bold">•</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ─────────────────── Approve & Sync Modal ─────────────────── */}
      <Modal
        open={approve}
        onClose={() => setApprove(false)}
        title="Approve & sync to CarGurus"
        footer={
          <Button
            variant="success"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api(`/platform/cargurus/${tenantId}/${id}/approve`, { body: { includeInvalid, note } });
                toast.ok(`${r.vehicles} vehicles approved. ${r.dispatch.sent ? 'Sent to CarGurus via SFTP.' : r.dispatch.reason}`);
                setApprove(false);
                reload();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve & Execute SFTP Sync
          </Button>
        }
      >
        <p className="mb-3">
          {s.valid} of {s.total} vehicles are ready. {s.invalid > 0 && 'Vehicles with problems are left out.'}
        </p>

        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <div className="flex items-center gap-1.5 font-bold">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Pre-Flight Requirements Satisfied
          </div>
          <div className="mt-1 text-[11px] text-emerald-800 space-y-0.5">
            <div>✓ SFTP Connection Status: OK ({connectionStatus.latencyMs}ms)</div>
            <div>✓ Dry Run Simulation: Passed ({dryRunReport?.summary.validCount} valid vehicles)</div>
          </div>
        </div>

        {s.invalid > 0 && <Toggle checked={includeInvalid} onChange={setIncludeInvalid} label="Include vehicles with problems anyway" />}
        <Field label="Note (optional)" className="mt-3">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>

      {/* ─────────────────── Reject Modal ─────────────────── */}
      <Modal
        open={reject}
        onClose={() => setReject(false)}
        title="Reject upload"
        footer={
          <Button
            variant="danger"
            disabled={!note.trim()}
            onClick={async () => {
              try {
                await api(`/platform/cargurus/${tenantId}/${id}/reject`, { body: { note } });
                toast.ok('Rejected — the dealer sees your feedback');
                router.push('/platform/cargurus');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Reject
          </Button>
        }
      >
        <Field label="Feedback for the dealer">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}
