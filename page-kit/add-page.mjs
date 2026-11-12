#!/usr/bin/env node
/**
 * Adds (or updates) a custom page on the dealer platform from a page JSON file, then publishes it.
 *
 *   node page-kit/add-page.mjs page-kit/pages/financing.json            create/update + publish
 *   node page-kit/add-page.mjs page-kit/pages/financing.json --draft    create/update, do not publish
 *   node page-kit/add-page.mjs page-kit/pages/financing.json --check    only check the file, send nothing
 *
 * Settings (environment variables, or a page-kit/.env file):
 *   API_URL            backend address              default http://localhost:4000
 *   PLATFORM_LOGIN     platform owner login
 *   PLATFORM_PASSWORD  platform owner password
 *
 * Pictures: any "image" / "images" value that is a file on this computer (e.g. "./img/hero.jpg", relative to the
 * page JSON file) is uploaded first and replaced by its /uploads/… address.
 * Same slug + same tenantId already on the platform → that page is updated instead of a new one being created.
 * Needs Node 18 or newer (built-in fetch).
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ---------- settings ---------- */
const envFile = join(HERE, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const API = (process.env.API_URL || 'http://localhost:4000').replace(/\/+$/, '');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const DRAFT = args.includes('--draft');
const CHECK = args.includes('--check');

const die = (msg) => {
  console.error('✖ ' + msg);
  process.exit(1);
};
if (!file) die('Give the page file: node page-kit/add-page.mjs page-kit/pages/financing.json');
const pagePath = resolve(file);
if (!existsSync(pagePath)) die(`File not found: ${pagePath}`);

/* ---------- the page file ---------- */
let page;
try {
  page = JSON.parse(readFileSync(pagePath, 'utf8').replace(/^﻿/, ''));
} catch (e) {
  die(`${basename(pagePath)} is not valid JSON: ${e.message}`);
}

const SECTION_TYPES = ['hero', 'text', 'split', 'cards', 'inventory', 'cta', 'stats', 'testimonials', 'faq', 'gallery', 'form', 'map', 'html', 'spacer'];
const RESERVED = ['index', 'inventory', 'used-cars', 'used-sedans', 'used-trucks', 'used-suvs', 'used-wagons', 'about-us', 'contact-us', 'blog', 'blog-post', 'pages', 'vehicle', 'sitemap', 'robots', 'logo', 'api', 'themes', 'uploads', 'images', 'admin', 'login', 'dealer', 'platform', 'inventory-json', 'pa-keys', 'feed', 'feeds'];
const FIXED_COLOUR = /(?:^|[\s:;,(])(#[0-9a-f]{3,8}\b|rgb\(|hsl\(|\b(?:white|black)\b)/i;

function check(p) {
  const errors = [];
  const warnings = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { errors: ['The file must be one JSON object { … }'], warnings };
  if (!String(p.title || '').trim()) errors.push('"title" is missing');
  if (p.slug !== undefined) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(String(p.slug))) errors.push('"slug" may only use a-z, 0-9 and dashes (e.g. "trade-in-value")');
    if (RESERVED.includes(p.slug)) errors.push(`"slug": "${p.slug}" is used by the themes — choose another`);
  }
  if (!Array.isArray(p.sections) || !p.sections.length) errors.push('"sections" must be a list with at least one section');
  (p.sections || []).forEach((s, i) => {
    const at = `section ${i + 1}${s && s.type ? ` (${s.type})` : ''}`;
    if (!s || !SECTION_TYPES.includes(s.type)) errors.push(`${at}: unknown "type" — use one of ${SECTION_TYPES.join(', ')}`);
    if (s && s.tone && !['page', 'alt', 'dark', 'brand'].includes(s.tone)) errors.push(`${at}: "tone" must be page, alt, dark or brand`);
    if (s && s.type === 'html') {
      const html = String(s.html || '');
      if (!html.trim()) errors.push(`${at}: "html" is empty`);
      if (/<\/?(html|head|body)\b/i.test(html)) errors.push(`${at}: only the content — no <html>, <head> or <body>`);
      if (/<link[^>]+stylesheet|bootstrap|tailwind/i.test(html)) errors.push(`${at}: no outside CSS frameworks / stylesheets (they restyle the theme header and footer)`);
      const css = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join(' ') + ' ' + (html.match(/style="[^"]*"/gi) || []).join(' ');
      const fixed = css.replace(/rgba\(0,\s*0,\s*0,[^)]*\)/gi, '').match(FIXED_COLOUR);
      if (fixed) warnings.push(`${at}: fixed colour "${fixed[1]}" — use var(--pa-primary), var(--pa-text) … so it follows the theme colours`);
      if (/font-family\s*:\s*(?!var\(--pa-)/i.test(css)) warnings.push(`${at}: fixed font — use var(--pa-fh) / var(--pa-fb)`);
    }
  });
  if (JSON.stringify(p.sections || []).length > 400_000) errors.push('The page is too large — split it into two pages');
  return { errors, warnings };
}

const { errors, warnings } = check(page);
warnings.forEach((w) => console.warn('⚠ ' + w));
if (errors.length) die('The page file has problems:\n  - ' + errors.join('\n  - '));
if (CHECK) {
  console.log(`✔ ${basename(pagePath)} is valid (${page.sections.length} sections).`);
  process.exit(0);
}

/* ---------- backend ---------- */
let TOKEN = '';
async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch (e) {
    die(`Cannot reach the backend at ${API} (${e.cause?.code || e.message}). Is it running? Set API_URL if it is elsewhere.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message || res.statusText;
    die(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const uploaded = new Map();
async function upload(value) {
  const v = String(value || '').trim();
  if (!v || /^(https?:)?\/\//i.test(v) || v.startsWith('/uploads/') || v.startsWith('uploads/')) return value;
  const local = isAbsolute(v) ? v : resolve(dirname(pagePath), v);
  if (!existsSync(local)) return value;
  if (uploaded.has(local)) return uploaded.get(local);
  const form = new FormData();
  form.append('file', new Blob([readFileSync(local)], { type: MIME[extname(local).toLowerCase()] || 'application/octet-stream' }), basename(local));
  const r = await api('/platform/pages/media', { method: 'POST', form });
  console.log(`  ↑ ${basename(local)} → ${r.url}`);
  uploaded.set(local, r.url);
  return r.url;
}
/** every "image" / "images" value anywhere in the page (seo, sections, card items) */
async function uploadImages(node) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = await uploadImages(node[i]);
    return node;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (k === 'image' && typeof node[k] === 'string') node[k] = await upload(node[k]);
      else if (k === 'images' && Array.isArray(node[k])) node[k] = await Promise.all(node[k].map(upload));
      else node[k] = await uploadImages(node[k]);
    }
  }
  return node;
}

/* ---------- run ---------- */
const login = process.env.PLATFORM_LOGIN;
const password = process.env.PLATFORM_PASSWORD;
if (!login || !password) die('Set PLATFORM_LOGIN and PLATFORM_PASSWORD (environment or page-kit/.env).');

const auth = await api('/auth/login', { method: 'POST', body: { login, password, portal: 'platform' } });
if (auth.kind !== 'owner' || !auth.token) die('This login is not a platform owner — pages can only be added by a platform owner.');
TOKEN = auth.token;
console.log(`✔ Logged in to ${API}`);

await uploadImages(page);

// update the page that already has this address (same dealership / "all"), otherwise create it
const tenantId = page.tenantId === undefined || page.tenantId === '' ? 'all' : String(page.tenantId);
let existing = null;
if (page.slug) {
  const { pages = [] } = await api(`/platform/pages?${new URLSearchParams({ tenantId, q: page.slug })}`);
  existing = pages.find((p) => p.slug === page.slug && (tenantId === 'all' ? !p.tenantId : p.tenantId === tenantId)) || null;
}
const body = { ...page, tenantId };
const saved = existing
  ? await api(`/platform/pages/${existing.id}`, { method: 'PATCH', body })
  : await api('/platform/pages', { method: 'POST', body });
console.log(`✔ ${existing ? 'Updated' : 'Created'} "${saved.title}" → /${saved.slug} (${tenantId === 'all' ? 'every dealership' : 'dealership ' + tenantId})`);

if (DRAFT) {
  console.log('• Saved as draft (not on the website yet). Publish it in Platform Admin › Pages & SEO or run again without --draft.');
} else {
  await api(`/platform/pages/${saved.id}/publish`, { method: 'POST' });
  console.log(`✔ Published — open /${saved.slug} on a dealership website.`);
}
