import { proxy } from '@/lib/backend-proxy';

/**
 * /api/* → backend, with a hard time limit on every call (see lib/backend-proxy.ts).
 * Replaces the old "/api/:path*" rewrite, which could wait on the backend forever.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ path?: string[] }> };
const handle = async (req: Request, { params }: Ctx) => proxy(req, (await params).path);

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
