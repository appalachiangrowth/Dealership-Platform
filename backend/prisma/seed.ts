/**
 * Seeds the website designs (themes) and their first release.
 * Safe to run many times: existing rows are updated, never duplicated.
 *   npm run db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { BUILTIN_THEMES } from '../src/themes/themes.registry.js';

/** a built-in design deleted in Platform Admin has no files any more: it is not added again */
const WEBSITE_DIR = resolve(process.env.WEBSITE_DIR || join(process.cwd(), '..', 'frontend'));

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  let order = 0;
  for (const t of BUILTIN_THEMES) {
    if (!existsSync(join(WEBSITE_DIR, 'themes', t.id))) {
      console.log(`- ${t.name}: deleted (no files), skipped`);
      continue;
    }
    await prisma.theme.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        name: t.name,
        description: t.description,
        style: t.style,
        author: 'Appalachian Growth Solutions',
        previewUrl: `/themes/${t.id}.jpg`,
        colorSlots: t.colors as never,
        stableVersion: t.version,
        sortOrder: order,
      },
      update: { name: t.name, description: t.description, style: t.style, colorSlots: t.colors as never, previewUrl: `/themes/${t.id}.jpg`, sortOrder: order },
    });
    await prisma.themeVersion.upsert({
      where: { themeId_version: { themeId: t.id, version: t.version } },
      create: { themeId: t.id, version: t.version, notes: 'First release on the new platform' },
      update: {},
    });
    order++;
  }
  console.log(`✅ ${BUILTIN_THEMES.length} designs ready.`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
