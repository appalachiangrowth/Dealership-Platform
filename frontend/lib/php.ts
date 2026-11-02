/** Small ports of the PHP helpers the original template engine relies on, so output is byte-for-byte the same. */

/** htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') */
export function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** html_entity_decode for the entities h() produces */
export function hDecode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** nl2br($s, false) */
export function nl2br(s: string): string {
  return s.replace(/(\r\n|\n\r|\n|\r)/g, '<br>$1');
}

/** pa_safe_url: blocks unsafe schemes, encodes characters that could break out of an attribute. */
export function safeUrl(u: unknown, imagesOnly = false): string {
  let s = String(u ?? '').replace(/[\0\r\n\t]/g, '').trim();
  if (s === '') return '';
  const m = s.match(/^([a-z][a-z0-9+.\-]*):/i);
  if (m) {
    const scheme = m[1].toLowerCase();
    const ok = imagesOnly ? ['http', 'https'] : ['http', 'https', 'mailto', 'tel', 'sms'];
    if (!ok.includes(scheme)) return '#';
  } else if (s.startsWith('//')) {
    s = 'https:' + s;
  }
  return s.replace(/"/g, '%22').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20').replace(/\\/g, '%5C').replace(/</g, '%3C').replace(/>/g, '%3E');
}

export function isLocalAsset(v: unknown): boolean {
  const s = String(v ?? '');
  return /^(uploads|themes|images)\/[A-Za-z0-9_\-./]+$/.test(s) && !s.includes('..');
}

/**
 * json_encode($v, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
 */
export function jsonHex(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') {
    const inner = JSON.stringify(v)
      .slice(1, -1)
      .replace(/\\"/g, '\\u0022')
      .replace(/</g, '\\u003C')
      .replace(/>/g, '\\u003E')
      .replace(/&/g, '\\u0026')
      .replace(/'/g, '\\u0027');
    return '"' + inner + '"';
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(jsonHex).join(',') + ']';
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return '{' + entries.map(([k, x]) => jsonHex(k) + ':' + jsonHex(x)).join(',') + '}';
  }
  return 'null';
}
