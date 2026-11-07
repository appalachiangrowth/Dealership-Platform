import { Client, ConnectConfig } from 'ssh2';

export interface SftpConnectionOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  passphrase?: string;
  privateKey?: string;
  timeout?: number;
}

export interface SftpTestResult {
  success: boolean;
  latencyMs?: number;
  message?: string;
  reason?: string;
  filesCount?: number;
}

/**
 * Robustly tests SFTP credentials (SSH handshake, key/password auth, lightweight directory listing)
 * and guarantees socket cleanup without dangling connections in Node process memory.
 */
export function testSftpConnection(opts: SftpConnectionOptions): Promise<SftpTestResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const conn = new Client();
    let completed = false;

    const timeoutMs = opts.timeout ?? 15000;
    const host = opts.host || 'ftp.cargurus.com';
    const port = Number(opts.port) || 2122;

    const cleanupAndResolve = (result: SftpTestResult) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        // ignore
      }
      try {
        conn.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      cleanupAndResolve({
        success: false,
        reason: `Connection timeout after ${timeoutMs}ms on ${host}:${port}`,
      });
    }, timeoutMs);

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          return cleanupAndResolve({
            success: false,
            reason: `SFTP subsystem handshake failed: ${err.message}`,
          });
        }

        // Lightweight check: list root directory (.) without uploading anything
        sftp.readdir('.', (readErr, list) => {
          if (readErr) {
            return cleanupAndResolve({
              success: false,
              reason: `SFTP directory read error: ${readErr.message}`,
            });
          }

          const latencyMs = Date.now() - start;
          cleanupAndResolve({
            success: true,
            latencyMs,
            message: `SFTP connection and authentication succeeded in ${latencyMs}ms`,
            filesCount: Array.isArray(list) ? list.length : 0,
          });
        });
      });
    });

    conn.on('error', (err: any) => {
      let reason = err?.message || 'SSH connection failed';
      if (err?.level === 'client-authentication') {
        reason = 'Authentication failed: Invalid credentials / SSH key or passphrase rejected';
      } else if (err?.code === 'ENOTFOUND') {
        reason = `Host unreachable: ${host} could not be resolved`;
      } else if (err?.code === 'ECONNREFUSED') {
        reason = `Connection refused on ${host}:${port}`;
      } else if (err?.code === 'ETIMEDOUT') {
        reason = `Connection timeout on ${host}:${port}`;
      }
      cleanupAndResolve({
        success: false,
        reason,
      });
    });

    conn.on('close', () => {
      if (!completed) {
        cleanupAndResolve({
          success: false,
          reason: 'SFTP connection closed unexpectedly before authentication completed',
        });
      }
    });

    try {
      const config: ConnectConfig = {
        host,
        port,
        username: opts.username || '',
        readyTimeout: timeoutMs,
      };

      if (opts.privateKey && opts.privateKey.trim()) {
        config.privateKey = opts.privateKey.trim();
        if (opts.passphrase) {
          config.passphrase = opts.passphrase;
        }
      }

      if (opts.password) {
        config.password = opts.password;
      }

      if (!config.privateKey && !config.password) {
        return cleanupAndResolve({
          success: false,
          reason: 'Missing credentials: SSH Private Key or Password/Passphrase is required',
        });
      }

      conn.connect(config);
    } catch (e: any) {
      cleanupAndResolve({
        success: false,
        reason: `Connection initialization error: ${e?.message || String(e)}`,
      });
    }
  });
}

/**
 * Uploads a buffer or string to remote CarGurus SFTP endpoint safely.
 */
export function uploadViaSftp(
  opts: SftpConnectionOptions,
  remoteFileName: string,
  content: string | Buffer,
  remoteDir?: string,
): Promise<{ bytes: number }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    const cleanupAndFinish = (err: Error | null, res?: { bytes: number }) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        // ignore
      }
      try {
        conn.destroy();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(res!);
    };

    const host = opts.host || 'ftp.cargurus.com';
    const port = Number(opts.port) || 2122;
    const timeoutMs = opts.timeout ?? 30000;

    const timer = setTimeout(() => {
      cleanupAndFinish(new Error(`SFTP upload timed out after ${timeoutMs}ms on ${host}:${port}`));
    }, timeoutMs);

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timer);
          return cleanupAndFinish(err);
        }

        const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
        const targetPath = remoteDir ? `${remoteDir.replace(/\/+$/, '')}/${remoteFileName}` : remoteFileName;

        const writeStream = sftp.createWriteStream(targetPath);
        writeStream.on('close', () => {
          clearTimeout(timer);
          cleanupAndFinish(null, { bytes: buf.length });
        });
        writeStream.on('error', (wErr: any) => {
          clearTimeout(timer);
          cleanupAndFinish(wErr);
        });
        writeStream.end(buf);
      });
    });

    conn.on('error', (err: any) => {
      clearTimeout(timer);
      cleanupAndFinish(err);
    });

    try {
      const config: ConnectConfig = {
        host,
        port,
        username: opts.username || '',
        readyTimeout: timeoutMs,
      };

      if (opts.privateKey && opts.privateKey.trim()) {
        config.privateKey = opts.privateKey.trim();
        if (opts.passphrase) config.passphrase = opts.passphrase;
      }
      if (opts.password) config.password = opts.password;

      conn.connect(config);
    } catch (e: any) {
      clearTimeout(timer);
      cleanupAndFinish(e);
    }
  });
}
