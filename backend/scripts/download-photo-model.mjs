#!/usr/bin/env node
/**
 * Downloads the background-removal model used by "Auto White Studio Background" (Vehicle Photo Studio Enhancer).
 *   npm run photo-model            → backend/models/isnet-general-use.onnx (~170 MB, once)
 * Model: ISNet "general use" (DIS), Apache-2.0 — the same file the open-source rembg project uses.
 * The file is checked (MD5) before it is put in place, so a broken download is never used.
 * Other location: PHOTO_MODEL_PATH=/path/to/file.onnx npm run photo-model   (and the same variable in .env)
 */
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const URL_ = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';
const MD5 = 'fc16ebd8b0c10d971d3513d564d01e29';
const rel = process.env.PHOTO_MODEL_PATH || join('models', 'isnet-general-use.onnx');
const target = isAbsolute(rel) ? rel : join(process.cwd(), rel);

const md5 = (file) => createHash('md5').update(readFileSync(file)).digest('hex');

if (existsSync(target) && md5(target) === MD5) {
  console.log(`✔ model already in place: ${target}`);
  process.exit(0);
}
mkdirSync(dirname(target), { recursive: true });
const tmp = `${target}.download`;
console.log(`Downloading the background-removal model (~170 MB)\n  from ${URL_}\n  to   ${target}`);
const res = await fetch(URL_, { redirect: 'follow' });
if (!res.ok || !res.body) {
  console.error(`✖ download failed: HTTP ${res.status}`);
  process.exit(1);
}
const total = Number(res.headers.get('content-length') || 0);
let got = 0;
let last = 0;
const body = Readable.fromWeb(res.body);
body.on('data', (c) => {
  got += c.length;
  const pct = total ? Math.floor((got / total) * 100) : 0;
  if (pct >= last + 10) {
    last = pct;
    process.stdout.write(`  ${pct}%\n`);
  }
});
await pipeline(body, createWriteStream(tmp));
const sum = md5(tmp);
if (sum !== MD5) {
  unlinkSync(tmp);
  console.error(`✖ the downloaded file is not the expected model (md5 ${sum}). Nothing was changed — try again.`);
  process.exit(1);
}
renameSync(tmp, target);
console.log(`✔ model ready (${Math.round(statSync(target).size / 1048576)} MB). Restart the API: pm2 reload ecosystem.config.cjs`);
