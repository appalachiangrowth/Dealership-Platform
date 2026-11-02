/**
 * ONE-TIME MIGRATION: old PHP platform (storage/*.json)  →  PostgreSQL
 *
 *   1. Set LEGACY_PATH in .env to the old project folder (the one that contains storage/)
 *   2. npx prisma migrate deploy && npm run db:seed
 *   3. npm run migrate:legacy
 *
 * What it moves: platform owners (same passwords), platform settings, theme prices, every dealership with its
 * domains, business details, team logins (same passwords), vehicles, blog posts, inquiries + replies, website
 * text, brand colours, design licences/requests, field rules, set-up progress, activity log, and all photos
 * (copied to backend/uploads/<dealership>/…). It is safe to run again: rows that already exist are skipped.
 * Not moved: CarGurus submissions (re-submit and approve them once in the new admin).
 */
import 'dotenv/config';
import { existsSync, readFileSync, readdirSync, cpSync, statSync } from 'fs';
import { join } from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hoursTexts } from '../src/tenants/settings.fields.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const ROOT = process.env.LEGACY_PATH || process.argv[2] || '';
const STORAGE = join(ROOT, 'storage');
const UPLOADS = join(process.cwd(), 'uploads');

type J = Record<string, any>;
const read = (p: string, d: any = null): any => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d;
  } catch {
    console.warn('  ! could not read', p);
    return d;
  }
};
const str = (v: unknown, max = 4000) => (v === null || v === undefined ? '' : String(v)).slice(0, max);
const date = (v: unknown) => {
  const d = v ? new Date(String(v)) : null;
  return d && !isNaN(d.getTime()) ? d : undefined;
};
const numOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'item';

/** "uploads/2026/10/x.jpg" (old, per-dealer) → "/uploads/<tenant>/2026/10/x.jpg" (new) */
const img = (tid: string, u: unknown) => {
  const s = str(u, 600).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const clean = s.replace(/^\/+/, '');
  return clean.startsWith('uploads/') ? `/uploads/${tid}/${clean.slice('uploads/'.length)}` : '';
};

const ROLE: Record<string, string> = { admin: 'ADMIN', staff: 'STAFF', inventory: 'INVENTORY', leads: 'LEADS', marketing: 'MARKETING', custom: 'CUSTOM' };
const SOURCE: Record<string, string> = { signup: 'SIGNUP', platform: 'PLATFORM', dealer: 'DEALER', setup: 'SETUP' };
const LEAD_STATUS: Record<string, string> = { unread: 'UNREAD', new: 'UNREAD', read: 'READ', replied: 'REPLIED', closed: 'CLOSED', done: 'CLOSED', archived: 'CLOSED' };

/** old CSS variable → new colour key, per design */
const COLOR_VARS: Record<string, Record<string, string>> = {
  classic: { '--color-primary': 'primary', '--color-navy': 'dark', '--home-accent': 'accent' },
  atelier: { '--color-primary': 'primary', '--hub-accent': 'accent', '--color-navy': 'dark' },
  'apex-drift': { '--color-primary': 'primary', '--sodium': 'accent', '--asphalt': 'dark' },
  halcyon: { '--sr-accent': 'accent', '--sr-night': 'dark', '--sr-paper': 'light', '--sr-paint': 'paint' },
  vroomfox: { '--blue': 'primary', '--blue-d': 'dark' },
};

/** old vehicle field → new column (field rules) */
const FIELD_MAP: Record<string, string> = {
  stock: 'stockNumber', ext: 'exteriorColor', int: 'interiorColor', trans: 'transmission', fuel: 'fuelType', body: 'bodyStyle',
  type: 'vehicleType', images: 'images', photos: 'images', year: 'year', make: 'make', model: 'model', trim: 'trim', price: 'price',
  mileage: 'mileage', vin: 'vin', engine: 'engine', drivetrain: 'drivetrain', description: 'description',
};

async function owners() {
  const d = read(join(STORAGE, 'platform/users.json'), { users: [] });
  for (const u of d.users || []) {
    const login = str(u.login, 120).toLowerCase();
    if (!login || (await prisma.platformOwner.findUnique({ where: { login } }))) continue;
    await prisma.platformOwner.create({
      data: { login, name: str(u.name, 120), email: str(u.email, 160), passwordHash: str(u.hash), disabled: !!u.disabled, lastLoginAt: date(u.last_login), createdAt: date(u.created) },
    });
    console.log('  owner', login);
  }
}

async function platformSettings() {
  const s = read(join(STORAGE, 'platform/settings.json'), {});
  const groups: Record<string, J> = {};
  if (s.smtp) groups.smtp = { host: s.smtp.host, port: Number(s.smtp.port) || 465, secure: s.smtp.secure || 'ssl', user: s.smtp.user, pass: s.smtp.pass, from: s.smtp.from };
  if (s.keys) groups.keys = { googleMaps: s.keys.google_maps, facebookAppId: s.keys.facebook_app_id, facebookAppSecret: s.keys.facebook_app_secret, recaptchaSite: s.keys.recaptcha_site, recaptchaSecret: s.keys.recaptcha_secret };
  if (s.feeds) groups.feeds = { cargurusCron: s.feeds.cargurus_cron, inventoryXml: s.feeds.inventory_xml, facebookPoster: s.feeds.facebook_poster };
  if (s.features) groups.features = s.features;
  if (s.support) groups.support = s.support;
  if (s.signup) groups.signup = { enabled: s.signup.enabled, baseDomain: s.signup.base_domain, theme: s.signup.theme };
  const tp = read(join(STORAGE, 'platform/theme-pricing.json'), {});
  if (tp.payment?.instructions) groups.payment = { instructions: tp.payment.instructions };
  for (const [group, data] of Object.entries(groups)) {
    if (await prisma.platformSetting.findUnique({ where: { group } })) continue;
    await prisma.platformSetting.create({ data: { group, data } });
    console.log('  platform setting', group);
  }
  for (const [id, p] of Object.entries<J>(tp.themes || {})) {
    if (!(await prisma.theme.findUnique({ where: { id } }))) continue;
    await prisma.theme.update({
      where: { id },
      data: { paid: !!p.paid, price: Number(p.price) || 0, currency: str(p.currency, 3) || 'USD', billing: p.billing === 'monthly' ? 'MONTHLY' : p.billing === 'yearly' ? 'YEARLY' : 'ONE_TIME', priceNote: str(p.note, 300) },
    });
  }
}

async function tenant(id: string, r: J) {
  const dir = join(STORAGE, 'tenants', id);
  if (await prisma.tenant.findUnique({ where: { id } })) {
    console.log(`  - ${id} already migrated, skipped`);
    return;
  }
  const s = read(join(dir, 'settings.json'), {});
  let hours: J = {};
  try {
    hours = s.hours_json ? JSON.parse(s.hours_json) : {};
  } catch {
    hours = {};
  }
  const ht = hoursTexts(hours);
  const domains: string[] = [...new Set<string>((r.domains || []).map((d: string) => String(d).toLowerCase().replace(/:\d+$/, '')))];
  const free: string[] = [];
  for (const d of domains) if (!(await prisma.tenantDomain.findUnique({ where: { domain: d } }))) free.push(d);

  await prisma.tenant.create({
    data: {
      id,
      name: str(r.name, 120) || id,
      dealerCode: str(r.dealer_code, 30) || `AGS-${id}`,
      status: r.status === 'suspended' ? 'SUSPENDED' : 'ACTIVE',
      themeId: r.theme || 'classic',
      channel: r.channel === 'beta' ? 'BETA' : 'STABLE',
      themePin: str(r.theme_pin, 20),
      features: Array.isArray(r.features) ? {} : r.features || {},
      notes: str(r.notes, 1000),
      onboarding: read(join(dir, 'data/onboarding.json'), {}),
      createdAt: date(r.created),
      domains: { create: free.map((domain, i) => ({ domain, isPrimary: i === 0 })) },
      settings: {
        create: {
          name: str(s.name, 120) || str(r.name, 120),
          legalName: str(s.legal_name),
          tagline: str(s.tagline),
          logo: img(id, s.logo),
          phone: str(s.phone),
          email: str(s.email),
          street: str(s.street),
          city: str(s.city),
          state: str(s.state),
          stateName: str(s.state_name),
          zip: str(s.zip),
          country: str(s.country),
          lat: str(s.lat),
          lng: str(s.lng),
          hours,
          hoursWeek: str(s.hours_week) || ht.hoursWeek,
          hoursWeekend: str(s.hours_weekend) || ht.hoursWeekend,
          hoursShort: str(s.hours_short) || ht.hoursShort,
          facebook: str(s.facebook),
          instagram: str(s.instagram),
          google: str(s.google),
          googleReviews: str(s.google_reviews),
          youtube: str(s.youtube),
          tiktok: str(s.tiktok),
          messenger: str(s.messenger),
          siteUrl: str(s.site_url),
          themeColor: str(s.theme_color) || '#062B49',
          leadTo: str(s.lead_to),
          smtpHost: str(s.smtp_host),
          smtpPort: Number(s.smtp_port) || 465,
          smtpSecure: s.smtp_secure === 'tls' ? 'TLS' : s.smtp_secure === 'none' ? 'NONE' : 'SSL',
          smtpUser: str(s.smtp_user),
          smtpPass: str(s.smtp_pass),
          smtpFrom: str(s.smtp_from),
          smtpFromName: str(s.smtp_from_name),
          maxUploadMb: Number(s.max_upload_mb) || 12,
          brandImages: s.brand_images !== false,
          brandBandColor: str(s.brand_band_color) || '#EAF0F8',
          dealerCrmEmail: str(s.dealer_crm_email),
          dealerCrmFormat: s.dealer_crm_format === 'adf' ? 'adf' : 'text',
          dealerRadius: str(s.dealer_radius),
          feedOperation: str(s.feed_operation),
          feedCompleteBatch: s.feed_complete_batch === 'N' ? 'N' : 'Y',
          feedToken: str(s.feed_token),
          cargurusFtpHost: str(s.cargurus_ftp_host),
          cargurusFtpUser: str(s.cargurus_ftp_user),
          cargurusFtpPass: str(s.cargurus_ftp_pass),
          cargurusFtpPort: Number(s.cargurus_ftp_port) || 21,
          cargurusFtpSsl: !!s.cargurus_ftp_ssl,
          cargurusRemoteDir: str(s.cargurus_remote_dir),
          cargurusRemoteName: str(s.cargurus_remote_name) || 'inventory.csv',
        },
      },
    },
  });
  if (free.length < domains.length) console.warn(`  ! ${id}: some domains were already used and were skipped`);

  // team
  const users = read(join(dir, 'users.json'), { users: [] }).users || [];
  for (const u of users) {
    await prisma.dealerUser.create({
      data: {
        tenantId: id,
        login: str(u.login, 120).toLowerCase(),
        name: str(u.name, 120),
        email: str(u.email, 160),
        phone: str(u.phone, 40),
        role: (ROLE[u.role] || 'STAFF') as never,
        perms: Array.isArray(u.perms) ? u.perms : [],
        passwordHash: str(u.hash),
        disabled: !!u.disabled,
        source: (SOURCE[u.source] || 'MIGRATED') as never,
        signupIp: str(u.signup_ip, 64),
        lastLoginAt: date(u.last_login),
        createdAt: date(u.created),
      },
    });
  }

  // vehicles + posts
  const inv = read(join(dir, 'inventory.json'), { vehicles: [], posts: [] });
  const vehicleIds = new Map<string, string>();
  const slugs = new Set<string>();
  for (const v of inv.vehicles || []) {
    let slug = slugify(str(v.slug) || [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || 'vehicle');
    for (let i = 2; slugs.has(slug); i++) slug = `${slugify(str(v.slug) || [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '))}-${i}`;
    slugs.add(slug);
    const st = String(v.status || 'published').toLowerCase();
    const created = await prisma.vehicle.create({
      data: {
        tenantId: id,
        legacyId: str(v.id, 60),
        slug,
        title: str(v.title, 200),
        metaTitle: str(v.metaTitle, 200),
        metaDescription: str(v.metaDescription, 320),
        year: numOrNull(v.year),
        make: str(v.make, 60),
        model: str(v.model, 80),
        trim: str(v.trim, 80),
        vehicleType: str(v.type, 40),
        bodyStyle: str(v.body, 40),
        condition: str(v.condition, 20) || 'Used',
        certified: String(v.certified).toLowerCase() === 'yes' || v.certified === true,
        price: numOrNull(v.price),
        msrp: numOrNull(v.msrp),
        mileage: numOrNull(v.mileage) === null ? null : Math.round(numOrNull(v.mileage)!),
        stockNumber: str(v.stock, 40),
        vin: str(v.vin, 17).toUpperCase(),
        exteriorColor: str(v.ext, 60),
        interiorColor: str(v.int, 60),
        engine: str(v.engine, 80),
        horsepower: str(v.hp, 20),
        drivetrain: str(v.drivetrain, 60),
        transmission: str(v.trans, 60),
        fuelType: str(v.fuel, 40),
        mpg: str(v.mpg, 40),
        fuelTank: str(v.tank, 20),
        doors: str(v.doors, 10),
        seats: str(v.seats, 10),
        owners: str(v.owners, 10),
        accidents: str(v.accidents, 10),
        dealLabel: str(v.deal, 80),
        description: str(v.description, 8000),
        features: (v.features || []).map((x: unknown) => str(x, 120)).filter(Boolean),
        safetyFeatures: (v.safety || []).map((x: unknown) => str(x, 120)).filter(Boolean),
        images: (v.images || []).map((x: unknown) => img(id, x)).filter(Boolean),
        status: st === 'draft' ? 'DRAFT' : st === 'sold' ? 'SOLD' : 'PUBLISHED',
        featured: v.featured === true,
      },
    });
    vehicleIds.set(str(v.id), created.id);
  }
  const postSlugs = new Set<string>();
  for (const p of inv.posts || []) {
    let slug = slugify(str(p.slug || p.id || p.title));
    for (let i = 2; postSlugs.has(slug); i++) slug = `${slugify(str(p.title))}-${i}`;
    postSlugs.add(slug);
    await prisma.blogPost.create({
      data: {
        tenantId: id,
        legacyId: str(p.id, 80),
        title: str(p.title, 200) || 'Untitled',
        slug,
        excerpt: str(p.excerpt, 600),
        body: str(p.content || p.body, 60000),
        coverImage: img(id, p.image),
        category: str(p.tag, 80),
        metaTitle: str(p.metaTitle, 200),
        metaDescription: str(p.metaDescription, 320),
        status: p.status === 'draft' ? 'DRAFT' : 'PUBLISHED',
        publishedAt: date(p.date) || new Date(),
      },
    });
  }
  if (inv.leadForm) await prisma.tenant.update({ where: { id }, data: { leadForm: inv.leadForm } });

  // inquiries
  const msgs = read(join(dir, 'data/messages.json'), []);
  for (const m of Array.isArray(msgs) ? msgs : []) {
    await prisma.lead.create({
      data: {
        tenantId: id,
        name: str(m.name, 120) || 'Unknown',
        email: str(m.email, 160),
        phone: str(m.phone, 40),
        topic: str(m.topic, 160) || 'Website inquiry',
        message: str(m.message, 4000),
        page: str(m.page, 300),
        vehicleId: vehicleIds.get(str(m.vehicleId)) ?? null,
        source: m.source === 'vehicle' ? 'VEHICLE' : 'CONTACT',
        status: (LEAD_STATUS[String(m.status || 'unread')] || 'READ') as never,
        notes: str(m.notes, 4000),
        createdAt: date(m.createdAt),
        replies: {
          create: (m.replies || []).map((r: J) => ({
            body: str(r.body, 8000),
            sentBy: str(r.by, 160),
            toEmail: str(r.to, 160),
            fromEmail: str(r.from, 160),
            replyTo: str(r.replyTo, 160),
            emailed: true,
            createdAt: date(r.createdAt),
          })),
        },
      },
    });
  }

  // website text (+ history)
  const content = read(join(dir, 'content.json'), { values: {} });
  for (const [key, value] of Object.entries<string>(content.values || {})) {
    await prisma.contentValue.create({ data: { tenantId: id, key, value: str(value, 8000) } });
  }
  const histDir = join(dir, 'content-history');
  if (existsSync(histDir)) {
    for (const f of readdirSync(histDir).filter((f) => f.endsWith('.json')).sort().slice(-40)) {
      const h = read(join(histDir, f), null);
      if (h) await prisma.contentVersion.create({ data: { tenantId: id, values: h.values || h, savedBy: str(h.by || h.user, 160), createdAt: statSync(join(histDir, f)).mtime } });
    }
  }

  // brand colours per design
  const design = read(join(dir, 'design.json'), {});
  const designThemes: J = design.themes || (design.colors ? { [r.theme || 'classic']: { colors: design.colors } } : {});
  for (const [themeId, v] of Object.entries<J>(designThemes)) {
    const map = COLOR_VARS[themeId];
    if (!map || !v?.colors || Array.isArray(v.colors)) continue;
    const colors: Record<string, string> = {};
    for (const [cssVar, hex] of Object.entries<string>(v.colors)) if (map[cssVar]) colors[map[cssVar]] = hex;
    if (Object.keys(colors).length && (await prisma.theme.findUnique({ where: { id: themeId } })))
      await prisma.designColors.create({ data: { tenantId: id, themeId, colors } });
  }

  // design licences
  const lic = read(join(dir, 'data/theme-licenses.json'), { unlocked: {}, requests: [] });
  const bill = (b: string) => (b === 'monthly' ? 'MONTHLY' : b === 'yearly' ? 'YEARLY' : 'ONE_TIME') as never;
  for (const [themeId, u] of Object.entries<J>(lic.unlocked || {})) {
    if (!(await prisma.theme.findUnique({ where: { id: themeId } }))) continue;
    await prisma.themeLicense.create({
      data: { tenantId: id, themeId, amount: Number(u.amount) || 0, currency: str(u.currency, 3) || 'USD', billing: bill(u.billing), note: str(u.note), grantedBy: str(u.by), createdAt: date(u.at) },
    });
  }
  for (const q of lic.requests || []) {
    if (!(await prisma.theme.findUnique({ where: { id: q.theme } }))) continue;
    await prisma.themeLicenseRequest.create({
      data: {
        tenantId: id,
        themeId: q.theme,
        status: q.status === 'paid' ? 'PAID' : q.status === 'declined' ? 'DECLINED' : 'PENDING',
        requestedBy: str(q.by),
        requestedByName: str(q.byName),
        note: str(q.note),
        price: Number(q.price) || 0,
        currency: str(q.currency, 3) || 'USD',
        billing: bill(q.billing),
        reviewedBy: str(q.review?.by),
        reviewNote: str(q.review?.note),
        reviewedAt: date(q.review?.at),
        amountPaid: q.review?.amount !== undefined ? Number(q.review.amount) : null,
        createdAt: date(q.at),
      },
    });
  }

  // field rules
  const fr = read(join(dir, 'data/field-rules.json'), null);
  if (fr?.rules) {
    const rules: Record<string, string> = {};
    for (const [k, v] of Object.entries(fr.rules)) if (v === 'required') rules[FIELD_MAP[k] || k] = 'required';
    await prisma.fieldRules.create({ data: { tenantId: id, rules, skipDraft: fr.skipDraft !== false } });
  }

  // activity log
  const auditFile = join(dir, 'audit.log');
  if (existsSync(auditFile)) {
    const rows = readFileSync(auditFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-2000);
    if (rows.length)
      await prisma.auditLog.createMany({
        data: rows.map((a: J) => ({ tenantId: id, action: str(a.a, 80), actor: str(a.u, 160), ip: str(a.ip, 64), detail: a.d ?? undefined, createdAt: date(a.t) })),
      });
  }

  // photos
  const up = join(dir, 'uploads');
  if (existsSync(up)) {
    cpSync(up, join(UPLOADS, id), { recursive: true, filter: (src) => !src.endsWith('.htaccess') });
  }
  console.log(`  ✓ ${id}: ${users.length} logins, ${(inv.vehicles || []).length} vehicles, ${(inv.posts || []).length} posts, ${Array.isArray(msgs) ? msgs.length : 0} inquiries`);
}

async function platformAudit() {
  const f = join(STORAGE, 'platform/audit.log');
  if (!existsSync(f) || (await prisma.auditLog.count({ where: { tenantId: null } })) > 0) return;
  const rows = readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-5000);
  if (rows.length)
    await prisma.auditLog.createMany({ data: rows.map((a: J) => ({ action: str(a.a, 80), actor: str(a.u, 160), ip: str(a.ip, 64), detail: a.d ?? undefined, createdAt: date(a.t) })) });
}

async function main() {
  if (!ROOT || !existsSync(STORAGE)) {
    console.error('Set LEGACY_PATH in .env to the old project folder (it must contain storage/).');
    process.exit(1);
  }
  if ((await prisma.theme.count()) === 0) {
    console.error('Run "npm run db:seed" first (it creates the designs).');
    process.exit(1);
  }
  console.log('Migrating from', ROOT);
  console.log('Platform…');
  await owners();
  await platformSettings();
  await platformAudit();
  const reg = read(join(STORAGE, 'platform/tenants.json'), { tenants: {} });
  console.log('Dealerships…');
  for (const [id, r] of Object.entries<J>(reg.tenants || {})) await tenant(id, r);

  // keep new dealer codes after the highest migrated one (AGS-1007 → next is AGS-1008)
  const codes = await prisma.tenant.findMany({ select: { dealerCode: true } });
  const max = Math.max(1000, ...codes.map((c) => Number(c.dealerCode.match(/^AGS-(\d+)$/)?.[1] || 0)));
  await prisma.counter.upsert({ where: { name: 'dealer_code' }, create: { name: 'dealer_code', value: max }, update: { value: max } });
  console.log('✅ Migration finished.');
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
