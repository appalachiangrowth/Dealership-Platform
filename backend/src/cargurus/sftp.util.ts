import { createHash } from 'crypto';
import { Client, ConnectConfig } from 'ssh2';

/**
 * CarGurus SFTP transport (ftp.cargurus.com, port 2122).
 *
 * Guarantees:
 *  - one shared way to work out host / port / protocol (resolveCargurusTarget), used by upload, test and dry run
 *  - every connection is closed (end + destroy) on success, failure and timeout
 *  - an upload only counts as done when the remote file is closed AND (when the server still has it) its size matches
 *  - transient network failures are retried; wrong credentials / host key mismatch are not (they would only lock the account)
 *  - the server's host key fingerprint is recorded on every connection and can be pinned with
 *    CARGURUS_SFTP_HOST_FINGERPRINT="SHA256:…" (comma-separated list allowed)
 */

export const CARGURUS_SFTP_HOST = 'ftp.cargurus.com';
export const CARGURUS_SFTP_PORT = 2122;

export interface SftpConnectionOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  passphrase?: string;
  privateKey?: string;
  timeout?: number;
}

export interface CargurusTarget {
  protocol: 'sftp' | 'ftp';
  host: string;
  port: number;
  remoteDir: string;
  remoteName: string;
  /** remote path as the server sees it ("inventory.csv" = the login's home folder) */
  remotePath: string;
  warnings: string[];
}

export function isCargurusHost(host: string) {
  return /(^|\.)cargurus\.com$/i.test(String(host || '').trim());
}

/**
 * Where and how the feed goes. CarGurus' own server always means SFTP on 2122: the database default port is 21
 * (the old FTP setting), so a CarGurus host with port 0 / 21 is corrected to 2122 instead of failing.
 */
export function resolveCargurusTarget(s: {
  cargurusFtpHost?: string | null;
  cargurusFtpPort?: number | null;
  cargurusRemoteDir?: string | null;
  cargurusRemoteName?: string | null;
}): CargurusTarget {
  const warnings: string[] = [];
  const host = String(s.cargurusFtpHost || '').trim() || CARGURUS_SFTP_HOST;
  const rawPort = Number(s.cargurusFtpPort) || 0;
  let protocol: 'sftp' | 'ftp';
  let port: number;
  if (isCargurusHost(host)) {
    protocol = 'sftp';
    if (!rawPort || rawPort === 21) port = CARGURUS_SFTP_PORT;
    else port = rawPort;
    if (port !== CARGURUS_SFTP_PORT) warnings.push(`CarGurus SFTP runs on port ${CARGURUS_SFTP_PORT}, but port ${port} is saved for this dealership.`);
  } else if (rawPort === CARGURUS_SFTP_PORT || rawPort === 22) {
    protocol = 'sftp';
    port = rawPort;
  } else {
    protocol = 'ftp';
    port = rawPort || 21;
    warnings.push(`${host} is not the CarGurus server: the feed is sent by plain FTP on port ${port}.`);
  }
  const remoteDir = String(s.cargurusRemoteDir || '').trim().replace(/\/+$/, '');
  const remoteName = String(s.cargurusRemoteName || '').trim() || 'inventory.csv';
  if (/[\\/]/.test(remoteName)) warnings.push(`The remote file name "${remoteName}" contains a folder separator: put the folder in "Remote folder" instead.`);
  if (!/\.(csv|txt|tsv)$/i.test(remoteName)) warnings.push(`The remote file name "${remoteName}" should end in .csv (CarGurus reads comma-separated files).`);
  const remotePath = remoteDir ? `${remoteDir}/${remoteName}` : remoteName;
  return { protocol, host, port, remoteDir, remoteName, remotePath, warnings };
}

/** "SHA256:base64" — the same format as `ssh-keygen -lf` / `ssh-keyscan | ssh-keygen -lf -` */
function fingerprintOf(key: Buffer) {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

function pinnedFingerprints(): string[] {
  return String(process.env.CARGURUS_SFTP_HOST_FINGERPRINT || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** a classified SFTP failure: what went wrong in words an admin can act on, and whether retrying can help */
export class SftpError extends Error {
  constructor(
    message: string,
    readonly stage: 'config' | 'connect' | 'auth' | 'hostkey' | 'subsystem' | 'directory' | 'write' | 'verify' | 'timeout',
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
  }
}

function classify(err: any, host: string, port: number): SftpError {
  if (err instanceof SftpError) return err;
  const code = err?.code ? String(err.code) : undefined;
  const msg = err?.message || String(err);
  if (err?.level === 'client-authentication') return new SftpError('Login rejected by the server: check the SFTP username and password from CarGurus.', 'auth', false, code);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new SftpError(`Host ${host} could not be found (DNS: ${code}).`, 'connect', code === 'EAI_AGAIN', code);
  if (code === 'ECONNREFUSED') return new SftpError(`Connection refused on ${host}:${port}: wrong port, or the server's firewall does not allow this server's IP address.`, 'connect', true, code);
  if (code === 'ETIMEDOUT' || /timed out/i.test(msg)) return new SftpError(`No answer from ${host}:${port} (timeout): check the port and that outgoing port ${port} is open on this server.`, 'timeout', true, code);
  if (code === 'ECONNRESET' || code === 'EPIPE') return new SftpError(`The connection to ${host}:${port} was cut (${code}).`, 'connect', true, code);
  if (/handshake|kex|key exchange/i.test(msg)) return new SftpError(`SSH handshake with ${host}:${port} failed: ${msg}. Is this really an SFTP port?`, 'connect', false, code);
  if (err?.code === 2 /* SSH_FX_NO_SUCH_FILE */ || /no such file/i.test(msg)) return new SftpError(`Remote folder or file not found: ${msg}`, 'directory', false, String(err?.code ?? ''));
  if (err?.code === 3 /* SSH_FX_PERMISSION_DENIED */ || /permission denied/i.test(msg)) return new SftpError(`Permission denied on the server: ${msg}`, 'write', false, String(err?.code ?? ''));
  return new SftpError(msg, 'connect', true, code);
}

type Session = { conn: Client; sftp: any; fingerprint: string; close: () => void };

/** Opens an authenticated SFTP session. Always cleans up the socket when it fails. */
function openSession(opts: SftpConnectionOptions): Promise<Session> {
  const host = (opts.host || CARGURUS_SFTP_HOST).trim();
  const port = Number(opts.port) || CARGURUS_SFTP_PORT;
  const timeoutMs = opts.timeout ?? 20000;
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let done = false;
    let fingerprint = '';
    const close = () => {
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      try {
        conn.destroy();
      } catch {
        /* ignore */
      }
    };
    let hostKeyRefused = '';
    const fail = (e: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      close();
      // ssh2 reports a refused host key as a generic "Host denied": give the real, non-retryable reason
      reject(hostKeyRefused ? new SftpError(hostKeyRefused, 'hostkey', false) : classify(e, host, port));
    };
    const timer = setTimeout(() => fail(new SftpError(`No answer from ${host}:${port} within ${Math.round(timeoutMs / 1000)}s.`, 'timeout', true)), timeoutMs);

    if (!opts.username) return fail(new SftpError('The SFTP username is missing.', 'config', false));
    if (!opts.password && !(opts.privateKey && opts.privateKey.trim())) return fail(new SftpError('The SFTP password (or private key) is missing.', 'config', false));

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) return fail(new SftpError(`Logged in, but the SFTP subsystem was refused: ${err.message}`, 'subsystem', false));
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ conn, sftp, fingerprint, close });
      });
    });
    conn.on('error', fail);
    conn.on('close', () => fail(new SftpError(`${host}:${port} closed the connection before the login finished.`, 'connect', true)));

    const pins = pinnedFingerprints();
    const config: ConnectConfig = {
      host,
      port,
      username: opts.username,
      readyTimeout: timeoutMs,
      keepaliveInterval: 10000,
      hostVerifier: ((key: Buffer) => {
        fingerprint = fingerprintOf(key);
        if (!pins.length) return true; // not pinned: accepted, fingerprint is reported so it can be pinned
        if (pins.includes(fingerprint)) return true;
        hostKeyRefused = `Host key mismatch for ${host}: the server presented ${fingerprint}, expected ${pins.join(' or ')} (CARGURUS_SFTP_HOST_FINGERPRINT). Nothing was sent.`;
        return false;
      }) as any,
    };
    if (opts.privateKey && opts.privateKey.trim()) {
      config.privateKey = opts.privateKey.trim();
      if (opts.passphrase) config.passphrase = opts.passphrase;
    }
    if (opts.password) config.password = opts.password;
    try {
      conn.connect(config);
    } catch (e) {
      fail(e);
    }
  });
}

const p = <T>(fn: (cb: (err: any, res?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res as T))));

export interface SftpTestResult {
  success: boolean;
  latencyMs?: number;
  message?: string;
  reason?: string;
  stage?: string;
  filesCount?: number;
  hostFingerprint?: string;
  fingerprintPinned?: boolean;
  homeDir?: string;
  directory?: { path: string; exists: boolean; listable: boolean; entries?: number; error?: string };
  write?: { tested: boolean; ok?: boolean; probeFile?: string; cleanedUp?: boolean; error?: string };
}

/**
 * Real SFTP login + checks: home folder, target folder exists and can be listed, and (only when asked) that a file
 * can be written there — a tiny dot-file that is deleted straight away (reported if it could not be removed).
 */
export async function testSftpConnection(opts: SftpConnectionOptions & { remoteDir?: string; checkWrite?: boolean }): Promise<SftpTestResult> {
  const start = Date.now();
  let session: Session | null = null;
  try {
    session = await openSession({ ...opts, timeout: opts.timeout ?? 15000 });
    const { sftp } = session;
    const out: SftpTestResult = { success: false, hostFingerprint: session.fingerprint, fingerprintPinned: pinnedFingerprints().length > 0 };
    out.homeDir = await p<string>((cb) => sftp.realpath('.', cb)).catch(() => undefined);
    const dir = (opts.remoteDir || '').replace(/\/+$/, '') || '.';
    const d: NonNullable<SftpTestResult['directory']> = { path: dir === '.' ? `${out.homeDir || '.'} (login home folder)` : dir, exists: false, listable: false };
    try {
      const st: any = await p((cb) => sftp.stat(dir, cb));
      d.exists = typeof st?.isDirectory === 'function' ? st.isDirectory() : true;
      if (!d.exists) d.error = `${dir} exists but is not a folder`;
    } catch (e: any) {
      d.error = `Folder ${dir} not found on the server (${e?.message || e}): check "Remote folder" in the dealership's CarGurus settings`;
    }
    if (d.exists) {
      try {
        const list: any[] = await p((cb) => sftp.readdir(dir, cb));
        d.listable = true;
        d.entries = Array.isArray(list) ? list.length : 0;
        out.filesCount = d.entries;
      } catch (e: any) {
        d.error = `Folder cannot be listed: ${e?.message || e} (some upload-only accounts cannot list; the upload itself may still work)`;
      }
    }
    out.directory = d;

    out.write = { tested: false };
    if (opts.checkWrite && d.exists) {
      const probe = `${dir === '.' ? '' : dir + '/'}.pa-connection-test-${Date.now()}.tmp`;
      out.write = { tested: true, probeFile: probe };
      try {
        await new Promise<void>((resolve, reject) => {
          const ws = sftp.createWriteStream(probe);
          ws.on('error', reject);
          ws.on('close', () => resolve());
          ws.end(Buffer.from('ok'));
        });
        out.write.ok = true;
      } catch (e: any) {
        out.write.ok = false;
        out.write.error = `Cannot write to the folder: ${e?.message || e}`;
      }
      try {
        await p((cb) => sftp.unlink(probe, cb));
        out.write.cleanedUp = true;
      } catch (e: any) {
        // nothing to clean when the write itself failed
        out.write.cleanedUp = out.write.ok ? false : true;
        if (out.write.ok) out.write.error = `Test file ${probe} was written but could not be deleted: ${e?.message || e}. Remove it by hand.`;
      }
    }

    out.latencyMs = Date.now() - start;
    const problems = [d.exists ? '' : d.error || 'target folder missing', out.write.tested && !out.write.ok ? out.write.error || 'write failed' : ''].filter(Boolean);
    out.success = problems.length === 0;
    out.message = out.success
      ? `Logged in to ${opts.host}:${opts.port} in ${out.latencyMs}ms · folder ${d.path} ${d.listable ? `(${d.entries} item${d.entries === 1 ? '' : 's'})` : 'found'}${out.write.tested ? ' · write test passed, test file removed' : ''}`
      : undefined;
    out.reason = out.success ? undefined : problems.join(' · ');
    out.stage = out.success ? undefined : !d.exists ? 'directory' : 'write';
    return out;
  } catch (e) {
    const err = e instanceof SftpError ? e : classify(e, opts.host || CARGURUS_SFTP_HOST, Number(opts.port) || CARGURUS_SFTP_PORT);
    return { success: false, reason: err.message, stage: err.stage, latencyMs: Date.now() - start };
  } finally {
    session?.close();
  }
}

export interface SftpUploadResult {
  bytes: number;
  remotePath: string;
  attempts: number;
  durationMs: number;
  hostFingerprint: string;
  /** true: the server still had the file and its size matched · false: the server already took the file away (normal for drop folders) */
  verified: boolean;
  verifyNote?: string;
}

async function uploadOnce(opts: SftpConnectionOptions, remotePath: string, buf: Buffer): Promise<Omit<SftpUploadResult, 'attempts' | 'durationMs'>> {
  const session = await openSession(opts);
  const { sftp } = session;
  try {
    // the transfer gets its own deadline: 30 s + 10 s per MB
    const transferMs = 30000 + Math.ceil(buf.length / 1_000_000) * 10000;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const t = setTimeout(() => finish(new SftpError(`Upload of ${remotePath} did not finish within ${Math.round(transferMs / 1000)}s.`, 'timeout', true)), transferMs);
      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        err ? reject(err) : resolve();
      };
      const ws = sftp.createWriteStream(remotePath, { flags: 'w', mode: 0o644 });
      ws.on('error', (e: any) => finish(classify(e, opts.host || '', Number(opts.port) || 0)));
      // 'close' = the remote file handle was closed after every byte was acknowledged by the server
      ws.on('close', () => finish());
      session.conn.on('close', () => finish(new SftpError('The connection closed during the upload.', 'write', true)));
      ws.end(buf);
    });
    let verified = false;
    let verifyNote: string | undefined;
    try {
      const st: any = await p((cb) => sftp.stat(remotePath, cb));
      if (typeof st?.size === 'number' && st.size !== buf.length) {
        throw new SftpError(`Upload incomplete: the server has ${st.size} bytes of ${remotePath}, ${buf.length} were sent.`, 'verify', true);
      }
      verified = true;
    } catch (e: any) {
      if (e instanceof SftpError) throw e;
      verifyNote = `File not visible after upload (${e?.message || e}): CarGurus usually picks feed files up at once.`;
    }
    return { bytes: buf.length, remotePath, hostFingerprint: session.fingerprint, verified, verifyNote };
  } finally {
    session.close();
  }
}

/**
 * Uploads the feed. Retries up to `attempts` times (2 s, then 6 s apart) on network problems only;
 * throws an SftpError (with .stage) when it finally fails, so a failure can never look like a success.
 */
export async function uploadViaSftp(
  opts: SftpConnectionOptions,
  remoteFileName: string,
  content: string | Buffer,
  remoteDir?: string,
  attempts = 3,
): Promise<SftpUploadResult> {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const dir = String(remoteDir || '').trim().replace(/\/+$/, '');
  const remotePath = dir ? `${dir}/${remoteFileName}` : remoteFileName;
  const start = Date.now();
  let last: SftpError | null = null;
  let tries = 0;
  for (let i = 1; i <= Math.max(1, attempts); i++) {
    tries = i;
    try {
      const r = await uploadOnce(opts, remotePath, buf);
      return { ...r, attempts: i, durationMs: Date.now() - start };
    } catch (e) {
      last = e instanceof SftpError ? e : classify(e, opts.host || '', Number(opts.port) || 0);
      if (!last.retryable || i >= attempts) break;
      await new Promise((r) => setTimeout(r, i === 1 ? 2000 : 6000));
    }
  }
  const err = last ?? new SftpError('Upload failed', 'write', false);
  (err as any).attempts = tries;
  throw err;
}
