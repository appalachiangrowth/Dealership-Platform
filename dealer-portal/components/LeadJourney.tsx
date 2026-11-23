'use client';

/**
 * Leads › inquiry drawer: "Website Activity & Journey" — what this customer did on the website before (and after)
 * sending the inquiry (backend GET /dealer/leads/:id/activity, filled by the website's activity tracker).
 */
import { Car, Clock, Eye, FileText, Flame, Laptop, MapPin, MessageCircle, MousePointerClick, Phone, Repeat, ScrollText, Send, Smartphone } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { Badge, Spinner, cx } from './ui';
import { dateTime } from '@/lib/format';

export type Intent = 'HOT' | 'WARM' | 'COLD';

/** short summary the Leads list gets with each inquiry */
export interface LeadActivityBrief {
  intentScore: Intent;
  score: number;
  vehiclesViewed: number;
  totalViews: number;
  isRepeatVisitor: boolean;
  sessions: number;
}

interface Summary extends LeadActivityBrief {
  vdpViews: number;
  maxScrollDepth: number;
  totalTimeSec: number;
  whatsappClicks: number;
  callClicks: number;
  formStarts: number;
  device: string | null;
  city: string | null;
  region: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

interface Item {
  at: string;
  type: string;
  label: string;
  pagePath: string | null;
  vehicleTitle: string | null;
  scrollDepth: number | null;
  durationSec: number | null;
  device: string | null;
  newVisit: boolean;
}

/** 95 → "1m 35s", 3725 → "1h 2m" */
export const duration = (sec: number) => {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const INTENT: Record<Intent, { label: string; color: string }> = {
  HOT: { label: 'Hot lead', color: 'red' },
  WARM: { label: 'Warm lead', color: 'amber' },
  COLD: { label: 'Cold lead', color: 'slate' },
};

/** Leads list: Hot Lead / Repeat Visitor / Viewed X cars (nothing when there is no website activity) */
export function IntentBadges({ a }: { a?: LeadActivityBrief | null }) {
  if (!a) return null;
  const out: React.ReactNode[] = [];
  if (a.intentScore === 'HOT')
    out.push(
      <Badge key="hot" color="red">
        <Flame className="h-3 w-3" /> Hot lead
      </Badge>,
    );
  if (a.isRepeatVisitor)
    out.push(
      <Badge key="rep" color="violet">
        <Repeat className="h-3 w-3" /> Repeat visitor
      </Badge>,
    );
  if (a.vehiclesViewed > 0 && out.length < 2)
    out.push(
      <Badge key="veh" color="blue">
        <Car className="h-3 w-3" /> Viewed {a.vehiclesViewed} car{a.vehiclesViewed === 1 ? '' : 's'}
      </Badge>,
    );
  if (!out.length) return null;
  return <div className="mt-1 flex flex-wrap gap-1 font-normal">{out}</div>;
}

const ICON: Record<string, React.ElementType> = {
  PAGE_VIEW: Eye,
  VIEW_VDP: Car,
  WHATSAPP_CLICK: MessageCircle,
  CALL_CLICK: Phone,
  FORM_START: FileText,
  LEAD_SUBMITTED: Send,
};
const TONE: Record<string, string> = {
  VIEW_VDP: 'bg-blue-100 text-blue-700',
  WHATSAPP_CLICK: 'bg-emerald-100 text-emerald-700',
  CALL_CLICK: 'bg-emerald-100 text-emerald-700',
  FORM_START: 'bg-amber-100 text-amber-800',
  LEAD_SUBMITTED: 'bg-violet-100 text-violet-700',
};

function Tile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-base font-bold text-slate-900">{value}</div>
    </div>
  );
}

export function LeadJourney({ leadId }: { leadId: string }) {
  const { data, loading, error } = useApi<{ hasActivity: boolean; summary: Summary; timeline: Item[] }>(`/dealer/leads/${leadId}/activity`);

  return (
    <section className="space-y-3 border-t border-slate-100 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">Website Activity &amp; Journey</h3>
        {data?.hasActivity && (
          <div className="flex flex-wrap gap-1">
            <Badge color={INTENT[data.summary.intentScore].color}>
              {data.summary.intentScore === 'HOT' && <Flame className="h-3 w-3" />}
              {INTENT[data.summary.intentScore].label}
            </Badge>
            {data.summary.isRepeatVisitor && (
              <Badge color="violet">
                <Repeat className="h-3 w-3" /> {data.summary.sessions} visits
              </Badge>
            )}
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading website activity…
        </div>
      ) : error ? (
        <p className="text-sm text-slate-500">Website activity is not available right now.</p>
      ) : !data?.hasActivity ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
          No website activity recorded for this customer. It appears for inquiries sent from your website once visitor tracking is live
          (not for inquiries sent before it, or from a browser that blocks storage).
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile icon={Car} label="Vehicles viewed" value={data.summary.vehiclesViewed} />
            <Tile icon={ScrollText} label="Max scroll" value={`${data.summary.maxScrollDepth}%`} />
            <Tile icon={Clock} label="Time on site" value={duration(data.summary.totalTimeSec)} />
            <Tile
              icon={data.summary.device === 'mobile' ? Smartphone : Laptop}
              label="Device"
              value={data.summary.device ? data.summary.device.charAt(0).toUpperCase() + data.summary.device.slice(1) : '—'}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>
              <Eye className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
              {data.summary.totalViews} page view{data.summary.totalViews === 1 ? '' : 's'}
            </span>
            {data.summary.whatsappClicks + data.summary.callClicks > 0 && (
              <span>
                <MousePointerClick className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                {data.summary.whatsappClicks} WhatsApp · {data.summary.callClicks} call click{data.summary.callClicks === 1 ? '' : 's'}
              </span>
            )}
            {(data.summary.city || data.summary.region) && (
              <span>
                <MapPin className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                {[data.summary.city, data.summary.region].filter(Boolean).join(', ')}
              </span>
            )}
            {data.summary.firstSeen && <span>First visit {dateTime(data.summary.firstSeen)}</span>}
          </div>

          <ol className="relative max-h-[420px] space-y-0 overflow-y-auto pr-1">
            {data.timeline.map((it, i) => {
              const Icon = ICON[it.type] || Eye;
              const visitNo = data.timeline.slice(0, i + 1).filter((x) => x.newVisit).length;
              const detail = [it.scrollDepth != null ? `${it.scrollDepth}% scroll` : '', it.durationSec ? duration(it.durationSec) : ''].filter(Boolean).join(', ');
              return (
                <li key={i}>
                  {it.newVisit && (
                    <div className={cx('mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400', i > 0 && 'mt-3')}>
                      Visit {visitNo} · {dateTime(it.at)}
                      {it.device ? ` · ${it.device}` : ''}
                    </div>
                  )}
                  <div className="flex gap-3 pb-3">
                    <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', TONE[it.type] || 'bg-slate-100 text-slate-600')}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800">
                        <span className={cx(it.type === 'VIEW_VDP' || it.type === 'LEAD_SUBMITTED' ? 'font-semibold' : '')}>{it.label}</span>
                        {detail && <span className="text-slate-500"> — {detail}</span>}
                      </div>
                      <div className="truncate text-[11px] text-slate-400">
                        {new Date(it.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        {it.pagePath && it.type !== 'LEAD_SUBMITTED' ? ` · ${it.pagePath}` : ''}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
