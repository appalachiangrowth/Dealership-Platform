import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { copyFile, mkdir, rename, rm, writeFile } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { readZip, ZipError } from './zip-reader.js';
import type { AuthUser } from '../common/auth.types.js';

/**
 * Design packages (port of the old api/theme-installer.php, same rules):
 *  - Install: a ZIP with ONE theme.json + templates/ (+ partials/, assets/). Checked first, then installed as a NEW
 *    version — an installed version is never overwritten and nothing is activated.
 *      templates, partials, theme.json → <website>/themes/<id>/<version>/
 *      assets/…                        → <website>/public/themes/<id>/<version>/assets/…
 *  - Activate for a dealership: pins one design version to one dealership only (history kept for rollback).
 *  - Roll back: restores the dealership's previous design.
 * The website app folder is ../frontend next to the backend; set WEBSITE_DIR in backend/.env when it lives elsewhere.
 */
const MB = 1024 * 1024;
const ASSET_EXT = ['css', 'js', 'json', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm', 'glb', 'gltf', 'bin'];
const VALID_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export const WEBSITE_DIR = resolve(process.env.WEBSITE_DIR || join(process.cwd(), '..', 'frontend'));
const TEMPLATES_ROOT = join(WEBSITE_DIR, 'themes');
const ASSETS_ROOT = join(WEBSITE_DIR, 'public', 'themes');

type Manifest = { id?: unknown; version?: unknown; name?: unknown; description?: unknown; style?: unknown; author?: unknown; preview?: unknown; pages?: unknown; design?: { colors?: unknown } };

const fail = (m: string): never => {
  throw new BadRequestException(m);
};

/** pai_theme_zip_path: safe relative path or null */
function safeZipPath(name: string): { path: string; directory: boolean } | null {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const directory = name.endsWith('/');
  const trimmed = directory ? name.slice(0, -1) : name;
  if (!trimmed) return null;
  for (const part of trimmed.split('/')) {
    if (!part || part === '.' || part === '..' || part[0] === '.') return null;
    if (!/^[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*$/.test(part)) return null;
  }
  return { path: trimmed, directory };
}

/** pai_theme_extension_allowed */
function allowedFile(rel: string): boolean {
  if (rel === 'theme.json') return true;
  if (/^templates\/[A-Za-z0-9][A-Za-z0-9_-]*\.html$/.test(rel)) return true;
  if (/^partials\/[A-Za-z0-9][A-Za-z0-9_-]*\.html$/.test(rel)) return true;
  if (!/^assets\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}$/.test(rel)) return false;
  return ASSET_EXT.includes(extname(rel).slice(1).toLowerCase());
}

/** Installed versions of a design on disk (ascending). */
export function installedVersions(id: string): string[] {
  const dir = join(TEMPLATES_ROOT, id);
  if (!VALID_ID.test(id) || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((v) => SEMVER.test(v) && existsSync(join(dir, v, 'theme.json')))
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return 0;
    });
}

@Injectable()
export class ThemeInstallerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Validate & install a design ZIP. Returns the installed design; nothing is activated. */
  async install(buf: Buffer, fileName: string, user: AuthUser) {
    if (!buf?.length) fail('Choose a theme ZIP file first.');
    if (buf.length > 40 * MB) fail('Theme ZIP must be smaller than 40 MB.');
    if (!/\.zip$/i.test(fileName || '')) fail('Choose a .zip file.');
    let zip: ReturnType<typeof readZip>;
    try {
      zip = readZip(buf);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (zip.entries.length < 2 || zip.entries.length > 800) fail('Theme ZIP must contain between 2 and 800 entries.');

    // 1. every entry: safe path, no duplicates / links / executables, size limits
    const seen = new Set<string>();
    const files: { e: (typeof zip.entries)[number]; path: string }[] = [];
    const manifests: string[] = [];
    let uncompressed = 0;
    for (const e of zip.entries) {
      const safe = safeZipPath(e.name);
      if (!safe) fail('The ZIP contains an unsafe path. Rebuild the theme ZIP and try again.');
      const path = safe!.path;
      if (seen.has(path)) fail('The ZIP contains duplicate file paths.');
      seen.add(path);
      if (e.symlink) fail('Symbolic links are not allowed in a theme ZIP.');
      if (safe!.directory) continue;
      if (e.encrypted) fail('Password-protected ZIP files are not supported.');
      if (e.size > 15 * MB) fail('A file inside the theme ZIP is too large (15 MB maximum per file).');
      uncompressed += e.size;
      if (uncompressed > 80 * MB) fail('The uncompressed theme is too large (80 MB maximum).');
      if (/\.(php\d*|phtml|phar|cgi|pl|py|sh|exe|dll|so|ini|bat|cmd|ps1)$/i.test(path) || /(^|\/)\.htaccess$|(^|\/)\.user\.ini$/i.test(path)) {
        fail('Executable or server-configuration files are not allowed in theme ZIPs.');
      }
      if (path.split('/').pop()!.toLowerCase() === 'theme.json') manifests.push(path);
      files.push({ e, path });
    }
    if (manifests.length !== 1) fail('Theme ZIP must contain exactly one theme.json manifest.');
    const manifestPath = manifests[0];
    const prefix = manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1) : '';

    // 2. paths relative to theme.json, only theme files
    const rel: { e: (typeof zip.entries)[number]; rel: string }[] = [];
    for (const f of files) {
      let r: string;
      if (f.path === manifestPath) r = 'theme.json';
      else if (prefix && f.path.startsWith(prefix)) r = f.path.slice(prefix.length);
      else if (!prefix) r = f.path;
      else if (/^(README\.md|LICENSE(\.txt)?)$/i.test(f.path)) continue;
      else return fail('All theme files must be inside the same folder as theme.json.');
      if (/^(README\.md|LICENSE(\.txt)?)$/i.test(r)) continue;
      if (!allowedFile(r)) fail(`Unsupported file in theme ZIP: ${r}. Only theme templates, assets and theme.json are allowed.`);
      rel.push({ e: f.e, rel: r });
    }

    // 3. manifest
    let manifest: Manifest;
    try {
      const raw = zip.read(zip.entries.find((x) => x.name === manifestPath || x.name === manifestPath + '')!);
      if (raw.length > 2 * MB) fail('The theme manifest is unreadable or too large.');
      manifest = JSON.parse(raw.toString('utf8').replace(/^﻿/, ''));
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      return fail('The theme.json file is not valid JSON.');
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('The theme.json file is not a valid JSON object.');
    const id = String(manifest.id ?? '');
    const version = String(manifest.version ?? '');
    const name = String(manifest.name ?? '').trim();
    if (!VALID_ID.test(id)) fail('Theme id must use lowercase letters, numbers and hyphens (2–40 characters).');
    if (!SEMVER.test(version)) fail('Theme version must use the format 1.0.0.');
    if (!name || name.length > 120) fail('Theme name is missing or too long.');
    const pages = manifest.pages;
    if (!Array.isArray(pages) || pages.length < 1 || pages.length > 40) fail('Theme manifest must list at least one page template.');
    const relSet = new Map(rel.map((r) => [r.rel, r.e]));
    for (const p of pages as { template?: unknown }[]) {
      const t = String(p?.template ?? '');
      if (!/^[a-z0-9][a-z0-9-]*\.html$/.test(t)) fail('Every page needs a safe template filename such as index.html.');
      const te = relSet.get(`templates/${t}`);
      if (!te || te.size < 1) fail(`Required template is missing: templates/${t}`);
    }

    // 4. never overwrite an installed version
    const siteDest = join(TEMPLATES_ROOT, id, version);
    const assetDest = join(ASSETS_ROOT, id, version, 'assets');
    if (existsSync(siteDest) || existsSync(join(ASSETS_ROOT, id, version))) fail('This theme version is already installed. Upload a new version number instead.');
    if (!existsSync(TEMPLATES_ROOT)) fail(`The website's themes folder was not found (${TEMPLATES_ROOT}). Set WEBSITE_DIR in backend/.env to the website app folder.`);

    // 5. extract into a staging folder, check the text files, then move into place
    const stage = join(TEMPLATES_ROOT, `.install-${randomBytes(6).toString('hex')}`);
    const created: string[] = [];
    try {
      for (const r of rel) {
        const data = zip.read(r.e);
        if (/\.(html|css|js|json|svg)$/i.test(r.rel) && /<\?(php|=|\s)/i.test(data.toString('utf8'))) {
          fail(`PHP code is not allowed in theme files. Remove PHP tags from ${r.rel}.`);
        }
        const target = r.rel.startsWith('assets/') ? join(stage, 'assets', r.rel.slice('assets/'.length)) : join(stage, 'site', r.rel);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data, { flag: 'wx' });
      }
      await mkdir(join(TEMPLATES_ROOT, id), { recursive: true });
      await rename(join(stage, 'site'), siteDest);
      created.push(siteDest);
      if (existsSync(join(stage, 'assets'))) {
        await mkdir(dirname(assetDest), { recursive: true });
        await rename(join(stage, 'assets'), assetDest);
        created.push(join(ASSETS_ROOT, id, version));
      }
    } catch (e) {
      for (const c of created) await rm(c, { recursive: true, force: true }).catch(() => undefined);
      if (e instanceof BadRequestException) throw e;
      if (e instanceof ZipError) throw new BadRequestException(e.message);
      throw new BadRequestException(`The theme could not be installed: ${(e as Error).message}. No active theme or dealership data was changed.`);
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    }

    // 6. register the design + its release (new designs start on this version; existing ones keep their channels)
    const colorSlots = this.colorSlots(manifest);
    const existing = await this.prisma.theme.findUnique({ where: { id } });
    let previewUrl = existing?.previewUrl || '';
    if (!previewUrl) previewUrl = await this.copyPreview(id, version, manifest, rel.map((r) => r.rel));
    if (existing) {
      if (!existing.previewUrl && previewUrl) await this.prisma.theme.update({ where: { id }, data: { previewUrl } });
    } else {
      await this.prisma.theme.create({
        data: {
          id,
          name: name.slice(0, 60),
          description: String(manifest.description ?? '').slice(0, 400),
          style: String(manifest.style ?? 'Custom design').slice(0, 60),
          author: String(manifest.author ?? '').slice(0, 120),
          previewUrl,
          colorSlots: colorSlots as never,
          stableVersion: version,
          sortOrder: await this.prisma.theme.count(),
          enabled: true,
        },
      });
    }
    await this.prisma.themeVersion.upsert({
      where: { themeId_version: { themeId: id, version } },
      create: { themeId: id, version, notes: `Installed from ${fileName.slice(0, 120)}` },
      update: {},
    });
    await this.audit.record('theme.install', { actor: user.login, detail: { theme: id, version, file: fileName } });
    return { ok: true, message: 'Theme validated and installed. It has not been activated yet.', theme: { id, name, version, isNew: !existing } };
  }

  /** Colour slots of a new design from theme.json design.colors (keyed by CSS variable). */
  private colorSlots(m: Manifest) {
    const list = Array.isArray(m.design?.colors) ? (m.design!.colors as { var?: unknown; label?: unknown; default?: unknown; hint?: unknown }[]) : [];
    return list
      .filter((c) => /^--[a-z0-9-]+$/.test(String(c?.var ?? '')) && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(c?.default ?? '')))
      .slice(0, 8)
      .map((c) => ({ key: String(c.var), label: String(c.label || c.var).slice(0, 60), default: String(c.default).toUpperCase(), hint: String(c.hint ?? '').slice(0, 120) }));
  }

  /** Preview picture for the design galleries: theme.json "preview" or assets/preview.(jpg|png|webp). */
  private async copyPreview(id: string, version: string, m: Manifest, rels: string[]) {
    const want = typeof m.preview === 'string' ? m.preview.replace(/^\/+/, '') : '';
    const pick = [want, 'assets/preview.jpg', 'assets/preview.jpeg', 'assets/preview.png', 'assets/preview.webp'].find((p) => p && p.startsWith('assets/') && rels.includes(p));
    if (!pick) return '';
    const ext = extname(pick).toLowerCase();
    const dir = join(process.cwd(), 'public', 'themes');
    try {
      await mkdir(dir, { recursive: true });
      await copyFile(join(ASSETS_ROOT, id, version, 'assets', pick.slice('assets/'.length)), join(dir, `${id}${ext}`));
      return `/themes/${id}${ext}`;
    } catch {
      return '';
    }
  }

  /** Switch ONE dealership to a design version (pinned). Inventory, photos, inquiries, text and settings stay. */
  async activateForTenant(b: { tenantId?: string; themeId?: string; version?: string }, user: AuthUser) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: String(b.tenantId || '') } });
    if (!tenant) throw new NotFoundException('Select a valid dealership first.');
    const themeId = String(b.themeId || '');
    const version = String(b.version || '');
    const theme = await this.prisma.theme.findUnique({ where: { id: themeId }, include: { versions: true } });
    if (!theme) fail('This design is not installed.');
    const onDisk = installedVersions(themeId);
    if (!SEMVER.test(version) || (onDisk.length ? !onDisk.includes(version) : !theme!.versions.some((v) => v.version === version))) {
      fail('This theme version is not installed or failed validation.');
    }
    const history = this.history(tenant.themeHistory);
    history.push({ themeId: tenant.themeId, themePin: tenant.themePin, at: new Date().toISOString(), by: user.login });
    await this.prisma.tenant.update({ where: { id: tenant.id }, data: { themeId, themePin: version, themeHistory: history.slice(-10) as never } });
    await this.audit.record('theme.activate', { tenantId: tenant.id, actor: user.login, detail: { theme: themeId, version, by: 'platform' } });
    return { ok: true, message: `${theme!.name} ${version} activated for ${tenant.name}.` };
  }

  /** Restore the dealership's previous design (the one before the last switch). */
  async rollbackTenant(b: { tenantId?: string }, user: AuthUser) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: String(b.tenantId || '') } });
    if (!tenant) throw new NotFoundException('Select a valid dealership first.');
    const history = this.history(tenant.themeHistory);
    const prev = history.pop();
    if (!prev) fail('There is no previous theme recorded for this dealership yet.');
    const theme = await this.prisma.theme.findUnique({ where: { id: prev!.themeId } });
    if (!theme) fail('The previous theme is no longer installed; rollback is unavailable.');
    if (prev!.themePin && installedVersions(prev!.themeId).length && !installedVersions(prev!.themeId).includes(prev!.themePin)) {
      fail('The previous theme version is no longer usable.');
    }
    await this.prisma.tenant.update({ where: { id: tenant.id }, data: { themeId: prev!.themeId, themePin: prev!.themePin, themeHistory: history as never } });
    await this.audit.record('theme.rollback', { tenantId: tenant.id, actor: user.login, detail: { theme: prev!.themeId, version: prev!.themePin } });
    return { ok: true, message: `Previous theme restored for ${tenant.name}.` };
  }

  /**
   * Delete a design for good: its database rows (releases, price, licences, unlock requests, saved colours) and its
   * files (templates, assets, preview picture). Refused while a dealership uses it, and for Classic (the design new
   * dealerships start with). The seed script skips a built-in design whose files are gone, so it does not come back.
   */
  async removeTheme(id: string, user: AuthUser) {
    const theme = await this.prisma.theme.findUnique({ where: { id } });
    if (!theme) throw new NotFoundException('Design not found');
    if (id === 'classic') fail('Classic is the design new dealerships start with, so it cannot be deleted. Hide it instead (Edit price & release › Enabled off).');
    const using = await this.prisma.tenant.findMany({ where: { themeId: id }, select: { name: true }, orderBy: { name: 'asc' } });
    if (using.length) {
      const names = using.slice(0, 5).map((t) => t.name).join(', ') + (using.length > 5 ? ` and ${using.length - 5} more` : '');
      fail(`${using.length} dealership${using.length === 1 ? ' uses' : 's use'} this design (${names}). Switch ${using.length === 1 ? 'it' : 'them'} to another design first (Install & switch), then delete it.`);
    }
    await this.prisma.theme.delete({ where: { id } }); // releases, licences, requests and colours go with it
    if (VALID_ID.test(id)) {
      await rm(join(TEMPLATES_ROOT, id), { recursive: true, force: true }).catch(() => undefined);
      await rm(join(ASSETS_ROOT, id), { recursive: true, force: true }).catch(() => undefined);
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) await rm(join(process.cwd(), 'public', 'themes', id + ext), { force: true }).catch(() => undefined);
    }
    await this.audit.record('theme.delete', { actor: user.login, detail: { theme: id, name: theme.name } });
    return { ok: true, message: `${theme.name} was deleted.` };
  }

  private history(v: unknown): { themeId: string; themePin: string; at: string; by: string }[] {
    return Array.isArray(v) ? (v as { themeId: string; themePin: string; at: string; by: string }[]).filter((x) => x && typeof x.themeId === 'string') : [];
  }
}
