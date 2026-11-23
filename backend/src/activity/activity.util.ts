/**
 * Visitor activity: event types, input cleaning and the lead "intent" summary (pure functions, no database).
 */

/** events the storefront tracker may send */
export const CLIENT_EVENTS = ['PAGE_VIEW', 'VIEW_VDP', 'SCROLL_DEPTH', 'TIME_SPENT', 'WHATSAPP_CLICK', 'CALL_CLICK', 'FORM_START'] as const;
/** every event type (LEAD_SUBMITTED is only written by the server, when an inquiry is saved) */
export const EVENT_TYPES = [...CLIENT_EVENTS, 'LEAD_SUBMITTED'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** anonymous browser id made by the tracker: vis_<uuid> (other simple ids are accepted too) */
export const VISITOR_ID = /^[A-Za-z0-9_-]{8,80}$/;
export const cleanVisitorId = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return VISITOR_ID.test(s) ? s : '';
};

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|go-http/i;
export const isBot = (ua: string) => !ua || BOT.test(ua);

/** mobile | desktop (tablets count as mobile) */
export const deviceOf = (ua: string): 'mobile' | 'desktop' => (/Mobi|Android|iPhone|iPad|iPod|Tablet|Silk|Kindle|Opera Mini/i.test(ua) ? 'mobile' : 'desktop');

export const clampInt = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

/** a visit ends after 30 minutes without activity */
export const SESSION_GAP_MS = 30 * 60_000;

export type Intent = 'HOT' | 'WARM' | 'COLD';

export interface ActivityRow {
  eventType: string;
  vehicleId: string | null;
  vehicleTitle?: string | null;
  pagePath?: string | null;
  scrollDepth: number | null;
  durationSec: number | null;
  deviceType?: string | null;
  city?: string | null;
  region?: string | null;
  createdAt: Date;
}

export interface ActivitySummary {
  totalViews: number;
  vdpViews: number;
  vehiclesViewed: number;
  maxScrollDepth: number;
  totalTimeSec: number;
  sessions: number;
  isRepeatVisitor: boolean;
  whatsappClicks: number;
  callClicks: number;
  formStarts: number;
  device: string | null;
  city: string | null;
  region: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  /** 0–100, see intentScore() */
  score: number;
  intentScore: Intent;
}

/**
 * Intent score (0–100 points):
 *   vehicle pages viewed      4 each (max 20)       · distinct vehicles      3 each (max 15)
 *   WhatsApp / call clicks   12 each (max 24)       · forms started          4 (once)
 *   repeat visitor (2+ visits on separate sessions) 15
 *   time on site ≥ 2 min 5 · ≥ 5 min 10              · read a page to 75 %+   5 · to 100 % 7
 *   HOT ≥ 45 · WARM ≥ 20 · otherwise COLD
 */
export function intentScore(s: Omit<ActivitySummary, 'score' | 'intentScore'>): { score: number; intentScore: Intent } {
  let p = 0;
  p += Math.min(20, s.vdpViews * 4);
  p += Math.min(15, s.vehiclesViewed * 3);
  p += Math.min(24, (s.whatsappClicks + s.callClicks) * 12);
  if (s.formStarts > 0) p += 4;
  if (s.isRepeatVisitor) p += 15;
  p += s.totalTimeSec >= 300 ? 10 : s.totalTimeSec >= 120 ? 5 : 0;
  p += s.maxScrollDepth >= 100 ? 7 : s.maxScrollDepth >= 75 ? 5 : 0;
  const score = Math.min(100, p);
  return { score, intentScore: score >= 45 ? 'HOT' : score >= 20 ? 'WARM' : 'COLD' };
}

/** totals for one visitor / lead (rows in any order) */
export function summarize(rows: ActivityRow[]): ActivitySummary {
  const list = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const vehicles = new Set<string>();
  let totalViews = 0, vdpViews = 0, maxScrollDepth = 0, totalTimeSec = 0, whatsappClicks = 0, callClicks = 0, formStarts = 0, sessions = 0;
  let last = 0;
  let device: string | null = null, city: string | null = null, region: string | null = null;
  for (const r of list) {
    const t = r.createdAt.getTime();
    if (!last || t - last > SESSION_GAP_MS) sessions++;
    last = t;
    switch (r.eventType) {
      case 'PAGE_VIEW':
        totalViews++;
        break;
      case 'VIEW_VDP':
        totalViews++;
        vdpViews++;
        if (r.vehicleId) vehicles.add(r.vehicleId);
        break;
      case 'SCROLL_DEPTH':
        maxScrollDepth = Math.max(maxScrollDepth, r.scrollDepth || 0);
        break;
      case 'TIME_SPENT':
        totalTimeSec += r.durationSec || 0;
        break;
      case 'WHATSAPP_CLICK':
        whatsappClicks++;
        break;
      case 'CALL_CLICK':
        callClicks++;
        break;
      case 'FORM_START':
        formStarts++;
        break;
    }
    if (r.deviceType) device = r.deviceType;
    if (r.city) city = r.city;
    if (r.region) region = r.region;
  }
  const base = {
    totalViews, vdpViews, vehiclesViewed: vehicles.size, maxScrollDepth, totalTimeSec, sessions, isRepeatVisitor: sessions >= 2,
    whatsappClicks, callClicks, formStarts, device, city, region,
    firstSeen: list.length ? list[0].createdAt.toISOString() : null,
    lastSeen: list.length ? list[list.length - 1].createdAt.toISOString() : null,
  };
  return { ...base, ...intentScore(base) };
}

export interface TimelineItem {
  at: string;
  type: string;
  label: string;
  pagePath: string | null;
  vehicleId: string | null;
  vehicleTitle: string | null;
  scrollDepth: number | null;
  durationSec: number | null;
  device: string | null;
  /** first event of a new visit */
  newVisit: boolean;
}

const pageName = (p: string | null | undefined) => {
  const s = String(p || '/').split('?')[0].split('#')[0];
  if (s === '/' || s === '' || /^\/index(\.html)?$/.test(s)) return 'Home page';
  return s.replace(/\.html$/, '');
};

/**
 * Chronological journey: each page / vehicle view carries the deepest scroll and the time spent on it
 * ("Viewed 2022 Honda Civic — 85% scroll, 1m 35s"); clicks and the inquiry are their own entries.
 */
export function timeline(rows: ActivityRow[]): TimelineItem[] {
  const list = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const out: TimelineItem[] = [];
  /** latest view per page path of the current visit */
  let views = new Map<string, TimelineItem>();
  let last = 0;
  for (const r of list) {
    const t = r.createdAt.getTime();
    const newVisit = !last || t - last > SESSION_GAP_MS;
    if (newVisit) views = new Map();
    last = t;
    const key = `${r.pagePath || ''}|${r.vehicleId || ''}`;
    const item = (label: string): TimelineItem => ({
      at: r.createdAt.toISOString(), type: r.eventType, label, pagePath: r.pagePath ?? null, vehicleId: r.vehicleId, vehicleTitle: r.vehicleTitle ?? null,
      scrollDepth: null, durationSec: null, device: r.deviceType ?? null, newVisit,
    });
    switch (r.eventType) {
      case 'PAGE_VIEW':
      case 'VIEW_VDP': {
        const it = item(r.eventType === 'VIEW_VDP' ? `Viewed ${r.vehicleTitle || 'a vehicle'}` : `Visited ${pageName(r.pagePath)}`);
        out.push(it);
        views.set(key, it);
        break;
      }
      case 'SCROLL_DEPTH':
      case 'TIME_SPENT': {
        const v = views.get(key) || [...views.values()].reverse().find((x) => x.pagePath === (r.pagePath ?? null));
        if (v) {
          if (r.eventType === 'SCROLL_DEPTH') v.scrollDepth = Math.max(v.scrollDepth || 0, r.scrollDepth || 0);
          else v.durationSec = (v.durationSec || 0) + (r.durationSec || 0);
        }
        break;
      }
      case 'WHATSAPP_CLICK':
        out.push(item('Clicked WhatsApp'));
        break;
      case 'CALL_CLICK':
        out.push(item('Clicked to call'));
        break;
      case 'FORM_START':
        out.push(item('Started filling in a form'));
        break;
      case 'LEAD_SUBMITTED':
        out.push(item(`Submitted an inquiry${r.vehicleTitle ? ` about ${r.vehicleTitle}` : ''}`));
        break;
    }
  }
  return out;
}
