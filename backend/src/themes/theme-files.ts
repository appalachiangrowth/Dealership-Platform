import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Theme folders on disk. Kept apart from ThemeInstallerService so that ThemesService (which needs
 * installedVersions) and ThemeInstallerService (which injects ThemesService) do not import each other —
 * that import cycle made ThemesService undefined at startup ("Cannot access 'ThemesService' before initialization").
 */
export const VALID_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const SEMVER = /^\d+\.\d+\.\d+$/;

/** The website app folder is ../frontend next to the backend; set WEBSITE_DIR in backend/.env when it lives elsewhere. */
export const WEBSITE_DIR = resolve(process.env.WEBSITE_DIR || join(process.cwd(), '..', 'frontend'));
export const TEMPLATES_ROOT = join(WEBSITE_DIR, 'themes');

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
