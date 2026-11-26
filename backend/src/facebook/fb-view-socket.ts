import { createRequire } from 'module';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import type { AuthGuard } from '../common/auth.guard.js';
import type { FacebookService } from './facebook.service.js';

/**
 * FB Poster live view over ONE WebSocket (instead of an HTTP long-poll per picture and an HTTP POST per click/key):
 *  - server → portal: binary JPEG pictures, pushed the moment Chrome paints them
 *  - portal → server: JSON input events { type: click|move|wheel|key|text, ... }
 *
 * Server load:
 *  - backpressure: while a picture is still on its way to a slow viewer, newer pictures replace each other in a single
 *    slot (only the newest one is kept) — nothing queues up in the server's memory
 *  - the moment the socket closes (viewer closed, tab closed, network gone), Chrome's screencast is stopped
 *  - Chrome is only started the way it always was (Connect Facebook / opening the live view), within the same
 *    MAX_BROWSERS and free-memory limits; the idle reaper still closes it
 *
 * Login: the dealer's normal login token, sent as a WebSocket sub-protocol (browsers cannot set headers on a
 * WebSocket, and a sub-protocol keeps the token out of URLs and server logs):
 *   new WebSocket(url, ['fbview', 'bearer.<token>', 'tenant.<id>' (platform owners in support mode)])
 * The same checks as every /dealer/facebook request run (AuthGuard + the "inventory" permission + FB Poster on).
 */

type WsSocket = {
  readyState: number;
  bufferedAmount: number;
  send(data: Buffer | string, opts?: { binary?: boolean }, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(ev: 'message', fn: (data: Buffer, isBinary: boolean) => void): void;
  on(ev: 'close' | 'pong', fn: () => void): void;
  on(ev: 'error', fn: (e: Error) => void): void;
};
type WsServer = { handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WsSocket) => void): void };
// `ws` is already installed with puppeteer (and listed in package.json); loaded this way it needs no @types package
const { WebSocketServer } = createRequire(import.meta.url)('ws') as { WebSocketServer: new (o: Record<string, unknown>) => WsServer };

/** /dealer/facebook/view/ws (also when a proxy in front keeps a prefix such as /api) */
const PATH = /\/dealer\/facebook\/view\/ws\/?$/;
const OPEN = 1;
const PING_MS = 25_000;
const INPUT_TYPES = new Set(['click', 'move', 'wheel', 'key', 'text']);

function reject(socket: Duplex, code: number, msg: string) {
  socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
  socket.destroy();
}

export function attachFbViewSocket(server: Server, deps: { guard: AuthGuard; fb: FacebookService }) {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false, // JPEGs are already compressed: deflating them again only costs CPU
    maxPayload: 64 * 1024, // input events only
    handleProtocols: (p: Set<string>) => (p.has('fbview') ? 'fbview' : false),
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = String(req.url || '').split('?')[0];
    if (!PATH.test(path)) {
      // not ours; with no other WebSocket endpoint on this server, close it instead of leaving it hanging
      if (server.listenerCount('upgrade') <= 1) socket.destroy();
      return;
    }
    const protos = String(req.headers['sec-websocket-protocol'] || '')
      .split(',')
      .map((s) => s.trim());
    const token = (protos.find((p) => p.startsWith('bearer.')) || '').slice(7);
    const tenant = (protos.find((p) => p.startsWith('tenant.')) || '').slice(7);
    void deps.guard
      .checkSocket(token, tenant, ['inventory'])
      .then(({ user, tenantId }) => {
        wss.handleUpgrade(req, socket, head, (ws) => void serve(ws, user, tenantId));
      })
      .catch((e: { status?: number; message?: string }) => reject(socket, e?.status === 403 ? 403 : 401, e?.message || 'Please log in'));
  });

  async function serve(ws: WsSocket, user: Parameters<FacebookService['openViewer']>[1], tenantId: string) {
    // ---- pictures, with backpressure: one picture on the wire at a time, only the newest one waits ----
    let sending = false;
    let pending: Buffer | null = null;
    const push = (frame: Buffer | null) => {
      if (frame === null) {
        ws.close(4001, 'The Facebook browser was closed.');
        return;
      }
      if (ws.readyState !== OPEN) return;
      if (sending || ws.bufferedAmount > 0) {
        pending = frame; // an older waiting picture is dropped
        return;
      }
      sending = true;
      ws.send(frame, { binary: true }, () => {
        sending = false;
        const next = pending;
        pending = null;
        if (next) push(next);
      });
    };

    let viewer: Awaited<ReturnType<FacebookService['openViewer']>> | null = null;
    let gone = false;
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
      viewer?.seen();
    }, PING_MS);
    ws.on('pong', () => {
      alive = true;
    });
    ws.on('error', () => undefined);
    ws.on('close', () => {
      gone = true;
      clearInterval(ping);
      pending = null;
      void viewer?.close(); // Chrome stops making pictures at once (when this was the last viewer)
    });

    // ---- input, strictly in order ----
    let chain: Promise<unknown> = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      if (!ev || typeof ev !== 'object' || !INPUT_TYPES.has(String(ev.type))) return;
      chain = chain.then(async () => {
        if (!viewer) return;
        try {
          await viewer.input(ev);
        } catch (e) {
          if (ws.readyState === OPEN) ws.send(JSON.stringify({ type: 'error', message: (e as Error).message }));
        }
      });
    });

    try {
      const v = await deps.fb.openViewer(tenantId, user, push);
      if (gone) await v.close();
      else viewer = v;
    } catch (e) {
      // e.g. FB Poster switched off, or the server is at its browser / memory limit
      if (ws.readyState === OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: (e as Error).message || 'The live view could not start.' }));
        ws.close(4002, 'start failed');
      }
    }
  }
}
