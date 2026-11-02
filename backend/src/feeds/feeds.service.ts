import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import * as cg from '../cargurus/ingestion.js';
import type { Tenant, TenantDomain, TenantSettings, Vehicle } from '../generated/prisma/client.js';

const xmlEsc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const tag = (name: string, value: unknown, ind = '    ') => `${ind}<${name}>${xmlEsc(value)}</${name}>`;
const list = (name: string, item: string, arr: string[], ind = '    ') =>
  arr.length ? `${ind}<${name}>\n${arr.map((v) => `${ind}  <${item}>${xmlEsc(v)}</${item}>`).join('\n')}\n${ind}</${name}>` : `${ind}<${name}/>`;

/**
 * Inventory feeds per dealership, built live from the database:
 *  - inventory.xml (public)
 *  - CarGurus CSV of the website inventory (20 columns, only vehicles passing every CarGurus check)
 * ONE eligibility rule for the XML: published + valid 17-char VIN + at least one public photo + no duplicates.
 */
@Injectable()
export class FeedsService {
  constructor(private readonly prisma: PrismaService, private readonly tenants: TenantsService) {}

  siteUrl(t: Tenant & { domains?: TenantDomain[] }, s: Pick<TenantSettings, 'siteUrl'> | null): string {
    if (s?.siteUrl) return s.siteUrl.replace(/\/+$/, '');
    const primary = t.domains?.find((d) => d.isPrimary) ?? t.domains?.[0];
    if (primary && !primary.domain.endsWith('localhost')) return `https://${primary.domain}`;
    return `http://${t.id}.localhost:3000`;
  }

  absUrl(u: string, site: string): string {
    if (/^https?:\/\//i.test(u)) return u;
    return site + (u.startsWith('/') ? u : '/' + u);
  }

  async context(tenantId: string) {
    const t = await this.tenants.get(tenantId);
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const site = this.siteUrl(t, s);
    return { t, s, site };
  }

  dealerMeta(t: Tenant, s: TenantSettings | null, site: string): cg.DealerMeta {
    return cg.buildDealerMeta({
      dealerCode: t.dealerCode,
      name: s?.name || t.name,
      street: s?.street || '',
      city: s?.city || '',
      state: s?.state || '',
      zip: s?.zip || '',
      crmEmail: s?.dealerCrmEmail || s?.leadTo || s?.email || '',
      crmFormat: s?.dealerCrmFormat || 'text',
      phone: s?.phone || '',
      site,
    });
  }

  /** Published vehicles as CarGurus rows (canonical keys). Stock number empty → last 8 of the VIN. */
  inventoryRows(vehicles: Vehicle[], site: string) {
    return vehicles.map((v) => ({
      vin: v.vin,
      make: v.make,
      model: v.model,
      year: v.year ? String(v.year) : '',
      trim: v.trim,
      price: v.price !== null ? String(v.price) : '',
      mileage: v.mileage !== null ? String(v.mileage) : '',
      images: v.images.map((u) => this.absUrl(u, site)),
      ext: v.exteriorColor,
      comments: v.description,
      stock: v.stockNumber || (v.vin.length === 17 ? v.vin.slice(-8) : ''),
      trans: v.transmission,
      options: [...v.features, ...v.safetyFeatures],
    }));
  }

  async xml(tenantId: string) {
    const { t, s, site } = await this.context(tenantId);
    const vehicles = await this.prisma.vehicle.findMany({ where: { tenantId, status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' } });
    const skipped: string[] = [];
    const items: { v: Vehicle; vin: string; stock: string; images: string[] }[] = [];
    const seen = new Set<string>();
    for (const v of vehicles) {
      const name = [v.year, v.make, v.model].filter(Boolean).join(' ');
      const vin = v.vin.toUpperCase();
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
        skipped.push(`${name} - missing or invalid VIN`);
        continue;
      }
      const images = v.images.map((u) => this.absUrl(u, site));
      if (!images.length) {
        skipped.push(`${name} - no public image URL`);
        continue;
      }
      if (seen.has(vin)) {
        skipped.push(`${name} - duplicate VIN`);
        continue;
      }
      seen.add(vin);
      items.push({ v, vin, stock: v.stockNumber || vin.slice(-8), images });
    }
    const m = this.dealerMeta(t, s, site);
    const updated = vehicles.reduce((a, v) => (v.updatedAt > a ? v.updatedAt : a), new Date(0));
    let x = '<?xml version="1.0" encoding="UTF-8"?>\n';
    x += `<inventory dealer="${xmlEsc(m.name)}" dealerId="${xmlEsc(m.id)}" updated="${updated.toISOString()}" vehicleCount="${items.length}" excludedCount="${skipped.length}" dealerPhone="${xmlEsc(m.phone)}" dealerWebsite="${xmlEsc(site)}" dealerLatitude="${xmlEsc(s?.lat)}" dealerLongitude="${xmlEsc(s?.lng)}" dealerRadius="${xmlEsc(s?.dealerRadius)}" completeInventoryBatch="${xmlEsc(s?.feedCompleteBatch || 'Y')}">\n`;
    for (const { v, vin, stock, images } of items) {
      x +=
        [
          '  <vehicle>',
          tag('id', v.legacyId || v.id),
          tag('vin', vin),
          tag('stockNumber', stock),
          tag('year', v.year ?? ''),
          tag('make', v.make),
          tag('model', v.model),
          tag('trim', v.trim),
          tag('vehicleType', v.vehicleType),
          tag('bodyStyle', v.bodyStyle),
          tag('condition', v.condition || 'Used'),
          tag('price', v.price ?? ''),
          tag('msrp', v.msrp ?? ''),
          tag('mileage', v.mileage ?? ''),
          tag('certified', v.certified ? 'true' : 'false'),
          tag('exteriorColor', v.exteriorColor),
          tag('interiorColor', v.interiorColor),
          tag('engine', v.engine),
          tag('horsepower', v.horsepower),
          tag('drivetrain', v.drivetrain),
          tag('transmission', v.transmission),
          tag('fuelType', v.fuelType),
          tag('mpg', v.mpg),
          tag('fuelTankSize', v.fuelTank),
          tag('doors', v.doors),
          tag('seats', v.seats),
          tag('owners', v.owners),
          tag('accidents', v.accidents),
          tag('dealLabel', v.dealLabel),
          tag('featured', v.featured ? 'true' : 'false'),
          tag('status', 'published'),
          tag('description', v.description),
          list('features', 'feature', v.features),
          list('safetyFeatures', 'feature', v.safetyFeatures),
          tag('vehicleUrl', `${site}/index.html#/vehicle/${encodeURIComponent(v.legacyId || v.id)}`),
          list('images', 'imageUrl', images),
          '  </vehicle>',
        ].join('\n') + '\n';
    }
    return { xml: x + '</inventory>\n', eligible: items.length, skipped };
  }

  /** Informational CarGurus CSV of the website inventory + which vehicles are left out and why. */
  async cargurusFromInventory(tenantId: string) {
    const { t, s, site } = await this.context(tenantId);
    const vehicles = await this.prisma.vehicle.findMany({ where: { tenantId, status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' } });
    const records = cg.ingestRows(null, this.inventoryRows(vehicles, site));
    const meta = this.dealerMeta(t, s, site);
    const skipped = records
      .map((r, i) => ({ id: vehicles[i].id, name: [r.year || '', r.make, r.model].join(' ').trim(), issues: Object.values(r._issues).flat() }))
      .filter((x) => x.issues.length);
    return { csv: cg.csv(records, meta, true), records, meta, skipped, vehicles };
  }

  async status(tenantId: string) {
    const { xml, eligible, skipped } = await this.xml(tenantId);
    const cgInv = await this.cargurusFromInventory(tenantId);
    const { s, site } = await this.context(tenantId);
    return {
      xmlUrl: `${site}/inventory.xml`,
      csvPrivateUrl: s?.feedToken ? `${site}/feeds/cargurus.csv?key=<your private key>` : '',
      xmlEligible: eligible,
      xmlSkipped: skipped,
      cargurusEligible: cgInv.records.length - cgInv.skipped.length,
      cargurusSkipped: cgInv.skipped,
      bytes: xml.length,
      siteUrlSet: !!s?.siteUrl,
    };
  }
}
