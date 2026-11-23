'use client';

/**
 * Platform Admin › Visitor Intelligence — website visitors and inquiries across every dealership
 * (backend GET /platform/visitors/overview and /platform/visitors/feed; data from the websites' activity tracker).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Activity, Car, Eye, Link2, MessageCircle, Phone, RefreshCw, Target, UserCheck, Users } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Pagination, Select, Stat, Table, Td, cx } from '@/components/ui';
import { ago, dateTime, num } from '@/lib/format';

const EVENTS: [string, string, string][] = [
  ['PAGE_VIEW', 'Page view', 'slate'],
  ['VIEW_VDP', 'Vehicle view', 'blue'],
  ['SCROLL_DEPTH', 'Scroll depth', 'slate'],
  ['TIME_SPENT', 'Time spent', 'slate'],
  ['WHATSAPP_CLICK', 'WhatsApp click', 'green'],
  ['CALL_CLICK', 'Call click', 'green'],
  ['FORM_START', 'Form started', 'amber'],
  ['LEAD_SUBMITTED', 'Inquiry sent', 'violet'],
];
const EVENT = Object.fromEntries(EVENTS.map(([k, l, c]) => [k, { label: l, color: c }]));

const duration = (sec: number) => (sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`);

function detailOf(e: any) {
  if (e.eventType === 'SCROLL_DEPTH') return `${e.scrollDepth ?? 0}%`;
  if (e.eventType === 'TIME_SPENT') return duration(e.durationSec || 0);
  return e.vehicleTitle || e.pagePath || '';
}

function LiveStream({ tenantId, dealerships }: { tenantId: string; dealerships: { id: string; name: string }[] }) {
  const [dealer, setDealer] = useState(tenantId);
  const [eventType, setEventType] = useState('');
  const [linked, setLinked] = useState('');
  const [page, setPage] = useState(1);
  const [live, setLive] = useState(true);
  useEffect(() => {
    setDealer(tenantId);
    setPage(1);
  }, [tenantId]);
  const { data, loading, error, reload } = useApi(`/platform/visitors/feed?tenantId=${dealer}&eventType=${eventType}&linked=${linked}&page=${page}&pageSize=25`);
  useEffect(() => {
    if (!live || page !== 1) return;
    const t = setInterval(() => void reload(), 15000);
    return () => clearInterval(t);
  }, [live, page, reload]);

  return (
    <Card
      pad={false}
      title={
        <span className="inline-flex items-center gap-2">
          <Activity className="h-4 w-4" /> Live activity stream
          {live && page === 1 && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" title="Refreshes every 15 seconds" />}
        </span>
      }
      actions={
        <>
          <Select value={dealer} onChange={(e) => { setDealer(e.target.value); setPage(1); }} className="w-48">
            <option value="">All dealers</option>
            {dealerships.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
          <Select value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(1); }} className="w-44">
            <option value="">All event types</option>
            {EVENTS.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </Select>
          <Select value={linked} onChange={(e) => { setLinked(e.target.value); setPage(1); }} className="w-40">
            <option value="">Anonymous + leads</option>
            <option value="lead">Linked to lead</option>
            <option value="anonymous">Anonymous only</option>
          </Select>
          <button
            type="button"
            onClick={() => setLive(!live)}
            className={cx('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset', live ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-white text-slate-600 ring-slate-300')}
          >
            <RefreshCw className="h-3.5 w-3.5" /> {live ? 'Live' : 'Paused'}
          </button>
        </>
      }
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <div className="p-4"><ErrorBox error={error} retry={reload} /></div>
      ) : (
        <>
          <Table head={['When', 'Dealership', 'Event', 'Detail', 'Visitor', 'Device / place']} empty={!data?.items.length && <Empty title="No activity yet" desc="Events appear here as soon as visitors browse the dealer websites." />}>
            {data?.items.map((e: any) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap text-xs text-slate-500" >
                  <span title={dateTime(e.createdAt)}>{ago(e.createdAt)}</span>
                </Td>
                <Td>
                  <Link className="text-sm hover:underline" href={`/platform/dealers/${e.tenantId}`}>{e.tenant?.name || e.tenantId}</Link>
                </Td>
                <Td><Badge color={EVENT[e.eventType]?.color || 'slate'}>{EVENT[e.eventType]?.label || e.eventType}</Badge></Td>
                <Td className="max-w-[260px] truncate text-xs text-slate-600">{detailOf(e)}</Td>
                <Td>
                  {e.lead ? (
                    <Badge color="violet"><Link2 className="h-3 w-3" /> Linked to lead · {e.lead.name}</Badge>
                  ) : (
                    <Badge color="slate">Anonymous</Badge>
                  )}
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400">{String(e.visitorId).slice(0, 16)}…</div>
                </Td>
                <Td className="text-xs text-slate-500">
                  {e.deviceType || '—'}
                  {(e.city || e.region) && <div>{[e.city, e.region].filter(Boolean).join(', ')}</div>}
                </Td>
              </tr>
            ))}
          </Table>
          {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
        </>
      )}
    </Card>
  );
}

export default function VisitorIntelligence() {
  const [days, setDays] = useState('7');
  const [tenantId, setTenantId] = useState('');
  const { data, loading, error, reload } = useApi(`/platform/visitors/overview?days=${days}&tenantId=${tenantId}`);
  const k = data?.kpis;
  const period = { '1': '24 h', '7': '7 days', '30': '30 days', '90': '90 days' }[days] || `${days} days`;

  return (
    <>
      <PageHeader
        title="Visitor Intelligence"
        desc="Website visitors, vehicle views and inquiries across every dealership."
        actions={
          <>
            <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="w-56">
              <option value="">All dealerships</option>
              {data?.dealerships.map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Select value={days} onChange={(e) => setDays(e.target.value)} className="w-36">
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
          </>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : !data ? null : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Visitors (24 h)" value={num(k.visitors.h24)} sub={`${num(k.events.today)} events today`} icon={<Users className="h-5 w-5" />} />
            <Stat label="Visitors (7 days)" value={num(k.visitors.d7)} sub={`${num(k.visitors.d30)} in 30 days`} icon={<Users className="h-5 w-5" />} />
            <Stat label="Vehicle page views" value={num(k.vdpViews)} sub={period} icon={<Eye className="h-5 w-5" />} />
            <Stat
              label="WhatsApp / call clicks"
              value={num(k.whatsappClicks + k.callClicks)}
              sub={
                <>
                  <MessageCircle className="-mt-0.5 inline h-3 w-3" /> {num(k.whatsappClicks)} · <Phone className="-mt-0.5 inline h-3 w-3" /> {num(k.callClicks)} · {period}
                </>
              }
              icon={<Phone className="h-5 w-5" />}
            />
            <Stat label="Identified leads" value={num(k.identifiedLeads)} sub={`inquiries linked to a visit · ${period}`} icon={<UserCheck className="h-5 w-5" />} />
            <Stat label="Conversion rate" value={`${k.conversionRate}%`} sub={`identified leads ÷ ${num(k.visitors.range)} visitors`} icon={<Target className="h-5 w-5" />} />
          </div>

          <div className="mb-6 grid gap-6 xl:grid-cols-3">
            <Card title={`Dealership breakdown — ${period}`} pad={false} className="xl:col-span-2">
              <Table
                head={['Dealership', 'Visitors', 'VDP views', 'Leads captured', 'Conversion %', 'Last active']}
                empty={!data.dealers.length && <Empty title="No visitor activity yet" desc="Numbers appear once the websites with the new tracker get visits." />}
              >
                {data.dealers.map((d: any) => (
                  <tr key={d.tenantId} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/platform/dealers/${d.tenantId}`} className="font-semibold text-slate-900 hover:underline">{d.name}</Link>
                      <div className="text-xs text-slate-400">{d.dealerSlug}</div>
                    </Td>
                    <Td>{num(d.visitors)}</Td>
                    <Td>{num(d.vdpViews)}</Td>
                    <Td>
                      {num(d.leads)}
                      {d.identifiedLeads > 0 && <span className="text-xs text-slate-500"> ({num(d.identifiedLeads)} linked)</span>}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-right font-semibold">{d.conversion}%</span>
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, d.conversion * 10)}%` }} />
                        </span>
                      </div>
                    </Td>
                    <Td className="text-xs text-slate-500">{d.lastActive ? ago(d.lastActive) : '—'}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title={<span className="inline-flex items-center gap-2"><Car className="h-4 w-4" /> Top viewed vehicles</span>}>
              {!data.topVehicles.length ? (
                <p className="text-sm text-slate-500">No vehicle page views in this period.</p>
              ) : (
                <ol className="space-y-3">
                  {data.topVehicles.map((v: any, i: number) => (
                    <li key={v.tenantId + v.vehicleId} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900">{v.title || v.vehicleId}</div>
                        <div className="text-xs text-slate-500">{v.dealerName}</div>
                      </div>
                      <div className="text-right text-xs">
                        <div className="font-bold text-slate-900">{num(v.views)}</div>
                        <div className="text-slate-400">{num(v.visitors)} visitors</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <LiveStream tenantId={tenantId} dealerships={data.dealerships} />
        </>
      )}
    </>
  );
}
