/**
 * GET /pa-keys.json?theme=<design>
 * Which website texts each page of a design shows — the Dealership Portal uses it to open the right page
 * in its live preview when a text is being edited.
 */
import { loadTheme, templateKeys, themesInstalled } from '@/lib/engine';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('theme') || '';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id) || !themesInstalled()[id]) return new Response(JSON.stringify({ error: 'Unknown design' }), { status: 404, headers });
  const theme = loadTheme(id, '');
  return new Response(JSON.stringify({ theme: theme.id, version: theme.version, pages: templateKeys(theme) }), { headers });
}
