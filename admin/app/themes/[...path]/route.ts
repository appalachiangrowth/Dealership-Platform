import { proxy } from '@/lib/backend-proxy';

/** /themes/* → the backend's /themes/* files, with a time limit (see lib/backend-proxy.ts). Replaces the old rewrite. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ path?: string[] }> };
const handle = async (req: Request, { params }: Ctx) => proxy(req, (await params).path, '/themes');

export const GET = handle;
export const HEAD = handle;
