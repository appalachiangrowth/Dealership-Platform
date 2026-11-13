import { createHash } from 'crypto';
import { utils } from 'ssh2';

/**
 * SSH private keys for the CarGurus SFTP login (ftp.cargurus.com:2122).
 *
 * normalizePrivateKey() repairs the ways a key gets mangled on its way into a form or a .env file:
 *   - "\n" written as two characters (JSON, .env, copy from a terminal)  → real line breaks
 *   - Windows line endings / a byte-order mark                            → removed
 *   - the whole key squashed onto ONE line (pasted into a single-line box) → rebuilt with its header lines and
 *     64-character (PEM) / 70-character (OpenSSH) body lines
 * inspectPrivateKey() then reads it the way the SFTP login will and explains any problem in plain words.
 */

export function normalizePrivateKey(raw: unknown): string {
  let s = String(raw ?? '').replace(/^﻿/, '');
  if (!s.trim()) return '';
  if (!/\n/.test(s) && /\\[rn]/.test(s)) s = s.replace(/\\r\\n|\\n|\\r/g, '\n');
  s = s.replace(/\r\n?/g, '\n').trim();
  // PuTTY .ppk keys keep their own layout
  if (/^PuTTY-User-Key-File-/m.test(s)) return s + '\n';
  const m = s.match(/^(-----BEGIN [A-Z0-9 ]+-----)\s*([\s\S]*?)\s*(-----END [A-Z0-9 ]+-----)$/);
  if (!m) return s + '\n';
  const [, begin, inner, end] = m;
  let body: string;
  if (inner.includes('\n')) {
    // already multi-line: just tidy every line
    body = inner
      .split('\n')
      .map((l) => l.trim())
      .join('\n');
  } else {
    // squashed onto one line: header lines ("Proc-Type: 4,ENCRYPTED", "DEK-Info: …") then the base64 body
    const tokens = inner.split(/\s+/).filter(Boolean);
    const headers: string[] = [];
    while (tokens.length >= 2 && /^[A-Za-z-]+:$/.test(tokens[0])) headers.push(`${tokens.shift()} ${tokens.shift()}`);
    const b64 = tokens.join('');
    const width = /OPENSSH/.test(begin) ? 70 : 64;
    const lines = b64.match(new RegExp(`.{1,${width}}`, 'g')) || [];
    body = (headers.length ? headers.join('\n') + '\n\n' : '') + lines.join('\n');
  }
  return `${begin}\n${body}\n${end}\n`;
}

export interface KeyCheck {
  ok: boolean;
  /** plain-English problem (ok = false) */
  reason?: string;
  code?: 'missing' | 'format' | 'public' | 'needs_passphrase' | 'bad_passphrase';
  /** ssh-ed25519 / ssh-rsa / ecdsa-… */
  type?: string;
  comment?: string;
  /** SHA256:… of the matching PUBLIC key — the same as `ssh-keygen -lf key.pub`; safe to show and to send to CarGurus */
  fingerprint?: string;
  /** the key needs a passphrase */
  encrypted?: boolean;
}

/**
 * Reads the key like the SFTP login will.
 * Without a passphrase, an encrypted key is reported as code "needs_passphrase" (its format is fine).
 */
export function inspectPrivateKey(raw: unknown, passphrase?: string): KeyCheck {
  const key = normalizePrivateKey(raw);
  if (!key) return { ok: false, code: 'missing', reason: 'No SSH private key was given.' };
  const unlocked = utils.parseKey(key, passphrase || undefined);
  const plain = passphrase ? utils.parseKey(key) : unlocked;
  const encrypted = plain instanceof Error && /no passphrase given/i.test(plain.message);
  if (unlocked instanceof Error) {
    const msg = unlocked.message;
    if (/no passphrase given/i.test(msg)) {
      return { ok: false, code: 'needs_passphrase', encrypted: true, reason: 'This private key is protected by a passphrase: enter the passphrase CarGurus gave you with the key.' };
    }
    if (/bad passphrase|integrity check failed|decrypt/i.test(msg)) {
      return { ok: false, code: 'bad_passphrase', encrypted: true, reason: 'The passphrase does not unlock this private key. Check it for typos (it is case-sensitive) or ask CarGurus for it again.' };
    }
    return {
      ok: false,
      code: 'format',
      reason:
        `This is not an SSH private key the SFTP login can read (${msg}). Paste the whole key file, including the ` +
        '"-----BEGIN … PRIVATE KEY-----" and "-----END … PRIVATE KEY-----" lines (OpenSSH, PEM or PuTTY .ppk).',
    };
  }
  const k = Array.isArray(unlocked) ? unlocked[0] : unlocked;
  if (!k.isPrivateKey()) {
    return { ok: false, code: 'public', reason: 'This is a PUBLIC key (the .pub file). Paste the PRIVATE key instead: the file without .pub, starting with "-----BEGIN".' };
  }
  const fingerprint = 'SHA256:' + createHash('sha256').update(k.getPublicSSH()).digest('base64').replace(/=+$/, '');
  return { ok: true, type: k.type, comment: k.comment || '', fingerprint, encrypted };
}
