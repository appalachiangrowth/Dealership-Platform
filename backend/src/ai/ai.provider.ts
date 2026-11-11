/**
 * AI Quick Add — talking to the AI (ported from the PHP api.php of AI Quick Add v4.2).
 *
 * Settings (backend .env):
 *   AI_PROVIDER        gemini (default, free tier) | openrouter (free models) | qwen | claude
 *   GEMINI_API_KEY     https://aistudio.google.com/apikey            GEMINI_MODEL      (default gemini-2.5-flash-lite)
 *   OPENROUTER_API_KEY https://openrouter.ai/keys                    OPENROUTER_MODEL  (default qwen/qwen2.5-vl-72b-instruct:free)
 *   QWEN_API_KEY       + QWEN_BASE_URL                                QWEN_MODEL        (default qwen-vl-max)
 *   ANTHROPIC_API_KEY                                                 CLAUDE_MODEL      (default claude-sonnet-5-5)
 *   AI_MAX_PER_HOUR    AI requests per dealership per hour (default 60)
 * The key stays on the server; the browser never sees it.
 */

type Provider = { keyEnv: string; modelEnv: string; def: string; base: string | null; name: string };

const PROVIDERS: Record<string, Provider> = {
  gemini: { keyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', def: 'gemini-2.5-flash-lite', base: 'https://generativelanguage.googleapis.com/v1beta/openai', name: 'Gemini' },
  openrouter: { keyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', def: 'qwen/qwen2.5-vl-72b-instruct:free', base: 'https://openrouter.ai/api/v1', name: 'OpenRouter' },
  qwen: { keyEnv: 'QWEN_API_KEY', modelEnv: 'QWEN_MODEL', def: 'qwen-vl-max', base: null, name: 'Qwen' },
  claude: { keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'CLAUDE_MODEL', def: 'claude-sonnet-5-5', base: null, name: 'Claude' },
};

export function aiConfig() {
  let id = String(process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
  if (!PROVIDERS[id]) id = 'gemini';
  const p = PROVIDERS[id];
  const key = String(process.env[p.keyEnv] || '').trim();
  const model = String(process.env[p.modelEnv] || '').trim() || p.def;
  const base = id === 'qwen' ? String(process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1') : p.base || '';
  return { id, name: p.name, keyEnv: p.keyEnv, key, model, base, oai: id !== 'claude', maxPerHour: Number(process.env.AI_MAX_PER_HOUR) || 60 };
}

export class AiError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

/* ---------- http ---------- */
export async function httpJson(url: string, payload?: unknown, headers: Record<string, string> = {}, timeoutMs = 150_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: ctl.signal,
    });
    const raw = await res.text();
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      /* not JSON */
    }
    return { code: res.status, json, raw };
  } catch (e) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
    throw new AiError(`Could not reach ${host}: ${(e as Error).name === 'AbortError' ? 'it took too long' : (e as Error).message}`, 502);
  } finally {
    clearTimeout(t);
  }
}

export function extractJson(text: string): any {
  const t = String(text || '').replace(/```json|```/g, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new AiError('The AI did not return its findings in the right format. Try again.');
  try {
    const j = JSON.parse(t.slice(a, b + 1));
    if (j && typeof j === 'object') return j;
  } catch {
    /* fall through */
  }
  throw new AiError('The AI did not return its findings in the right format. Try again.');
}

/* ---------- OpenAI-style providers (Gemini, OpenRouter, Qwen) ---------- */
// Gemini: JSON mode + little or no "thinking" is fastest. Models accept different values,
// so the combinations are tried once and the first that works is remembered (per process).
let geminiCombo: [string | null, boolean] | null = null;

export async function oaiCall(messages: unknown[], maxTokens: number, json = false): Promise<{ text: string; usage: unknown }> {
  const c = aiConfig();
  if (!c.key) throw new AiError(`AI is not set up yet: add ${c.keyEnv} to the backend .env file.`, 503);
  const headers: Record<string, string> = { Authorization: `Bearer ${c.key}` };
  if (c.base.includes('openrouter.ai')) headers['X-Title'] = 'Dealer Portal AI Quick Add';
  const payload: Record<string, unknown> = { model: c.model, max_tokens: maxTokens, temperature: 0.1, messages };
  const combos: [string | null, boolean][] =
    c.id === 'gemini' ? (geminiCombo ? [geminiCombo] : [['none', true], ['minimal', true], ['low', true], [null, true], [null, false]]) : [[null, false]];

  let r: Awaited<ReturnType<typeof httpJson>> | null = null;
  for (let i = 0; i < combos.length; i++) {
    const [eff, jm] = combos[i];
    const body: Record<string, unknown> = { ...payload };
    if (eff !== null) body.reasoning_effort = eff;
    if (json && jm) body.response_format = { type: 'json_object' };
    r = await httpJson(`${c.base.replace(/\/+$/, '')}/chat/completions`, body, headers);
    if (r.code === 400 && i < combos.length - 1) continue; // setting not supported: try the next one
    if (c.id === 'gemini' && r.code < 400) geminiCombo = [eff, jm];
    break;
  }
  if (!r) throw new AiError('No answer from the AI.');
  if (r.code === 429) throw new AiError(`The ${c.name} limit was reached for now. Wait a minute (or until tomorrow for the daily limit) and try again.`, 429);
  const j = r.json;
  if (r.code >= 400 || !j) {
    const e = (Array.isArray(j) ? j[0]?.error : j?.error) ?? null;
    const msg = e && typeof e === 'object' ? e.message || JSON.stringify(e) : e || j?.message || String(r.raw || '').slice(0, 200);
    throw new AiError(`${c.name} API error (${r.code}): ${msg}`, 502);
  }
  let text = j?.choices?.[0]?.message?.content ?? '';
  if (Array.isArray(text)) text = text.map((p: { text?: string }) => p?.text || '').join('');
  if (!String(text).trim()) throw new AiError(`${c.name} returned an empty answer. Try again.`, 502);
  return { text: String(text), usage: j?.usage ?? null };
}

/* ---------- Claude ---------- */
export async function claudeCall(payload: Record<string, unknown>): Promise<any> {
  const c = aiConfig();
  if (!c.key) throw new AiError('AI is not set up yet: add ANTHROPIC_API_KEY to the backend .env file.', 503);
  const r = await httpJson('https://api.anthropic.com/v1/messages', { ...payload, model: c.model }, { 'x-api-key': c.key, 'anthropic-version': '2023-06-01' });
  if (r.code === 429) throw new AiError('The Claude limit was reached for now. Wait a minute and try again.', 429);
  if (r.code >= 400 || !r.json) throw new AiError(`Claude API error: ${r.json?.error?.message || r.code}`, 502);
  return r.json;
}

export function claudeText(j: any): string {
  return (j?.content || []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
}

/** Plain text answer from whichever provider is set. */
export async function aiText(prompt: string, maxTokens: number): Promise<{ text: string; usage: unknown }> {
  if (aiConfig().oai) return oaiCall([{ role: 'user', content: prompt }], maxTokens);
  const j = await claudeCall({ max_tokens: Math.min(maxTokens, 2000), messages: [{ role: 'user', content: prompt }] });
  return { text: claudeText(j), usage: j.usage ?? null };
}

/* ---------- rate limit: AI requests per dealership per hour ---------- */
const hits = new Map<string, number[]>();
export function aiAllowed(tenantId: string, max: number): boolean {
  const now = Date.now();
  const list = (hits.get(tenantId) || []).filter((t) => now - t < 3_600_000);
  if (list.length >= max) {
    hits.set(tenantId, list);
    return false;
  }
  list.push(now);
  hits.set(tenantId, list);
  return true;
}
