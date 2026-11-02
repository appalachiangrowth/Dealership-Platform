export const money = (n: unknown, currency = 'USD') => {
  const v = Number(n);
  if (n === null || n === undefined || n === '' || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
};

export const num = (n: unknown) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));

export const date = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const dateTime = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const ago = (d?: string | Date | null) => {
  if (!d) return 'never';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return date(d);
};

export const vehicleName = (v: { year?: number | null; make?: string; model?: string; trim?: string }) =>
  [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || 'Untitled vehicle';

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
