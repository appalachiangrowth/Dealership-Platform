import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { clean, isEmail } from '../common/util.js';

type FieldType = ['text', number] | ['int', number] | ['bool', 0] | ['email', number] | ['secret', number] | ['enum', string[]];

/** Platform-wide settings (old storage/platform/settings.json). "secret" values are never sent to the browser. */
export const PLATFORM_SETTINGS_SCHEMA: Record<string, Record<string, FieldType>> = {
  smtp: {
    host: ['text', 120],
    port: ['int', 5],
    secure: ['enum', ['ssl', 'tls', 'none']],
    user: ['text', 160],
    pass: ['secret', 200],
    from: ['email', 160],
    fromName: ['text', 120],
  },
  keys: {
    googleMaps: ['secret', 200],
    facebookAppId: ['text', 60],
    facebookAppSecret: ['secret', 200],
    recaptchaSite: ['text', 200],
    recaptchaSecret: ['secret', 200],
  },
  feeds: { cargurusCron: ['bool', 0], inventoryXml: ['bool', 0], facebookPoster: ['bool', 0] },
  features: { facebook: ['bool', 0], cargurus: ['bool', 0], blog: ['bool', 0] },
  support: { email: ['email', 160], phone: ['text', 40], note: ['text', 400] },
  signup: { enabled: ['bool', 0], baseDomain: ['text', 120], theme: ['text', 40] },
  payment: { instructions: ['text', 3000] },
};

export const PLATFORM_SETTINGS_DEFAULTS: Record<string, Record<string, unknown>> = {
  smtp: { host: '', port: 465, secure: 'ssl', user: '', pass: '', from: '', fromName: '' },
  keys: { googleMaps: '', facebookAppId: '', facebookAppSecret: '', recaptchaSite: '', recaptchaSecret: '' },
  feeds: { cargurusCron: true, inventoryXml: true, facebookPoster: true },
  features: { facebook: true, cargurus: true, blog: true },
  support: { email: '', phone: '', note: '' },
  signup: { enabled: true, baseDomain: '', theme: 'classic' },
  payment: { instructions: '' },
};

export type PlatformSettings = typeof PLATFORM_SETTINGS_DEFAULTS;

@Injectable()
export class PlatformSettingsService {
  private cache: { at: number; value: PlatformSettings } | null = null;
  constructor(private readonly prisma: PrismaService) {}

  async all(fresh = false): Promise<PlatformSettings> {
    if (!fresh && this.cache && Date.now() - this.cache.at < 10_000) return this.cache.value;
    const rows = await this.prisma.platformSetting.findMany();
    const out: PlatformSettings = JSON.parse(JSON.stringify(PLATFORM_SETTINGS_DEFAULTS));
    for (const r of rows) {
      if (out[r.group] && r.data && typeof r.data === 'object') Object.assign(out[r.group], r.data as object);
    }
    this.cache = { at: Date.now(), value: out };
    return out;
  }

  async get<T = unknown>(group: string, key: string, fallback?: T): Promise<T> {
    const s = await this.all();
    const v = s[group]?.[key];
    return (v === undefined ? fallback : v) as T;
  }

  /** Settings for the Platform Admin screen: secrets are replaced by { set: true|false }. */
  async publicView() {
    const s = await this.all(true);
    const out: Record<string, Record<string, unknown>> = {};
    for (const [g, fields] of Object.entries(PLATFORM_SETTINGS_SCHEMA)) {
      out[g] = {};
      for (const [k, t] of Object.entries(fields)) {
        out[g][k] = t[0] === 'secret' ? { set: !!s[g][k] } : s[g][k];
      }
    }
    return out;
  }

  /** Save a partial patch. Empty secret = keep the stored one. */
  async save(patch: Record<string, Record<string, unknown>>) {
    const cur = await this.all(true);
    for (const [g, fields] of Object.entries(PLATFORM_SETTINGS_SCHEMA)) {
      const p = patch?.[g];
      if (!p || typeof p !== 'object') continue;
      const next = { ...cur[g] };
      for (const [k, t] of Object.entries(fields)) {
        if (!(k in p)) continue;
        const v = p[k];
        switch (t[0]) {
          case 'bool':
            next[k] = !!v;
            break;
          case 'int':
            next[k] = Math.max(0, Math.min(99999, parseInt(String(v), 10) || 0));
            break;
          case 'enum':
            if (t[1].includes(String(v))) next[k] = String(v);
            break;
          case 'email': {
            const e = clean(v, t[1]);
            if (e === '' || isEmail(e)) next[k] = e;
            break;
          }
          case 'secret': {
            const sv = clean(v, t[1]);
            if (sv !== '') next[k] = sv;
            if (v === null) next[k] = '';
            break;
          }
          default:
            next[k] = g === 'payment' ? String(v ?? '').slice(0, t[1]) : clean(v, t[1]);
        }
      }
      await this.prisma.platformSetting.upsert({ where: { group: g }, create: { group: g, data: next as never }, update: { data: next as never } });
    }
    this.cache = null;
    return this.publicView();
  }
}
