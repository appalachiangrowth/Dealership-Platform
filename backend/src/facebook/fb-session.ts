// @ts-nocheck
/* =====================================================================================
 *  Facebook poster engine (ported from fb-poster/server.js + marketplace.js)
 *
 *  One FbSession = one dealer user's own Chrome, running on the SERVER (no app on the
 *  dealer's computer). The Chrome profile (= the saved Facebook login) is kept in
 *  backend/storage/fb-profiles/<dealership>/<user>/ and survives restarts.
 *  The dealer sees and uses this browser through the portal ("live view"): the screen is
 *  streamed as pictures and clicks / typing are sent back. That is how they log in,
 *  answer Facebook's security checks, and watch the posting.
 *
 *  The Facebook automation itself (groups, Pages, posting, Marketplace form filling)
 *  is the original code, unchanged apart from where it stores data.
 *  This file is plain JavaScript in a .ts file (ts-nocheck) so it stays 1:1 with the
 *  original and is easy to compare / update.
 * ===================================================================================== */
import path from 'path';
import fs from 'fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp', '.wmv', '.mpg', '.mpeg', '.flv', '.ogv']);
const isVideoFile = (f) => VIDEO_EXT.has(path.extname(f).toLowerCase());
const clamp = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };

/** size of the server-side browser screen (the live view shows exactly this) */
export const VIEW_W = 1280;
export const VIEW_H = 860;

// ---------- Puppeteer is loaded only when someone uses the poster ----------
let puppeteerPromise = null;
async function loadPuppeteer() {
  if (!puppeteerPromise) {
    puppeteerPromise = (async () => {
      try {
        const extra = (await import('puppeteer-extra')).default;
        const stealth = (await import('puppeteer-extra-plugin-stealth')).default;
        extra.use(stealth());
        return extra;
      } catch (e) {
        puppeteerPromise = null;
        throw new Error('The Facebook poster is not installed on the server yet. Run "npm install" in the backend folder (it adds Puppeteer), then restart the backend.');
      }
    })();
  }
  return puppeteerPromise;
}

// Windows can block Puppeteer's downloaded Chrome; the normal installed Chrome/Edge is used when it exists.
function findBrowserPath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = process.platform === 'win32' ? [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

/** "http://user:pass@host:port" or "host:port" → { server, username, password } */
export function parseProxy(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z0-9]+:\/\//i.test(s) ? s : 'http://' + s);
    if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(u.protocol) || !u.hostname || !u.port) return null;
    return { server: `${u.protocol}//${u.hostname}:${u.port}`, username: decodeURIComponent(u.username || ''), password: decodeURIComponent(u.password || '') };
  } catch (e) { return null; }
}

/**
 * opts: { profileDir, debugDir, hooks }
 * hooks: {
 *   proxy(): string                                  proxy for this Facebook login ('' = none)
 *   autoPublish(): 'on' | 'off'                      Marketplace: click Next + Publish automatically
 *   gapSeconds(): number                             Marketplace: pause between listings
 *   getVehicle(id): Promise<vehicle | null>          vehicle in the old marketplace.js shape (+ photos = file paths, fbText, knownIds)
 *   setListing(id, patch, note): void                save the listing state (status, url, error …)
 *   releaseVehicle(id): void                         called when a vehicle task ends (temp photo copies can go)
 *   onJobDone(job): void                             group posting finished
 * }
 */
export function createFbSession(opts) {
  const hooks = opts.hooks;
  const DEBUG_DIR = opts.debugDir;
  const profileDir = opts.profileDir;
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });

  let browser = null;
  let page = null;
  let busy = false;
  let busyWhat = '';
  let cancelFlag = false;
  let mpCancel = false;
  let mpActive = null; // { vehicleId, action }
  let lastReport = null;
  let launching = null;
  // lastSeen: portal polled the state · lastAction: something was done · startedAt: Chrome start · lastFrame: live view asked for a picture
  const S = { lastSeen: Date.now(), lastAction: Date.now(), startedAt: 0, lastFrame: 0, loginLost: false };

  // ---------- activity log (shown in the portal) ----------
  const logs = [];
  let logSeq = 0;
  function log(msg) {
    logSeq++;
    logs.push({ seq: logSeq, at: Date.now(), msg: String(msg) });
    if (logs.length > 400) logs.shift();
  }

  // ---------- group posting job ----------
  let job = null;
  function emit(evt) {
    if (evt.type === 'target' && job) {
      const r = job.results[evt.index - 1];
      if (r) {
        r.status = evt.status;
        if (evt.note) r.note = evt.note;
        if (evt.error) r.error = evt.error;
      }
    } else if (evt.type === 'progress' && job === null) {
      // loading groups / Pages: nothing to keep
    } else if (evt.type === 'mp') {
      if ('active' in evt) mpActive = evt.active;
      if (evt.report) lastReport = { vehicleId: evt.vehicleId, report: evt.report, at: Date.now() };
    }
  }

  // ---------- the browser ----------
  async function launch(puppeteer) {
    const exe = findBrowserPath();
    const proxy = parseProxy(hooks.proxy ? hooks.proxy() : '');
    const args = [
      '--disable-notifications', '--lang=en-US', `--window-size=${VIEW_W},${VIEW_H + 140}`, '--disable-dev-shm-usage',
      // lighter Chrome for a server that runs several of them (none of this changes what Facebook sees)
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-component-extensions-with-background-pages',
      '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync',
      '--disable-breakpad', '--metrics-recording-only', '--mute-audio', '--autoplay-policy=user-gesture-required',
      '--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion',
      '--renderer-process-limit=3', '--disk-cache-size=67108864',
    ];
    if (process.platform === 'linux') args.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu');
    if (proxy) args.push(`--proxy-server=${proxy.server}`);
    const o = {
      headless: process.env.FB_HEADLESS !== 'false',
      protocolTimeout: 120000, // a hung Chrome fails a call after 2 minutes instead of blocking the dealer forever
      defaultViewport: { width: VIEW_W, height: VIEW_H },
      args,
      userDataDir: profileDir, // the Facebook login is remembered here
    };
    if (exe) o.executablePath = exe;
    try {
      return { b: await puppeteer.launch(o), proxy };
    } catch (e) {
      // a crash can leave Chrome's profile lock behind: remove it once and try again
      if (/already running|SingletonLock|ProcessSingleton/i.test(e.message)) {
        for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(path.join(profileDir, f), { force: true });
        return { b: await puppeteer.launch(o), proxy };
      }
      if (/Application Control|blocked this file|0x11C7/i.test(e.message)) {
        throw new Error('Windows blocked the downloaded Chrome. Install normal Google Chrome (google.com/chrome) and restart the backend: it will use that one automatically.');
      }
      if (/Could not find (Chrome|expected browser)|Browser was not found/i.test(e.message)) {
        throw new Error('No Chrome found on the server. Install Google Chrome, or run "npx puppeteer browsers install chrome" in the backend folder.');
      }
      throw e;
    }
  }

  async function ensureBrowser() {
    if (browser && page && !page.isClosed()) return;
    if (launching) return launching;
    launching = (async () => {
      const puppeteer = await loadPuppeteer();
      log('Starting the Facebook browser...');
      const { b, proxy } = await launch(puppeteer);
      browser = b;
      S.startedAt = Date.now();
      browser.on('disconnected', () => {
        if (browser !== b) return;
        browser = null; page = null; busy = false; view.cdp = null; view.page = null;
        log('The Facebook browser was closed.');
      });
      page = (await browser.pages())[0] || (await browser.newPage());
      if (proxy && proxy.username) await page.authenticate({ username: proxy.username, password: proxy.password });
      // The automation reads Facebook's English labels ("Year", "Post", "Join group" ...)
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' }).catch(() => {});
      page.setDefaultNavigationTimeout(60000);
      // "Leave site?" pop-ups (left over from an unfinished post) must never block the next page
      page.on('dialog', (d) => { d.accept().catch(() => {}); });
      if (view.on) await startScreencast().catch(() => {});
    })();
    try { await launching; } finally { launching = null; }
  }

  async function fbCookies() {
    if (!browser) return [];
    try {
      if (typeof browser.cookies === 'function') {
        return (await browser.cookies()).filter((c) => /(^|\.)facebook\.com$/.test(String(c.domain || '').replace(/^\./, '')));
      }
    } catch (e) {}
    try { return await page.cookies('https://www.facebook.com'); } catch (e) { return []; }
  }

  async function isLoggedIn() {
    if (!browser || !page || page.isClosed()) return false;
    return (await fbCookies()).some((c) => c.name === 'c_user');
  }

  /** Facebook's numeric id of the logged-in person ('' when logged out) */
  async function fbUserId() {
    const c = (await fbCookies()).find((x) => x.name === 'c_user');
    return c ? String(c.value) : '';
  }

  async function needLogin() {
    await ensureBrowser();
    if (!(await isLoggedIn())) {
      S.loginLost = true;
      throw new Error('Facebook is not connected (the login was never made or Facebook ended it). Open FB Poster, click "Connect Facebook" and log in once — after that posting works by itself again.');
    }
    S.loginLost = false;
  }

  /** Chrome still answers (a frozen Chrome is closed by the server and started again on the next use) */
  async function healthy() {
    if (!browser || !page || page.isClosed()) return true;
    try {
      await Promise.race([page.evaluate(() => 1), sleep(15000).then(() => { throw new Error('timeout'); })]);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function withBusy(what, fn) {
    if (busy) throw new Error('Another task is running (' + (busyWhat || 'Facebook') + '). Wait for it to finish or press Stop.');
    await needLogin();
    busy = true; busyWhat = what; S.lastAction = Date.now();
    try { return await fn(); } finally { busy = false; busyWhat = ''; }
  }

  // ---------- live view (the dealer sees and uses this browser inside the portal) ----------
  const view = { on: false, cdp: null, page: null, frame: null, seq: 0, waiters: [] };

  async function startScreencast() {
    if (!page || page.isClosed()) return;
    if (view.cdp && view.page === page) return;
    try { if (view.cdp) await view.cdp.detach(); } catch (e) {}
    const cdp = await page.createCDPSession();
    view.cdp = cdp; view.page = page;
    cdp.on('Page.screencastFrame', async (f) => {
      view.frame = Buffer.from(f.data, 'base64');
      view.seq++;
      for (const w of view.waiters.splice(0)) w();
      try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {}
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 62, maxWidth: VIEW_W, maxHeight: VIEW_H, everyNthFrame: 1 });
    // the screencast only sends a picture when something changes: take the first one now
    try {
      view.frame = await page.screenshot({ type: 'jpeg', quality: 62 });
      view.seq++;
      for (const w of view.waiters.splice(0)) w();
    } catch (e) {}
  }

  async function viewStart() {
    view.on = true;
    S.lastAction = Date.now();
    await ensureBrowser();
    await startScreencast();
  }

  async function viewStop() {
    view.on = false;
    const cdp = view.cdp;
    view.cdp = null; view.page = null;
    try { if (cdp) { await cdp.send('Page.stopScreencast'); await cdp.detach(); } } catch (e) {}
    for (const w of view.waiters.splice(0)) w();
  }

  /** the newest picture after `after` (waits up to waitMs for a new one) */
  async function frame(after, waitMs = 8000) {
    S.lastSeen = Date.now();
    S.lastFrame = Date.now();
    // someone is asking for pictures, so someone is watching (also undoes a late "stop" from a closed tab)
    view.on = true;
    if (browser && page && !page.isClosed() && view.page !== page) await startScreencast().catch(() => {});
    if (view.frame && view.seq > after) return { seq: view.seq, data: view.frame };
    await new Promise((r) => {
      const t = setTimeout(r, waitMs);
      view.waiters.push(() => { clearTimeout(t); r(); });
    });
    return view.frame && view.seq > after ? { seq: view.seq, data: view.frame } : null;
  }

  const KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Space']);

  /** a click / scroll / key / text from the live view */
  async function input(ev) {
    if (!browser || !page || page.isClosed()) throw new Error('The browser is not open. Click "Connect Facebook".');
    S.lastAction = Date.now();
    const x = clamp(ev.x, 0, VIEW_W - 1);
    const y = clamp(ev.y, 0, VIEW_H - 1);
    switch (ev.type) {
      case 'click':
        await page.mouse.click(x, y, { button: ev.button === 'right' ? 'right' : 'left', clickCount: ev.double ? 2 : 1 });
        break;
      case 'move':
        await page.mouse.move(x, y);
        break;
      case 'wheel':
        await page.mouse.move(x, y);
        await page.mouse.wheel({ deltaX: clamp(ev.dx, -3000, 3000), deltaY: clamp(ev.dy, -3000, 3000) });
        break;
      case 'key': {
        let k = String(ev.key || '');
        if (k === ' ') k = 'Space';
        const shortcut = /^[a-zA-Z]$/.test(k) && (ev.ctrl || ev.meta);
        if (!KEYS.has(k) && !shortcut) throw new Error('That key is not supported here.');
        const mods = [];
        if (ev.ctrl || ev.meta) mods.push('Control');
        if (ev.shift) mods.push('Shift');
        if (ev.alt) mods.push('Alt');
        for (const m of mods) await page.keyboard.down(m);
        await page.keyboard.press(shortcut ? k.toLowerCase() : k);
        for (const m of mods.reverse()) await page.keyboard.up(m);
        break;
      }
      case 'text': {
        const t = String(ev.text || '').slice(0, 5000);
        if (!t) break;
        // short text is typed key by key (like a person); long pasted text is inserted at once
        if (t.length <= 60 && !/[\u{1F000}-\u{1FFFF}]/u.test(t)) await page.keyboard.type(t, { delay: 15 });
        else await page.keyboard.sendCharacter(t);
        break;
      }
      default:
        throw new Error('Unknown action.');
    }
  }

  /** Back / Reload / Facebook home / open a facebook.com link in the live view */
  async function nav(action, url) {
    await ensureBrowser();
    S.lastAction = Date.now();
    if (action === 'back') await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    else if (action === 'forward') await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
    else if (action === 'reload') await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    else if (action === 'url') {
      if (!/^https:\/\/(www\.|m\.|web\.)?facebook\.com(\/|$)/i.test(String(url || ''))) throw new Error('Only facebook.com links can be opened here.');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } else await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
  }

  /**
   * Speed: start Chrome with the saved login BEFORE the dealer presses Post (the popup / FB Poster page calls this
   * when it opens), so the post itself does not wait for Chrome and Facebook to load.
   */
  async function warm() {
    S.lastSeen = Date.now();
    if (busy) return { ok: true, busy: true };
    const wasOpen = !!(browser && page && !page.isClosed());
    await ensureBrowser();
    if (!wasOpen && !busy && page && !/facebook\.com/i.test(page.url())) {
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    return { ok: true, loggedIn: await isLoggedIn() };
  }

  // ---------- connect / disconnect / switch account ----------
  async function connect() {
    await ensureBrowser();
    S.lastAction = Date.now();
    if (!(await isLoggedIn())) {
      if (!busy) await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' });
      log('Please log in to Facebook in the browser below.');
      return { loggedIn: false };
    }
    if (!busy && !page.url().includes('facebook.com')) await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    log('Already logged in (saved login). Use "Switch account" to log in with a different account.');
    return { loggedIn: true };
  }

  async function close() {
    await viewStop();
    const b = browser;
    browser = null; page = null; busy = false;
    try { if (b) await b.close(); } catch (e) {}
  }

  async function switchAccount() {
    if (busy) throw new Error('A task is running.');
    await ensureBrowser();
    const client = await page.createCDPSession();
    await client.send('Network.clearBrowserCookies');
    try { await client.send('Storage.clearDataForOrigin', { origin: 'https://www.facebook.com', storageTypes: 'all' }); } catch (e) {}
    await client.detach();
    await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' });
    log('Previous account logged out. Log in with the other account in the browser below.');
  }

  /** log out for good: close the browser and delete the saved login (Chrome profile) */
  async function forget() {
    if (busy) throw new Error('A task is running.');
    await close();
    await sleep(500);
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.mkdirSync(profileDir, { recursive: true });
    log('Facebook login removed from the server.');
  }

  /** the name shown on the logged-in profile (opened in a background tab) */
  async function fetchName() {
    if (!browser) return '';
    let p = null;
    try {
      p = await browser.newPage();
      await p.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' }).catch(() => {});
      await p.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2500);
      const name = await p.evaluate(() => {
        const bad = /^(notifications|chats|facebook|menu|marketplace|home)$/i;
        const h1 = Array.from(document.querySelectorAll('h1')).map((h) => (h.innerText || '').trim()).find((t) => t && t.length < 80 && !bad.test(t));
        return h1 || document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*[|\-–]\s*Facebook.*$/i, '').trim();
      });
      return String(name || '').split('\n')[0].slice(0, 120);
    } catch (e) {
      return '';
    } finally {
      if (p) await p.close().catch(() => {});
    }
  }

  // SWITCH-HELPERS-START
  // Find a visible clickable element whose label matches `reSource`.
  // scopeSel limits the search to a container (e.g. the profile menu); inDialogFirst prefers pop-up buttons.
  async function findByLabel(reSource, { inDialogFirst = false, scopeSel = '' } = {}) {
    const h = await page.evaluateHandle((src, inDialogFirst, scopeSel) => {
      const re = new RegExp(src, 'i');
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const els = Array.from(document.querySelectorAll(
        '[role="button"], button, a[role="link"], a[role="button"], [role="menuitem"], [role="radio"], [role="listitem"]'
      ));
      const cands = els.filter((e) => {
        if (!vis(e)) return false;
        if (scopeSel && !e.closest(scopeSel)) return false;
        const t = (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ');
        return t && t.length < 120 && re.test(t);
      });
      if (inDialogFirst) {
        const d = cands.find((e) => e.closest('div[role="dialog"]'));
        if (d) return d;
      }
      return cands[0] || null;
    }, reSource, inDialogFirst, scopeSel);
    return h.asElement();
  }

  // A real mouse click (Facebook often ignores script-made clicks).
  async function realClick(el) {
    try {
      await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await sleep(300);
      await el.click();
      return true;
    } catch (e) {
      try { await el.evaluate((e2) => e2.click()); return true; } catch (e3) { return false; }
    }
  }

  const escapeRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // The name of the Page that is currently open (shown as the big title on the Page)
  async function currentPageName() {
    try {
      return await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        let t = ((h1 && h1.innerText) || '').trim();
        if (!t) t = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*[|\-–]\s*Facebook.*$/i, '').trim();
        return t.split('\n')[0].trim();
      });
    } catch (e) {
      return '';
    }
  }

  // Click "Switch now" / "Switch" (and any confirmation pop-up) until it is gone
  async function clickSwitchButtons(maxMs) {
    let clicks = 0, idle = 0;
    const end = Date.now() + maxMs;
    while (Date.now() < end && clicks < 4) {
      const btn = await findByLabel('^switch( now)?$', { inDialogFirst: true });
      if (btn) {
        if (await realClick(btn)) {
          clicks++;
          log(`Clicked the Switch button (${clicks}).`);
        }
        idle = 0;
        await sleep(3500);
        continue;
      }
      if (clicks > 0) { idle++; if (idle >= 2) break; }
      await sleep(1500);
    }
    return clicks;
  }

  // Automatically become the Page. Method 1: the "Switch now" button on the Page.
  // Method 2: the profile menu (top-right picture) -> pick the Page from the list.
  async function autoSwitchToPage(pageName) {
    let clicks = await clickSwitchButtons(20000);
    if (clicks) { await sleep(4000); return { clicked: true, method: 'switch button' }; }

    log('No Switch button on the Page, trying the profile menu instead...');
    const avatar = await findByLabel('^(your profile|account|account controls and settings|profile)$');
    if (!avatar) return { clicked: false, method: 'none' };
    await realClick(avatar);
    await sleep(2000);

    const seeAll = await findByLabel('see all profiles|all profiles', { scopeSel: 'div[role="dialog"], [role="menu"]' });
    if (seeAll) { await realClick(seeAll); await sleep(2500); }

    if (!pageName) return { clicked: false, method: 'menu (page name unknown)' };
    const item = await findByLabel(escapeRe(pageName), { scopeSel: 'div[role="dialog"], [role="menu"]' });
    if (!item) {
      try { await page.keyboard.press('Escape'); } catch (e) {}
      return { clicked: false, method: 'menu (Page not listed)' };
    }
    await realClick(item);
    log(`Picked "${pageName}" from the profile menu.`);
    await sleep(4000);
    await clickSwitchButtons(8000); // some layouts ask for a confirmation
    await sleep(3000);
    return { clicked: true, method: 'profile menu' };
  }
  // ---------- who are we posting as: the personal profile or a Page ----------
  // Facebook sets the "i_user" cookie while you act as a Page (new Pages experience); without it you are the profile.
  async function actingPageId() {
    const c = (await fbCookies()).find((x) => x.name === 'i_user');
    return c ? String(c.value) : '';
  }

  /** back to the personal profile (Marketplace and groups posted "as you" need it) */
  async function useProfile() {
    if (!(await actingPageId())) return false;
    const cdp = await page.createCDPSession();
    try {
      await cdp.send('Network.deleteCookies', { name: 'i_user', domain: '.facebook.com' });
      await cdp.send('Network.deleteCookies', { name: 'i_user', url: 'https://www.facebook.com/' });
    } finally {
      await cdp.detach().catch(() => {});
    }
    log('Switched back to your personal profile.');
    return true;
  }

  /** become this Page (open it, press its "Switch now") — for posting AS the Page */
  async function becomePage(url, name) {
    log(`Switching into the Page${name ? ' "' + name + '"' : ''}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await autoSwitchToPage(name || (await currentPageName()));
    await sleep(1500);
    return !!(await actingPageId());
  }

  /**
   * Facebook's extra pop-ups around posting ("Talk with people directly — Add button / Not now", "Add a WhatsApp
   * button", "Boost this post", "Turn on notifications" …): press "Not now" / "Skip" / "No thanks".
   * Only pop-ups WITHOUT a text box are touched, so the post box itself is never closed. Returns how many were closed.
   */
  async function dismissPrompts() {
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const h = await page.evaluateHandle(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        // only "say no" buttons: never "Close" / "OK" (an error message must stay readable)
        const re = /^(not now|skip|skip for now|no thanks|no, thanks|maybe later|not interested)$/i;
        for (const d of Array.from(document.querySelectorAll('div[role="dialog"]')).filter(vis)) {
          if (d.querySelector('[contenteditable="true"], [role="textbox"], textarea')) continue; // the post box
          const b = Array.from(d.querySelectorAll('[role="button"], button')).filter(vis)
            .find((x) => re.test((x.innerText || '').trim()) || re.test((x.getAttribute('aria-label') || '').trim()));
          if (b) return b;
        }
        // inside the post box (Pages show it as an extra step): only when it is clearly the "add a button" offer
        const offer = /talk with people|add (a |the )?(whatsapp|messenger|call|contact)? ?button|get more (messages|leads)|add button/i;
        for (const x of Array.from(document.querySelectorAll('div[role="dialog"] [role="button"], div[role="dialog"] button')).filter(vis)) {
          if (!/^not now$/i.test((x.innerText || x.getAttribute('aria-label') || '').trim())) continue;
          let p = x.parentElement;
          for (let k = 0; k < 6 && p; k++, p = p.parentElement) if (offer.test(p.innerText || '')) return x;
        }
        return null;
      }).catch(() => null);
      const el = h && h.asElement();
      if (!el) break;
      const label = await el.evaluate((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()).catch(() => '');
      try { await el.click(); } catch (e) { try { await el.evaluate((e2) => e2.click()); } catch (e3) {} }
      n++;
      log(`Closed a Facebook pop-up ("${label || 'Not now'}").`);
      await sleep(900);
    }
    return n;
  }

  /**
   * Pages without Meta Verified may only post a few links a month: Facebook then shows
   * "Get more links with Meta Verified — you've already used 2 links". Returns that text ('' = not shown).
   */
  async function linkLimitShown() {
    return page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const txt = Array.from(document.querySelectorAll('div[role="dialog"], div[role="alert"], [role="status"]')).filter(vis).map((d) => d.innerText || '').join('\n');
      const re = /(get more links[^\n]*|meta verified[^\n]*link[^\n]*|[^\n]*used (all )?(\d+|your|the) (free )?links?[^\n]*|[^\n]*link limit[^\n]*|[^\n]*links? (per|each|this) month[^\n]*)/i;
      const m = txt.match(re);
      return m ? m[0].trim().slice(0, 200) : '';
    }).catch(() => '');
  }

  /** the post text without links (for Pages that reached their link limit) */
  function withoutLinks(text) {
    const LINK = /(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|co|us|io|info|biz|auto|cars|car|ca|uk|pk|ae|me|site|online|store|shop)\b(?:\/[^\s]*)?/gi;
    return String(text || '')
      .split('\n')
      .map((line) => {
        if (!LINK.test(line)) return line;
        LINK.lastIndex = 0;
        const left = line.replace(LINK, '').replace(/[ \t]{2,}/g, ' ').trimEnd();
        // a line that was only a link (+ an icon or "Website:" / "See more:") goes completely
        return /^[^A-Za-z0-9]*([A-Za-z][A-Za-z ]{0,20}:)?[^A-Za-z0-9]*$/.test(left) ? null : left;
      })
      .filter((l) => l !== null)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  const linkLimitError = (msg) => { const e = new Error(`Facebook link limit on this Page: "${msg}"`); e.linkLimit = true; return e; };

  /** set by startPost: the Page the groups are posted as (null = your personal profile) */
  let groupsAs = null;
  // SWITCH-HELPERS-END



  // ---------- Posting ----------
  // Finds a button INSIDE the post box whose label is exactly one of `labels`
  async function findDialogButton(labels) {
    const jsHandle = await page.evaluateHandle((labels) => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
      const composer =
        dialogs.reverse().find((d) => d.querySelector('[contenteditable="true"], [role="textbox"]')) || dialogs[0];
      if (!composer) return null;
      for (const n of composer.querySelectorAll('[aria-label], [role="button"], button')) {
        const label = (n.getAttribute('aria-label') || n.innerText || '').trim().toLowerCase();
        if (!labels.includes(label)) continue;
        const btn = n.closest('[role="button"], button') || n;
        if (visible(btn)) return btn;
      }
      return null;
    }, labels);
    const el = jsHandle.asElement();
    if (!el) return null;
    const disabled = await el.evaluate((b) => b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('disabled'));
    return { handle: el, disabled };
  }
  const findPostButton = () => findDialogButton(['post', 'publish', 'share', 'post now', 'share now', 'submit', 'submit for approval']);
  // Facebook Pages use a 2-step post box: "Next" first, then "Post"
  const findNextButton = () => findDialogButton(['next']);

  async function clickTrigger(kind) {
    return page.evaluate((kind) => {
      const all = Array.from(document.querySelectorAll('[role="button"], span, div'));
      const re = kind === 'photo' ? /photo\/video/i : /write something|create a public post|create post|what's on your mind/i;
      const matches = all.filter((b) => {
        const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
        return t.length > 0 && t.length < 60 && re.test(t);
      });
      const target = matches[matches.length - 1]; // innermost match
      if (target) { target.click(); return true; }
      return false;
    }, kind);
  }


  // ---- Image helpers (always work inside the composer dialog, never elsewhere on the page) ----
  const COMPOSER_JS = `
    const __ds = Array.from(document.querySelectorAll('div[role="dialog"]'));
    const __c = __ds.reverse().find((d) => d.querySelector('[contenteditable="true"], [role="textbox"]')) || __ds[0] || null;
  `;

  async function composerHandle() {
    const h = await page.evaluateHandle(new Function(COMPOSER_JS + 'return __c;'));
    return h.asElement();
  }

  // Returns a clickable element (ElementHandle) inside the post box whose label matches `pattern`
  async function findInComposer(pattern) {
    const h = await page.evaluateHandle(new Function('src', COMPOSER_JS + `
      if (!__c) return null;
      const re = new RegExp(src, 'i');
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const els = Array.from(__c.querySelectorAll('[role="button"], [aria-label], div, span'));
      const matches = els.filter((e) => {
        const t = (e.getAttribute('aria-label') || e.innerText || '').trim();
        return t && t.length < 40 && re.test(t) && vis(e);
      });
      return matches.find((e) => e.getAttribute('role') === 'button') || matches[matches.length - 1] || null;
    `), pattern);
    return h.asElement();
  }

  // True only when a REAL preview (picture or video) is inside the post box (no guessing)
  async function imageAttached() {
    return page.evaluate(new Function(COMPOSER_JS + `
      if (!__c) return false;
      if (__c.querySelector('img[src^="blob:"], video[src^="blob:"], video source[src^="blob:"]')) return true;
      if (__c.querySelector('[style*="blob:"]')) return true;
      return Array.from(__c.querySelectorAll('[aria-label]')).some((e) =>
        /remove (photo|image|video|attachment)|edit (photo|all|video)|add more photos/i.test(e.getAttribute('aria-label') || ''));
    `));
  }

  async function waitImageAttached(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await imageAttached()) return true;
      await sleep(500);
    }
    return false;
  }

  function mimeFor(file) {
    const ext = path.extname(file).toLowerCase();
    return {
      '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic',
      '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska', '.3gp': 'video/3gpp', '.wmv': 'video/x-ms-wmv', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
      '.flv': 'video/x-flv', '.ogv': 'video/ogg',
    }[ext] || 'application/octet-stream';
  }

  // Strategy 1: behave like a person: click "Add photos/videos" and answer the file-picker window (all files at once)
  async function strategyChooser(paths) {
    if (typeof page.waitForFileChooser !== 'function') throw new Error('this Puppeteer version has no waitForFileChooser');
    const addRe = 'add photos|add photo|upload photo|upload';
    let target = await findInComposer(addRe);
    if (!target) {
      const icon = await findInComposer('^photo/video$|^photo$');
      if (icon) { await icon.click(); await sleep(1200); }
      target = await findInComposer(addRe);
    }
    if (!target) throw new Error('no "Add photos/videos" button found in the post box');
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), target.click()]);
    if (paths.length > 1 && typeof chooser.isMultiple === 'function' && !chooser.isMultiple()) {
      await chooser.cancel();
      throw new Error('this file picker accepts only one file');
    }
    await chooser.accept(paths);
  }

  // Strategy 2: put the files straight into a hidden <input type="file"> inside the post box
  async function strategyInput(paths) {
    const getInputs = async () => {
      const c = await composerHandle();
      return c ? c.$$('input[type="file"]') : [];
    };
    let inputs = await getInputs();
    if (!inputs.length) {
      const icon = await findInComposer('^photo/video$|^photo$');
      if (icon) { await icon.click(); await sleep(1200); }
      inputs = await getInputs();
    }
    if (!inputs.length) throw new Error('no file input found in the post box');
    for (const inp of inputs) {
      const info = await inp.evaluate((i) => ({ accept: i.accept || '', multiple: !!i.multiple }));
      if (info.accept && !/image|video|\*/i.test(info.accept)) continue; // skip inputs that don't take pictures/videos
      if (paths.length > 1 && !info.multiple) continue;
      await inp.uploadFile(...paths);
      if (await waitImageAttached(8000)) return;
    }
  }

  // Strategy 3: simulate dragging the files onto the post box (only for small uploads: it goes through the page memory)
  async function strategyDrop(paths) {
    const total = paths.reduce((n, p) => n + fs.statSync(p).size, 0);
    if (total > 60 * 1024 * 1024) throw new Error('files too large for drag & drop');
    const files = paths.map((p) => ({ b64: fs.readFileSync(p).toString('base64'), name: path.basename(p), mime: mimeFor(p) }));
    const ok = await page.evaluate(new Function('files', COMPOSER_JS + `
      if (!__c) return false;
      const dt = new DataTransfer();
      for (const f of files) {
        const bin = atob(f.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], f.name, { type: f.mime }));
      }
      const target = __c.querySelector('[contenteditable="true"], [role="textbox"]') || __c;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
      return true;
    `), files);
    if (!ok) throw new Error('post box not found for drag & drop');
  }

  // Attach one or many pictures/videos. `uploadMs` = how long we are willing to wait for the upload to finish.
  async function attachMedia(paths, uploadMs) {
    const abs = paths.map((p) => path.resolve(p));
    for (const a of abs) if (!fs.existsSync(a)) throw new Error(`Media file is missing on disk: ${a}`);

    const strategies = [
      ['file picker', strategyChooser],
      ['file input', strategyInput],
      ['drag & drop', strategyDrop],
    ];

    let attached = false;
    for (const [name, fn] of strategies) {
      if (await imageAttached()) { attached = true; break; }
      try {
        log(`Trying upload via ${name}...`);
        await fn(abs);
        if (await waitImageAttached(15000)) {
          log(`Preview appeared (via ${name}).`);
          attached = true;
          break;
        }
        log(`${name}: no preview appeared, trying the next method.`);
      } catch (e) {
        log(`${name} failed: ${e.message}`);
      }
    }

    if (!attached) {
      const shot = path.join(DEBUG_DIR, `image_debug_${Date.now()}.png`);
      try { await page.screenshot({ path: shot }); } catch (e2) {}
      throw new Error(`The media did not attach, so nothing was posted here (screenshot saved in /debug: ${path.basename(shot)}).`);
    }

    // Wait until previews stop appearing and no upload progress bar is left (instead of fixed long sleeps)
    let prev = -1, stable = 0;
    const end = Date.now() + uploadMs;
    while (Date.now() < end) {
      const st = await page.evaluate(new Function(COMPOSER_JS + `
        return __c ? {
          busy: !!__c.querySelector('[role="progressbar"]'),
          n: __c.querySelectorAll('img[src^="blob:"], video[src^="blob:"], [style*="blob:"]').length,
        } : { busy: false, n: 0 };
      `)).catch(() => ({ busy: false, n: 0 }));
      if (!st.busy && st.n === prev) { stable++; if (stable >= 2) break; } else stable = 0;
      prev = st.n;
      await sleep(800);
    }
    log(`Media attached and uploaded (${abs.length} file${abs.length > 1 ? 's' : ''}).`);
  }

  // ---- Opening the post box (Pages and groups label it differently) ----
  async function composerOpen() {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('div[role="dialog"]')).some(
        (d) => d.querySelector('[contenteditable="true"], [role="textbox"]')
      )
    );
  }

  async function findTrigger(kind) {
    const h = await page.evaluateHandle((kind) => {
      const re = kind === 'photo'
        ? /photo\s*\/\s*video|add photo/i
        : /what.?s on your mind|write something|create (a )?(public )?post|share something|start a post|post something|say something/i;
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const els = Array.from(document.querySelectorAll('[role="button"], [role="textbox"], div[tabindex="0"], span'));
      const matches = els.filter((e) => {
        const t = (e.getAttribute('aria-label') || e.innerText || '').trim();
        if (!t || t.length >= 80 || !re.test(t) || !vis(e)) return false;
        // never the profile / cover picture buttons of a Page or profile
        if (/profile (picture|photo)|cover (photo|picture)|update (your )?(profile|cover)|avatar|story/i.test(t)) return false;
        if (e.closest('[aria-label*="profile picture" i], [aria-label*="cover photo" i]')) return false;
        return true;
      });
      return matches.find((e) => e.getAttribute('role') === 'button') || matches[matches.length - 1] || null;
    }, kind);
    return h.asElement();
  }

  async function openComposer(wantPhoto) {
    // always the normal post box first ("What's on your mind?" / "Create post"); photos are added inside it.
    // (The "photo" button is only a fallback: on a Page it can be confused with the profile-picture camera.)
    void wantPhoto;
    const order = ['text', 'photo'];
    const end = Date.now() + 30000;
    let rounds = 0;
    while (Date.now() < end) {
      await dismissPrompts();
      if (await composerOpen()) return true;
      if (rounds++ >= 1) {
        const why = await page.evaluate(() => {
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const labels = Array.from(document.querySelectorAll('[role="button"], button')).filter(vis)
            .map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().toLowerCase());
          if (labels.some((t) => t === 'join group' || t === 'join')) return 'not a member of this group (press "Join group" first)';
          if (labels.some((t) => t === 'cancel request')) return 'your join request is still pending';
          const txt = (document.body.innerText || '').slice(0, 20000);
          if (/only admins can post|posting is turned off|you can't post in this group/i.test(txt)) return 'only admins can post in this group';
          if (/this content isn.t available|page isn.t available/i.test(txt)) return 'this group/Page is not available';
          return '';
        }).catch(() => '');
        if (why) throw new Error('Skipped: ' + why + '.');
      }
      for (const kind of order) {
        const el = await findTrigger(kind);
        if (!el) continue;
        try {
          await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
          await sleep(250);
          await el.click(); // real mouse click
        } catch (e) {
          try { await el.evaluate((e2) => e2.click()); } catch (e3) {}
        }
        if (await waitFor(composerOpen, 4500)) return true; // returns as soon as the box is open
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(800);
    }
    return false;
  }

  async function logPageButtons() {
    try {
      const labels = await page.evaluate(() => {
        const seen = new Set();
        for (const e of document.querySelectorAll('[role="button"], button, [role="textbox"]')) {
          const r = e.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const t = (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ');
          if (t && t.length < 60) seen.add(t);
          if (seen.size >= 40) break;
        }
        return [...seen];
      });
      log('Buttons visible on the page: ' + JSON.stringify(labels));
    } catch (e) {}
  }

  async function waitFor(fn, ms, step = 250) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await sleep(step);
    }
    return false;
  }

  // Turn "realestate, #Dubai  invest-ment" into ["#realestate", "#Dubai", "#investment"]
  function normalizeHashtags(raw) {
    const seen = new Set();
    const out = [];
    for (const part of String(raw || '').split(/[\s,;]+/)) {
      const t = part.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push('#' + t);
      if (out.length >= 30) break;
    }
    return out;
  }

  // Types the description fast. Emoji, links and line breaks all work.
  // (sendCharacter inserts the whole text at once, instead of key-by-key with a delay)
  async function typeCaption(box, text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
      }
      if (lines[i]) await page.keyboard.sendCharacter(lines[i]);
    }
    // Safety net: if Facebook ignored the fast insert, clear the box and type it the slow, key-by-key way
    const probe = Array.from(text.replace(/\s+/g, '')).slice(0, 12).join('');
    const got = await box.evaluate((e) => (e.innerText || e.textContent || '').replace(/\s+/g, '')).catch(() => probe);
    if (probe && !got.includes(probe)) {
      log('Fast typing was ignored, typing slowly instead...');
      await box.click();
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.down(mod); await page.keyboard.press('KeyA'); await page.keyboard.up(mod);
      await page.keyboard.press('Backspace');
      await page.keyboard.type(text, { delay: 8 });
    }
  }

  // After pressing Post on a video, stay on the page until the upload progress bar is gone
  async function waitPostingDone(ms) {
    await sleep(1500);
    const end = Date.now() + ms;
    let zero = 0;
    while (Date.now() < end) {
      const n = await page.evaluate(() => Array.from(document.querySelectorAll('[role="progressbar"]')).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length).catch(() => 0);
      if (n === 0) { zero++; if (zero >= 3) return; } else zero = 0;
      await sleep(1000);
    }
  }

  async function postToTarget(targetUrl, mediaPaths, caption, uploadMs) {
    // your own profile (facebook.com/me): always posted as YOU — leave a Page first, if the browser acts as one
    const isProfile = /facebook\.com\/me\/?(\?|$)/i.test(targetUrl);
    if (isProfile && (await actingPageId())) await useProfile();
    log(isProfile ? 'Opening your Facebook profile...' : `Opening ${targetUrl}`);
    try { await page.bringToFront(); } catch (e) {}
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[role="main"], #email, input[name="email"]', { timeout: 15000 }).catch(() => {});
    await sleep(700);

    if (await page.$('#email, input[name="email"]')) {
      throw new Error('Facebook asked for login again. Click "Connect Facebook" and log in.');
    }

    // Post AS the right one: a Page is posted as the Page itself (a normal post on its timeline);
    // groups as the Page chosen in FB Poster, or as your personal profile.
    const isGroup = /facebook\.com\/groups\//i.test(targetUrl);
    const reopen = async () => {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[role="main"]', { timeout: 15000 }).catch(() => {});
      await sleep(1200);
    };
    if (isProfile) {
      // nothing to switch: the post goes on your own timeline
    } else if (!isGroup) {
      // "Switch now" on a Page = you are looking at it as your profile: become the Page first
      // (already acting as this Page: its id is in the "i_user" cookie — nothing to do)
      const urlId = (targetUrl.match(/[?&]id=(\d+)/) || [])[1] || '';
      const already = urlId && urlId === (await actingPageId());
      if (!already && (await findByLabel('^switch now$', { inDialogFirst: true }))) {
        log('This is a Page: switching into it so the post goes out as the Page (not as your profile)...');
        await autoSwitchToPage(await currentPageName());
        await reopen();
        if (await findByLabel('^switch now$', { inDialogFirst: true })) {
          throw new Error('Skipped: could not switch into this Page. Your Facebook account must be an admin of the Page.');
        }
      }
    } else {
      const acting = await actingPageId();
      if (!groupsAs && acting) {
        await useProfile();
        await reopen();
      } else if (groupsAs && groupsAs.url && !acting) {
        await becomePage(groupsAs.url, groupsAs.name);
        await reopen();
      }
    }

    const hasMedia = mediaPaths.length > 0;
    const hasVideo = mediaPaths.some(isVideoFile);

    // Open composer (retries for up to 30s, then reports what it could see)
    const opened = await openComposer(hasMedia);
    if (!opened) {
      await logPageButtons();
      const shot = path.join(DEBUG_DIR, `composer_debug_${Date.now()}.png`);
      try { await page.screenshot({ path: shot }); } catch (e) {}
      throw new Error(`The post box did not open (screenshot saved in /debug: ${path.basename(shot)}). Check in Chrome that you are acting as the right Page/profile and that the Page is allowed to post there.`);
    }
    await sleep(500);

    // Pictures / videos (one or many)
    if (hasMedia) {
      log(`Uploading ${mediaPaths.length} file${mediaPaths.length > 1 ? 's' : ''}${hasVideo ? ' (includes video, this can take a while)' : ''}...`);
      await attachMedia(mediaPaths, uploadMs);
    }

    // Description (+ hashtags, already merged into `caption`)
    if (caption.trim()) {
      log('Writing description...');
      const selectors = [
        'div[role="dialog"] [contenteditable="true"]',
        'div[role="dialog"] [data-lexical-editor="true"]',
        'div[role="dialog"] [role="textbox"]',
        '[contenteditable="true"]',
      ];
      let box = null;
      for (const sel of selectors) {
        try { box = await page.waitForSelector(sel, { visible: true, timeout: 2500 }); if (box) break; } catch (e) {}
      }
      if (!box) throw new Error('Could not find the description box.');
      await box.click();
      await typeCaption(box, caption);
      // A link without media makes Facebook fetch a preview card: give it a moment
      if (!hasMedia && /https?:\/\/\S+/i.test(caption)) await sleep(2500); else await sleep(600);
    }

    // Post. On Pages Facebook shows "Next" first and "Post" second, so handle both.
    log('Waiting for Post button...');
    let clicked = false, nextClicks = 0;
    const start = Date.now();
    while (Date.now() - start < Math.max(60000, uploadMs)) {
      await dismissPrompts();
      const lim = /https?:\/\/|www\./i.test(caption) ? await linkLimitShown() : '';
      if (lim) throw linkLimitError(lim);
      const found = await findPostButton();
      if (found && !found.disabled) {
        await found.handle.evaluate((b) => b.scrollIntoView({ block: 'center' }));
        await sleep(300);
        await found.handle.click();
        clicked = true;
        break;
      }
      if (!found && nextClicks < 3) {
        const nxt = await findNextButton();
        if (nxt && !nxt.disabled) {
          log('Page post box: clicking "Next"...');
          await nxt.handle.evaluate((b) => b.scrollIntoView({ block: 'center' }));
          await sleep(300);
          await nxt.handle.click();
          nextClicks++;
          await sleep(1500);
          continue;
        }
      }
      await sleep(800);
    }
    if (!clicked) {
      await logPageButtons();
      const shot = path.join(DEBUG_DIR, `post_debug_${Date.now()}.png`);
      await page.screenshot({ path: shot });
      throw new Error(`Post button not found/enabled (screenshot: ${path.basename(shot)} in /debug)`);
    }

    // From here on the post may already exist: never retry this target automatically (no double posts)
    const afterClick = (msg) => { const e = new Error(msg); e.clicked = true; return e; };
    let closed = false;
    {
      const until = Date.now() + (hasVideo ? Math.max(60000, uploadMs) : 45000);
      const hasLink = /https?:\/\/|www\./i.test(caption);
      while (Date.now() < until) {
        await dismissPrompts();
        const lim = hasLink ? await linkLimitShown() : '';
        if (lim) throw linkLimitError(lim); // Facebook refused the post because of the links: safe to post again without them
        const open = await page.evaluate(() => Array.from(document.querySelectorAll('div[role="dialog"]')).some(
          (d) => d.querySelector('[contenteditable="true"], [role="textbox"]')
        )).catch(() => true);
        if (!open) { closed = true; break; }
        await sleep(500);
      }
      // a last pop-up right after posting ("Add button" / "Boost post"): close it so the next target starts clean
      await sleep(800);
      await dismissPrompts();
    }
    const fbError = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('div[role="dialog"], div[role="alert"]')).map((d) => d.innerText || '').join(' ');
      const m = t.match(/(couldn.t (post|share)[^.\n]*|something went wrong[^.\n]*|you can.t (post|use this feature)[^.\n]*|try again later[^.\n]*|temporarily blocked[^.\n]*|spam[^.\n]*)/i);
      return m ? m[0].trim() : '';
    }).catch(() => '');
    if (fbError) throw afterClick('Facebook said: "' + fbError + '"');
    if (!closed) throw afterClick('Post was pressed but Facebook did not confirm it (the post box stayed open). Please check this one in Facebook.');

    // Videos keep uploading in the background after "Post": do not leave the page until that is finished
    if (hasVideo) { log('Waiting for the video upload to finish...'); await waitPostingDone(uploadMs); }
    else await sleep(1000);
    const pending = await page.evaluate(() => /pending|awaiting approval|submitted for (admin )?approval|admin.{0,20}review/i.test(
      Array.from(document.querySelectorAll('div[role="dialog"], div[role="alert"], [role="status"]')).map((d) => d.innerText || '').join(' ')
    )).catch(() => false);
    return pending ? 'posted (waiting for admin approval)' : 'posted';
  }

  async function interruptibleSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !cancelFlag) await sleep(500);
  }

  // After a failed post: close the half-open post box (and press "Discard") so the next target starts clean
  async function closeLeftoverComposer() {
    try {
      for (let i = 0; i < 2; i++) {
        await page.keyboard.press('Escape');
        await sleep(600);
        const discard = await findByLabel('^(discard|discard post|leave page|leave)$', { inDialogFirst: true });
        if (discard) { await realClick(discard); await sleep(600); }
      }
    } catch (e) {}
  }



  // ---------- Pages you manage / joined groups / act as a Page (from the original routes) ----------
  async function loadPages() {
    return withBusy('loading Pages', async () => {
      log('Loading your Pages...');
      await page.goto('https://www.facebook.com/pages/?category=your_pages', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[role="main"] a[href]', { timeout: 12000 }).catch(() => {});
      await sleep(1000);

      const [w, h] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      await page.mouse.move(w / 2, h / 2);
      let lastP = 0, sameP = 0;
      for (let i = 0; i < 6 && sameP < 2; i++) {
        await page.mouse.wheel({ deltaY: 3000 });
        await sleep(1100);
        const c = await page.evaluate(() => document.querySelectorAll('[role="main"] a[href]').length);
        if (c === lastP) sameP++; else { sameP = 0; lastP = c; }
      }

      const pages = await page.evaluate(() => {
        const skip = new Set(['pages', 'groups', 'watch', 'marketplace', 'gaming', 'events', 'friends', 'bookmarks',
          'notifications', 'messages', 'help', 'settings', 'login', 'reel', 'reels', 'stories', 'photo', 'photos',
          'videos', 'ads', 'business', 'policies', 'privacy', 'terms', 'about', 'me', 'home.php', 'hashtag', 'search',
          'profile.php', 'recover', 'checkpoint', 'composer', 'dialog', 'share', 'sharer', 'permalink.php', 'people', 'public']);
        const generic = /^(see all|create.*|new page|manage|switch.*|invite.*|insights|promote.*|like|follow|message|see more|learn more|view|visit|get started|boost.*|\d+.*)$/i;
        const map = new Map();
        const root = document.querySelector('[role="main"]') || document.body;
        for (const a of root.querySelectorAll('a[href]')) {
          let u;
          try { u = new URL(a.href); } catch (e) { continue; }
          if (!/(^|\.)facebook\.com$/.test(u.hostname)) continue;
          let key = null, url = null;
          if (u.pathname === '/profile.php' && u.searchParams.get('id')) {
            const id = u.searchParams.get('id');
            key = 'id:' + id;
            url = `https://www.facebook.com/profile.php?id=${id}`;
          } else {
            const m = u.pathname.match(/^\/([^\/]+)\/?$/);
            if (!m || skip.has(m[1].toLowerCase())) continue;
            key = m[1];
            url = `https://www.facebook.com/${m[1]}/`;
          }
          const name = (a.getAttribute('aria-label') || a.innerText || '').split('\n')[0].trim();
          if (name.length < 2 || generic.test(name)) continue;
          if (!map.has(key)) map.set(key, { name, url });
        }
        return [...map.values()];
      });

      log(`Found ${pages.length} Page(s).`);
      return pages;
    });
  }

  async function loadGroups() {
    return withBusy('loading groups', async () => {
      log('Loading your groups...');
      await page.goto('https://www.facebook.com/groups/joins/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('a[href*="/groups/"]', { timeout: 12000 }).catch(() => {});
      await sleep(800);

      const [w, h] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      await page.mouse.move(w / 2, h / 2);

      let last = 0, same = 0;
      for (let i = 0; i < 60 && same < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.mouse.wheel({ deltaY: 4000 });
        await sleep(1300);
        const count = await page.evaluate(() => document.querySelectorAll('a[href*="/groups/"]').length);
        if (count === last) same++; else { same = 0; last = count; }
      }

      const groups = await page.evaluate(() => {
        const skip = new Set(['joins', 'feed', 'discover', 'create', 'notifications', 'search', 'requests', 'your_groups']);
        const generic = /^(visit|view group|view|join|see group|see all|last active.*|active.*|\d+.*(posts?|members?).*)$/i;
        const clean = (t) => t
          .replace(/^unread\s*/i, '')
          .replace(/\s*\d+\s*(s|m|h|d|w|y|min|mins|hr|hrs)$/i, '')
          .trim();
        const map = new Map();
        for (const a of document.querySelectorAll('a[href*="/groups/"]')) {
          let u;
          try { u = new URL(a.href); } catch (e) { continue; }
          if (!/facebook\.com$/.test(u.hostname)) continue;
          const m = u.pathname.match(/^\/groups\/([^\/]+)\/?$/);
          if (!m || skip.has(m[1])) continue;
          const name = clean((a.getAttribute('aria-label') || a.innerText || '').split('\n')[0].trim());
          if (name.length < 2 || generic.test(name)) continue;
          // a notification text ("X likes your post in …") is not a group name: keep the shortest name seen
          const prev = map.get(m[1]);
          if (!prev || (name.length < prev.name.length && !/likes your|changed the name|welcome to/i.test(name))) {
            map.set(m[1], { name, url: `https://www.facebook.com/groups/${m[1]}/` });
          }
        }
        return [...map.values()];
      });

      log(`Found ${groups.length} group(s).`);
      return groups;
    });
  }

  async function switchToPage(url, givenName) {
    if (!/^https:\/\/(www\.|m\.|web\.)?facebook\.com\/.+/i.test(url)) throw new Error('Enter a valid Facebook Page link.');
    return withBusy('switching to a Page', async () => {
      log(`Opening Page: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await sleep(4500);

      const pageName = String(givenName || '').trim() || (await currentPageName());
      log(`Page name: ${pageName || '(not detected)'}`);

      const sw = await autoSwitchToPage(pageName);
      const clicked = sw.clicked;
      if (clicked) {
        log(`Switch done automatically (via ${sw.method}).`);
      } else {
        await logPageButtons();
        try { await page.screenshot({ path: path.join(DEBUG_DIR, `switch_debug_${Date.now()}.png`) }); } catch (e) {}
        log('Could not find a way to switch automatically (details above). You can switch yourself in the browser view: profile picture (top-right) → your Page.');
      }
      // Verify who we are acting as: /me redirects to the profile currently in use
      let verified = false, acting = '';
      try {
        await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded' });
        await sleep(3500);
        acting = page.url();
        const m = url.match(/facebook\.com\/(?:profile\.php\?id=)?([^\/?&#]+)/i);
        const urlMatch = !!(m && acting.toLowerCase().includes(m[1].toLowerCase()));
        const nowName = await currentPageName();
        const nameMatch = !!(pageName && nowName && nowName.toLowerCase() === pageName.toLowerCase());
        verified = urlMatch || nameMatch;
      } catch (e) {}
      log(verified
        ? `Confirmed: now acting as ${acting}`
        : 'Could not confirm the switch automatically. Check in the browser view that you are acting as the Page (profile picture, top-right).');
      return { clicked, verified, acting, name: pageName };
    });
  }

  // ---------- posting to groups / Pages ----------
  async function interruptibleSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !cancelFlag) await sleep(500);
  }

  async function runJob({ targets, mediaPaths, tempFiles, caption, delayMin, delayMax }) {
    let totalBytes = 0;
    for (const p of mediaPaths) { try { totalBytes += fs.statSync(p).size; } catch (e) {} }
    // time allowed for uploads: 60s + 3s per MB (max 15 min)
    const uploadMs = Math.min(15 * 60000, 60000 + Math.ceil(totalBytes / 1048576) * 3000);

    let ok = 0, failed = 0;
    // once a Page hit its link limit, later Page posts of this run go out without links straight away
    let pagesWithoutLinks = false;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (cancelFlag) { log('Stopped by you.'); break; }
        if (!browser || !page || page.isClosed()) { log('The browser was closed, stopping.'); break; }
        const url = targets[i];
        const meta = { url, index: i + 1, total: targets.length };
        log(`--- [${i + 1}/${targets.length}] ---`);
        emit({ type: 'target', ...meta, status: 'running' });
        let posted = false;
        const isGroupTarget = /facebook\.com\/groups\//i.test(url);
        let noLinks = !isGroupTarget && pagesWithoutLinks;
        for (let attempt = 1; attempt <= 2 && !cancelFlag; attempt++) {
          try {
            const text = noLinks ? withoutLinks(caption) : caption;
            if (noLinks && text !== caption && attempt === 1) log('Posting without links (this Page reached Facebook\'s link limit).');
            const note = await postToTarget(url, mediaPaths, text, uploadMs);
            ok++; posted = true;
            emit({ type: 'target', ...meta, status: 'done', note });
            log(note === 'posted' ? 'Posted.' : `Posted: ${note}.`);
            break;
          } catch (err) {
            await closeLeftoverComposer();
            // Page link limit ("Get more links with Meta Verified"): remove the links and post again (once)
            if (err.linkLimit && !noLinks) {
              log(`${err.message} → removing the links from the text and posting again...`);
              noLinks = true;
              if (!isGroupTarget) pagesWithoutLinks = true;
              emit({ type: 'target', ...meta, status: 'retry' });
              await interruptibleSleep(2500);
              attempt--; // this retry does not count as a failed try
              continue;
            }
            // Retry once, but only if nothing was posted yet and it is not a "can't post here" case
            const retry = attempt === 1 && !err.clicked && !/^Skipped:|asked for login/i.test(err.message);
            if (retry) {
              log(`Problem: ${err.message} Trying this one again...`);
              emit({ type: 'target', ...meta, status: 'retry' });
              await interruptibleSleep(3000);
              continue;
            }
            failed++;
            emit({ type: 'target', ...meta, status: /^Skipped:/.test(err.message) ? 'skipped' : 'failed', error: err.message });
            log(`Failed: ${err.message}`);
            if (/asked for login/i.test(err.message)) cancelFlag = true; // no point going on
            break;
          }
        }
        if (i < targets.length - 1 && !cancelFlag) {
          // Full wait only after a real post; after a skip/failure nothing was posted, so a short pause is enough
          const gap = posted ? rand(delayMin, delayMax) : 4000;
          log(`Waiting ${Math.round(gap / 1000)}s before the next one...`);
          if (job) job.nextAt = Date.now() + gap;
          await interruptibleSleep(gap);
          if (job) job.nextAt = null;
        }
      }
    } finally {
      for (const p of tempFiles) fs.unlink(p, () => {});
      busy = false; busyWhat = '';
      if (job) {
        for (const r of job.results) if (r.status === 'waiting' || r.status === 'running' || r.status === 'retry') r.status = cancelFlag ? 'cancelled' : r.status === 'waiting' ? 'not posted' : 'failed';
        Object.assign(job, { status: 'finished', ok, failed, cancelled: cancelFlag, finishedAt: Date.now() });
        try { hooks.onJobDone && hooks.onJobDone(job); } catch (e) {}
      }
      log(`Finished. Success: ${ok}, Failed: ${failed}`);
    }
  }

  /** start posting in the background; targets are facebook.com links (Page first, then groups) */
  async function startPost({ targets, names, mediaPaths, tempFiles, caption, delayMin, delayMax, runId, actAs }) {
    if (job && job.status === 'running') throw new Error('A Facebook post is already running. Wait for it to finish or press Stop.');
    if (busy && busyWhat !== 'Marketplace') throw new Error('Another task is running (' + (busyWhat || 'Facebook') + '). Wait for it to finish or press Stop.');
    await needLogin(); // starts Chrome with the saved login when it is asleep
    cancelFlag = false; S.lastAction = Date.now();
    groupsAs = actAs && actAs.url ? { url: String(actAs.url), name: String(actAs.name || '') } : null;
    job = {
      runId, status: 'running', total: targets.length, ok: 0, failed: 0, cancelled: false, startedAt: Date.now(), finishedAt: null, nextAt: null,
      results: targets.map((u) => ({ url: u, name: (names && names[u]) || u, status: 'waiting', note: '', error: '' })),
    };
    const myJob = job;
    const nVid = mediaPaths.filter(isVideoFile).length;
    log(mediaPaths.length
      ? `Media received: ${mediaPaths.length - nVid} photo(s), ${nVid} video(s)${mediaPaths.length > 1 ? ' (featured first)' : ''}.`
      : 'No media selected: text-only post.');
    (async () => {
      // a Marketplace listing is being filled in: post to the groups right after it (one Chrome, one task at a time)
      if (busy) log(`Waiting for the ${busyWhat || 'current task'} to finish, then posting to your profile...`);
      while (busy && !cancelFlag) await sleep(1000);
      if (cancelFlag) {
        for (const r of myJob.results) r.status = 'cancelled';
        Object.assign(myJob, { status: 'finished', cancelled: true, finishedAt: Date.now() });
        for (const p of tempFiles) fs.unlink(p, () => {});
        try { hooks.onJobDone && hooks.onJobDone(myJob); } catch (e) {}
        return;
      }
      busy = true; busyWhat = 'posting';
      await runJob({ targets, mediaPaths, tempFiles, caption, delayMin, delayMax });
    })().catch((e) => {
      busy = false; busyWhat = '';
      log(`Job crashed: ${e.message}`);
      if (myJob) Object.assign(myJob, { status: 'finished', cancelled: false, finishedAt: Date.now() });
    });
    return job;
  }

  function stopPosting() {
    cancelFlag = true;
    log('Stopping after the current one...');
  }

  // =====================================================================================
  //  Marketplace (vehicle listings). The helpers below are marketplace.js, unchanged.
  // =====================================================================================
  const MP = (() => {
    const page = () => S.page();
    const FB_MAX_PHOTOS = 20;
    const now = () => new Date().toISOString();
    const fmtNum = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US'));
    const photoPath = (v, p) => p; // photos are already full file paths
    const fbDescription = (v) => v.fbText || '';
    function setListing(v, patch, note) {
      v.listing = { ...(v.listing || {}), ...patch };
      hooks.setListing(v.id, patch, note);
      emit({ type: 'mp', vehicleId: v.id, listing: v.listing });
    }

      const OVERLAY_ID = '__mp_overlay';

      async function overlay(html, tone = 'info') {
        try {
          await page().evaluate((id, html, tone) => {
            let d = document.getElementById(id);
            if (!d) {
              d = document.createElement('div'); d.id = id;
              d.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;max-width:620px;width:calc(100% - 32px);' +
                'font:14px system-ui,Segoe UI,Roboto,sans-serif;color:#fff;border-radius:12px;padding:12px 16px;box-shadow:0 10px 30px rgba(0,0,0,.45);pointer-events:none;line-height:1.45';
              document.documentElement.appendChild(d);
            }
            d.style.background = tone === 'warn' ? '#92400e' : tone === 'ok' ? '#065f46' : '#1e3a8a';
            d.innerHTML = '<b>Marketplace Publisher</b><br>' + html;
          }, OVERLAY_ID, html, tone);
        } catch (e) {}
      }
      async function removeOverlay() {
        try { await page().evaluate((id) => { const d = document.getElementById(id); if (d) d.remove(); }, OVERLAY_ID); } catch (e) {}
      }

      async function realClick(h) {
        try { await h.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(60); await h.click(); return true; }
        catch (e) { try { await h.evaluate((e2) => e2.click()); return true; } catch (e3) { return false; } }
      }

      // Find a form control by its visible label ("Year", "Price", "Exterior color"...). Returns { h, kind } or null.
      async function findField(labels) {
        const h = await page().evaluateHandle((labels) => {
          const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const want = labels.map(norm);
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const root = document.querySelector('[role="main"]') || document.body;
          const labelOf = (el) => {
            const a = el.getAttribute('aria-label');
            if (a) return norm(a);
            const lb = el.getAttribute('aria-labelledby');
            if (lb) { const t = lb.split(' ').map((id) => (document.getElementById(id) || {}).textContent || '').join(' '); if (t.trim()) return norm(t); }
            const sp = el.querySelector('span');
            return norm(sp ? sp.textContent : el.textContent);
          };
          const cands = Array.from(root.querySelectorAll('label, [role="combobox"], input[aria-label], textarea[aria-label]')).filter(vis);
          for (const w of want) {
            for (const el of cands) {
              const t = labelOf(el);
              if (t !== w && !(t.startsWith(w) && t.length <= w.length + 3)) continue;
              if (el.closest('#__mp_overlay')) continue;
              return el;
            }
          }
          return null;
        }, labels);
        const el = h.asElement();
        if (!el) return null;
        const info = await el.evaluate((e) => {
          const combo = e.getAttribute('role') === 'combobox' ? e : e.querySelector('[role="combobox"]');
          if (combo || e.getAttribute('aria-haspopup') === 'listbox') return { kind: 'combo' };
          if (e.matches('input,textarea')) return { kind: e.tagName === 'TEXTAREA' ? 'textarea' : 'input', self: true };
          const inp = e.querySelector('textarea, input:not([type="hidden"]):not([type="file"])');
          if (inp) return { kind: inp.tagName === 'TEXTAREA' ? 'textarea' : 'input' };
          return { kind: 'unknown' };
        });
        if (info.kind === 'input' || info.kind === 'textarea') {
          if (info.self) return { h: el, kind: info.kind };
          const inner = await el.$('textarea, input:not([type="hidden"]):not([type="file"])');
          return { h: inner, kind: info.kind };
        }
        if (info.kind === 'combo') {
          const inner = (await el.evaluate((e) => e.getAttribute('role') === 'combobox')) ? el : (await el.$('[role="combobox"]')) || el;
          return { h: inner, kind: 'combo' };
        }
        return { h: el, kind: info.kind };
      }

      async function typeInto(h, value, multiline) {
        await realClick(h);
        const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
        await page().keyboard.down(mod); await page().keyboard.press('KeyA'); await page().keyboard.up(mod);
        await page().keyboard.press('Backspace');
        const text = String(value);
        if (!multiline) { await page().keyboard.type(text, { delay: 5 }); return; }
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (i > 0) await page().keyboard.press('Enter');
          if (lines[i]) await page().keyboard.sendCharacter(lines[i]);
        }
      }

      // Open a dropdown and pick the option whose text matches one of `choices` (scrolls long lists such as Year)
      // options are read from the list that belongs to this dropdown (aria-controls), else every visible option on the page
      async function openOptionsGone(ms) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const n = await page().evaluate(() => Array.from(document.querySelectorAll('[role="option"]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length).catch(() => 0);
          if (!n) return true;
          await sleep(100);
        }
        return false;
      }

      async function pickOptionOnce(comboH, choices) {
        // the previous dropdown (e.g. Exterior color) must be closed first, or its options would be picked here
        if (!(await openOptionsGone(1500))) {
          await page().keyboard.press('Escape').catch(() => {});
          await openOptionsGone(1000);
        }
        await realClick(comboH);
        const want = choices.map((c) => String(c).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()).filter(Boolean);
        const listId = () => comboH.evaluate((e) => e.getAttribute('aria-controls') || e.getAttribute('aria-owns') || '').catch(() => '');
        let lid = '';
        const optsShown = async () => {
          lid = (await listId()) || '';
          return page().evaluate((id) => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; const box = id ? document.getElementById(id) : null; const all = Array.from((box || document).querySelectorAll('[role="option"]')).filter(vis); return all.length > 0; }, lid).catch(() => false);
        };
        for (let i = 0; i < 25 && !(await optsShown()); i++) await sleep(120);
        if (!(await optsShown())) return { ok: false, why: 'list did not open' };
        for (let round = 0; round < 40; round++) {
          const optH = await page().evaluateHandle((want, id) => {
            const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
            const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; const box = id ? document.getElementById(id) : null; const all = Array.from((box || document).querySelectorAll('[role="option"]')).filter(vis);
            const opts = all;
            for (const w of want) {
              const exact = opts.find((o) => norm(o.innerText) === w);
              if (exact) return exact;
            }
            for (const w of want) {
              const part = opts.find((o) => norm(o.innerText).startsWith(w) || (w.length > 3 && norm(o.innerText).includes(w)));
              if (part) return part;
            }
            return null;
          }, want, lid);
          const opt = optH.asElement();
          if (opt) { const txt = await opt.evaluate((o) => (o.innerText || '').trim()).catch(() => ''); await realClick(opt); await sleep(250); return { ok: true, text: txt }; }
          // scroll the list (Year / Make lists are long and only render what is visible)
          const moved = await page().evaluate((id) => {
            const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; const box = id ? document.getElementById(id) : null; const all = Array.from((box || document).querySelectorAll('[role="option"]')).filter(vis);
            const o = all[0];
            if (!o) return false;
            let el = o.parentElement;
            while (el && el !== document.body && !(el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
            if (!el || el === document.body) return false;
            const before = el.scrollTop; el.scrollTop += Math.max(200, el.clientHeight * 0.9);
            return el.scrollTop !== before;
          }, lid).catch(() => false);
          if (!moved) break;
          await sleep(120);
        }
        const seen = await page().evaluate((id) => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; const box = id ? document.getElementById(id) : null; const all = Array.from((box || document).querySelectorAll('[role="option"]')).filter(vis); return all.slice(0, 15).map((o) => (o.innerText || '').trim()).join(' / '); }, lid).catch(() => '');
        await page().keyboard.press('Escape').catch(() => {});
        await sleep(150);
        return { ok: false, why: `option not in list (Facebook shows: ${seen || 'nothing'})` };
      }

      /** pick an option, then check the dropdown really shows it (tries again once if Facebook ignored the click) */
      async function pickOption(comboH, choices) {
        let r = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          r = await pickOptionOnce(comboH, choices);
          if (!r.ok) {
            if (attempt === 1 && /did not open/.test(r.why)) { await sleep(600); continue; }
            return r;
          }
          await openOptionsGone(1200);
          const shown = await comboH.evaluate((e) => ((e.innerText || '') + ' ' + (e.value || '') + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase()).catch(() => '');
          if (!r.text || shown.includes(String(r.text).toLowerCase())) return r;
          await sleep(500);
        }
        return { ok: false, why: `Facebook did not keep "${r && r.text}"` };
      }

      // --- value mapping to Facebook's option names
      function fbColor(c) {
        const t = String(c || '').toLowerCase();
        if (!t) return [];
        const order = [['off white', 'Off white'], ['off-white', 'Off white'], ['charcoal', 'Charcoal'], ['burgundy', 'Burgundy'], ['maroon', 'Burgundy'],
          // interior / trim names dealers use → Facebook's colour list
          ['ebony', 'Black'], ['jet', 'Black'], ['onyx', 'Black'], ['obsidian', 'Black'], ['espresso', 'Brown'], ['mocha', 'Brown'], ['cocoa', 'Brown'],
          ['saddle', 'Brown'], ['chestnut', 'Brown'], ['cognac', 'Brown'], ['camel', 'Tan'], ['caramel', 'Tan'], ['sand', 'Beige'], ['cream', 'Beige'],
          ['ivory', 'Beige'], ['parchment', 'Beige'], ['oyster', 'Beige'], ['cashmere', 'Beige'], ['linen', 'Beige'], ['stone', 'Beige'], ['almond', 'Beige'],
          ['ash', 'Grey'], ['slate', 'Grey'], ['titanium', 'Grey'], ['steel', 'Grey'], ['pewter', 'Grey'], ['dove', 'Grey'],
          ['wine', 'Burgundy'], ['oxblood', 'Burgundy'], ['bordeaux', 'Burgundy'],
          ['turquoise', 'Turquoise'], ['teal', 'Turquoise'], ['beige', 'Beige'], ['tan', 'Tan'], ['gold', 'Gold'], ['silver', 'Silver'],
          ['grey', 'Grey'], ['gray', 'Grey'], ['graphite', 'Grey'], ['gunmetal', 'Grey'], ['black', 'Black'], ['white', 'White'], ['pearl', 'White'],
          ['blue', 'Blue'], ['navy', 'Blue'], ['red', 'Red'], ['green', 'Green'], ['brown', 'Brown'], ['bronze', 'Brown'],
          ['orange', 'Orange'], ['yellow', 'Yellow'], ['purple', 'Purple'], ['pink', 'Pink']];
        for (const [k, v] of order) {
          if (!new RegExp('\\b' + k + '\\b').test(t)) continue;
          if (v === 'Grey') return ['Grey', 'Gray', 'Other'];
          if (v === 'Off white') return ['Off white', 'Off-white', 'White', 'Other'];
          return [v, 'Other'];
        }
        return [c, 'Other'];
      }
      function fbBody(b) {
        const t = String(b || '').toLowerCase();
        if (!t) return [];
        // US names first, then UK/PK names Facebook shows in other regions (Saloon, 4x4, Estate, MPV...)
        if (/pick ?up|truck|crew|cab/.test(t)) return ['Truck', 'Pickup', 'Pick-up', '4x4', 'Other'];
        if (/suv|crossover|sport utility|4x4|jeep/.test(t)) return ['SUV', '4x4', 'Other'];
        if (/mini ?van|mpv|people/.test(t)) return ['Minivan', 'MPV', 'People carrier', 'Van', 'Other'];
        if (/\bvan\b/.test(t)) return ['Van', 'Minivan', 'Other'];
        if (/convertible|cabrio|roadster/.test(t)) return ['Convertible', 'Cabriolet', 'Other'];
        if (/coupe|coupé/.test(t)) return ['Coupe', 'Coupé', 'Other'];
        if (/hatch/.test(t)) return ['Hatchback', 'Other'];
        if (/wagon|estate/.test(t)) return ['Wagon', 'Estate', 'Other'];
        if (/sedan|saloon/.test(t)) return ['Sedan', 'Saloon', 'Other'];
        if (/small|compact/.test(t)) return ['Small car', 'Small Car', 'Hatchback', 'Other'];
        return [b, 'Other'];
      }
      function fbFuel(f) {
        const t = String(f || '').toLowerCase();
        if (!t) return [];
        if (/plug/.test(t)) return ['Plug-in hybrid'];
        if (/hybrid/.test(t)) return ['Hybrid'];
        if (/electric|\bev\b/.test(t)) return ['Electric'];
        if (/diesel/.test(t)) return ['Diesel'];
        if (/flex|e85/.test(t)) return ['Flex'];
        if (/gas|petrol|unleaded/.test(t)) return ['Gasoline', 'Petrol'];
        return ['Other'];
      }
      function fbTrans(x) {
        const t = String(x || '').toLowerCase();
        if (!t) return [];
        if (/manual|stick|\bmt\b/.test(t)) return ['Manual transmission', 'Manual'];
        return ['Automatic transmission', 'Automatic'];
      }
      function fbCond(v) {
        if (v.fbCondition) return [v.fbCondition];
        return v.condition === 'new' || v.condition === 'cpo' ? ['Excellent'] : ['Good'];
      }

      async function shot(name) {
        const f = path.join(DEBUG_DIR, `${name}_${Date.now()}.png`);
        try { await page().screenshot({ path: f }); } catch (e) {}
        return path.basename(f);
      }
      async function pageText() {
        return page().evaluate(() => (document.body && document.body.innerText || '').slice(0, 30000)).catch(() => '');
      }

      async function waitForField(labels, ms) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const f = await findField(labels).catch(() => null);
          if (f) return f;
          await sleep(250);
        }
        return null;
      }

      // Facebook's own bottom buttons ("Next", "Publish"). Returns { h, disabled } or null.
      async function findFbButton(labels) {
        const jh = await page().evaluateHandle((labels) => {
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
          const found = [];
          for (const n of document.querySelectorAll('[role="button"], button, [aria-label]')) {
            if (n.closest('#__mp_overlay')) continue;
            const t = (n.getAttribute('aria-label') || n.innerText || '').trim().toLowerCase();
            if (!labels.includes(t)) continue;
            const b = n.closest('[role="button"], button') || n;
            if (vis(b)) found.push(b);
          }
          return found[found.length - 1] || null; // bottom-most = the form's action button
        }, labels);
        const el = jh.asElement();
        if (!el) return null;
        const disabled = await el.evaluate((b) => b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('disabled'));
        return { h: el, disabled };
      }
      async function waitFbButton(labels, ms) {
        const end = Date.now() + ms;
        let last = null;
        while (Date.now() < end) {
          if (mpCancel) return null;
          last = await findFbButton(labels).catch(() => null);
          if (last && !last.disabled) return last;
          await sleep(300);
        }
        return last; // may be disabled or null
      }

      // ---------------------------------------------------------------- fill the Create vehicle listing form
      async function fillVehicleForm(v) {
        const report = [];
        const step = async (name, fn) => {
          if (mpCancel) throw new Error('Stopped by you.');
          try { const r = await fn(); report.push({ name, ok: r !== false, note: typeof r === 'string' ? r : '' }); }
          catch (e) { report.push({ name, ok: false, note: e.message }); }
        };
        const combo = async (labels, choices) => {
          if (!choices.length) return 'skipped (no value)';
          const f = await findField(labels);
          if (!f) throw new Error('field not found');
          if (f.kind === 'input') { await typeInto(f.h, choices[0]); await sleep(500); await page().keyboard.press('Enter').catch(() => {}); return true; }
          const r = await pickOption(f.h, choices);
          if (!r.ok) throw new Error(r.why);
          return true;
        };
        const text = async (labels, value, multiline) => {
          if (value === null || value === undefined || value === '') return 'skipped (no value)';
          const f = await findField(labels);
          if (!f || !f.h) throw new Error('field not found');
          if (f.kind === 'combo') { const r = await pickOption(f.h, [String(value)]); if (!r.ok) throw new Error(r.why); return true; }
          await typeInto(f.h, value, multiline);
          return true;
        };

        await step('Vehicle type', async () => {
          const LABELS = ['Vehicle type', 'Vehicle Type', 'Type of vehicle'];
          const TYPES = ['Car/Truck', 'Car/truck', 'Car/van', 'Car/Van', 'Cars/vans', 'Car', 'Cars'];
          // Read the Vehicle type box itself ('' = nothing chosen). Other fields are NOT used as proof:
          // Facebook restores drafts, so Year/Make/Model can be on the page while the type is still empty.
          const chosen = () => page().evaluate((labels) => {
            const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
            const want = labels.map((l) => l.toLowerCase());
            for (const el of document.querySelectorAll('[role="combobox"], label')) {
              const t = norm(el.innerText);
              if (!t || t.length > 60) continue;
              const hit = want.find((w) => t.toLowerCase().startsWith(w));
              if (!hit) continue;
              return norm(t.slice(hit.length));
            }
            return null;
          }, LABELS).catch(() => null);

          const before = await chosen();
          log(`  Vehicle type box shows: "${before === null ? '(box not found)' : before || '(empty)'}"`);
          if (before) return `already "${before}"`;
          for (let attempt = 1; attempt <= 3; attempt++) {
            const f = await waitForField(LABELS, 10000);
            if (!f) { log('  Vehicle type box not found on the page'); break; }
            const r = await pickOption(f.h, TYPES);
            log(`  Vehicle type attempt ${attempt}: ${r.ok ? 'picked "' + (r.text || '?') + '"' : r.why}`);
            if (!r.ok) {
              // other wording in this region: the first option is the car type on every layout
              await realClick(f.h);
              for (let i = 0; i < 20 && !(await page().$('[role="option"]')); i++) await sleep(120);
              const first = await page().$('[role="option"]');
              if (first) {
                const t = await first.evaluate((o) => (o.innerText || '').trim()).catch(() => '');
                await realClick(first);
                log(`  Vehicle type attempt ${attempt}: picked first option "${t}"`);
              } else {
                await f.h.focus().catch(() => {});
                await page().keyboard.press('ArrowDown').catch(() => {});
                await sleep(300);
                await page().keyboard.press('Enter').catch(() => {});
                log(`  Vehicle type attempt ${attempt}: list did not open, tried the keyboard`);
              }
            }
            for (let i = 0; i < 12; i++) {
              const c = await chosen();
              if (c) { log(`  Vehicle type selected: "${c}"`); await sleep(600); return `"${c}"`; }
              await sleep(250);
            }
            log(`  Vehicle type still empty after attempt ${attempt}`);
          }
          const sv = await shot('mp_vehicle_type');
          throw new Error(`could not select the vehicle type (screenshot ${sv} in the debug folder)`);
        });
        await step(`Photos (${Math.min(v.photos.length, FB_MAX_PHOTOS)})`, async () => {
          const files = v.photos.slice(0, FB_MAX_PHOTOS).map((p) => photoPath(v, p)).filter((p) => fs.existsSync(p));
          if (!files.length) throw new Error('no photo files on disk');
          const inputs = await page().$$('input[type="file"]');
          let used = null;
          for (const inp of inputs) {
            const ok = await inp.evaluate((i) => !i.accept || /image|\*/i.test(i.accept));
            if (ok) { used = inp; break; }
          }
          if (!used) throw new Error('photo upload box not found');
          await used.uploadFile(...files);
          // wait for previews to appear
          const end = Date.now() + 30000 + files.length * 3000;
          let n = 0;
          while (Date.now() < end) {
            n = await page().evaluate(() => document.querySelectorAll('[role="main"] img[src^="blob:"], [role="main"] [style*="blob:"]').length).catch(() => 0);
            const busy = await page().evaluate(() => !!document.querySelector('[role="main"] [role="progressbar"]')).catch(() => false);
            if (n >= files.length && !busy) break;
            await sleep(800);
          }
          return n >= files.length ? true : `${n}/${files.length} previews visible, check photos`;
        });

        await step('Year', () => combo(['Year'], [String(v.year)]));
        await step('Make', () => combo(['Make'], [v.make]));
        await step('Model', () => text(['Model'], [v.model, v.trim].filter(Boolean).join(' ')));
        await step('Mileage', () => text(['Mileage'], v.mileage));
        await step('Price', () => text(['Price'], v.price));
        await step('Body style', () => combo(['Body style'], fbBody(v.bodyStyle)));
        await step('Exterior color', () => combo(['Exterior color', 'Exterior colour'], fbColor(v.exteriorColor)));
        await sleep(400);
        await step('Interior color', () => combo(['Interior color', 'Interior colour', 'Interior'], fbColor(v.interiorColor)));
        await step('Vehicle condition', () => combo(['Vehicle condition', 'Condition'], fbCond(v)));
        await step('Fuel type', () => combo(['Fuel type'], fbFuel(v.fuelType)));
        await step('Transmission', () => combo(['Transmission'], fbTrans(v.transmission)));
        await step('Clean title', async () => {
          const r = await page().evaluateHandle(() => {
            const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            return Array.from(document.querySelectorAll('[role="checkbox"], input[type="checkbox"], [role="switch"]')).filter(vis)
              .find((e) => /clean title/i.test((e.getAttribute('aria-label') || '') + ' ' + ((e.closest('label') || e.parentElement || {}).innerText || ''))) || null;
          });
          const el = r.asElement();
          if (!el) return 'not on this form';
          const checked = await el.evaluate((e) => e.getAttribute('aria-checked') === 'true' || e.checked === true);
          if (checked !== !!v.cleanTitle) await realClick(el);
          return true;
        });
        await step('Description', () => text(['Description'], fbDescription(v), true));
        return report;
      }

      // ---------------------------------------------------------------- watch for the user's own click
      async function armClickWatch(words) {
        await page().evaluate((words) => {
          window.__mpClicked = window.__mpClicked || [];
          if (window.__mpWatch) return;
          window.__mpWatch = true;
          document.addEventListener('click', (e) => {
            const b = e.target && e.target.closest && e.target.closest('[role="button"], button, [role="menuitem"]');
            if (!b) return;
            const t = (b.getAttribute('aria-label') || b.innerText || '').trim().toLowerCase();
            if (window.__mpWords.some((w) => t === w || t.startsWith(w))) window.__mpClicked.push({ t, at: Date.now() });
          }, true);
        }, words).catch(() => {});
        await page().evaluate((words) => { window.__mpWords = words; }, words).catch(() => {});
      }
      async function clicked() {
        return page().evaluate(() => (window.__mpClicked || []).map((x) => x.t)).catch(() => []);
      }

      // ---------------------------------------------------------------- find the new listing in "Your listings"
      function knownIds(v) {
        return v.knownIds || []; // Facebook ids of this dealership's other listings
      }
      // words Facebook shows on a listing it did not publish (Needs attention, duplicate, rejected, under review …)
      const FLAG_RE_SRC = "needs attention|duplicate listing|duplicate|similar listing|rejected|not published|wasn.t published|couldn.t be published|removed by facebook|was removed|under review|being reviewed|pending review|violat|commerce polic|declined|isn.t visible|not visible to buyers";

      /** listings on the current "Your listings" view that look like this vehicle (+ Facebook's warning on the card) */
      async function scanListings(v, skip) {
        return page().evaluate((y, make, model, price, skip, flagSrc) => {
          const norm = (t) => String(t || '').toLowerCase();
          const flagRe = new RegExp(flagSrc, 'i');
          const res = new Map();
          const score = (t) => {
            let n = 0;
            if (y && t.includes(String(y))) n += 2;
            if (make && t.includes(norm(make))) n += 2;
            if (model && t.includes(norm(model.split(' ')[0]))) n += 2;
            if (price && t.replace(/[^0-9]/g, ' ').split(/\s+/).includes(String(price))) n += 1;
            return n;
          };
          for (const a of document.querySelectorAll('a[href]')) {
            const m = a.href.match(/marketplace\/item\/(\d+)/) || a.href.match(/[?&]listing_id=(\d+)/);
            if (!m || skip.includes(m[1])) continue;
            let box = a, txt = '';
            for (let i = 0; i < 8 && box; i++) { txt = box.innerText || ''; if (txt.length > 30) break; box = box.parentElement; }
            // a little wider for the status line under the card ("Needs attention · Duplicate listing")
            // (only when that wider box holds this one listing, so a neighbour's warning is never taken)
            const par = box && box.parentElement;
            const oneCard = par && new Set(Array.from(par.querySelectorAll('a[href*="/marketplace/item/"], a[href*="listing_id="]')).map((x) => x.href.replace(/[?#].*$/, ''))).size <= 1;
            const wide = (oneCard ? par.innerText : txt) || txt;
            const t = norm(txt);
            const fm = wide.match(flagRe);
            const flag = fm ? (wide.split('\n').find((l) => flagRe.test(l)) || fm[0]).trim().slice(0, 160) : '';
            const sc = score(t);
            const prev = res.get(m[1]);
            if (!prev || prev.score < sc) res.set(m[1], { id: m[1], score: sc, flag });
          }
          // cards without a link (Facebook sometimes shows rejected listings that way)
          if (!res.size) {
            for (const el of document.querySelectorAll('[role="main"] div')) {
              const txt = el.innerText || '';
              if (txt.length < 20 || txt.length > 600 || !flagRe.test(txt)) continue;
              const sc = score(norm(txt));
              if (sc >= 4) {
                res.set('card:' + res.size, { id: '', score: sc, flag: (txt.split('\n').find((l) => flagRe.test(l)) || '').trim().slice(0, 160) });
                break;
              }
            }
          }
          return [...res.values()].sort((a, b) => b.score - a.score);
        }, v.year, v.make, v.model, v.price, skip, FLAG_RE_SRC).catch(() => []);
      }

      /** open Facebook's "Needs attention" view of Your listings (a tab / filter / chip with that name) */
      async function openNeedsAttention() {
        const h = await page().evaluateHandle(() => {
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const all = Array.from(document.querySelectorAll('[role="tab"], [role="radio"], [role="button"], [role="link"], a, [role="option"]')).filter(vis);
          return all.find((e) => /^needs attention/i.test((e.innerText || e.getAttribute('aria-label') || '').trim()) && (e.innerText || '').length < 60) || null;
        }).catch(() => null);
        const el = h && h.asElement();
        if (!el) return false;
        await realClick(el);
        await sleep(2500);
        return true;
      }

      async function findListingOnSellingPage(v) {
        const skip = knownIds(v);
        const hit = (best) => ({ fbId: best.id, url: best.id ? `https://www.facebook.com/marketplace/item/${best.id}/` : '', flagged: best.flag || '' });
        for (let attempt = 1; attempt <= 4 && !mpCancel; attempt++) {
          log(`Looking for the new listing in "Your listings" (try ${attempt}/4)...`);
          await page().goto('https://www.facebook.com/marketplace/you/selling', { waitUntil: 'domcontentloaded' });
          await page().waitForSelector('a[href*="/marketplace/item/"], a[href*="listing_id="]', { timeout: 8000 }).catch(() => {});
          await sleep(800);
          for (let i = 0; i < 2; i++) { await page().mouse.wheel({ deltaY: 1200 }).catch(() => {}); await sleep(500); }
          let found = await scanListings(v, skip);
          if (found[0] && found[0].score >= 4) return hit(found[0]);
          // not among the active listings: Facebook may have put it under "Needs attention" (duplicate, rejected, under review…)
          if (attempt >= 2) {
            await page().mouse.wheel({ deltaY: -4000 }).catch(() => {});
            if (await openNeedsAttention()) {
              log('Checking "Needs attention"...');
              for (let i = 0; i < 2; i++) { await page().mouse.wheel({ deltaY: 1200 }).catch(() => {}); await sleep(500); }
              found = await scanListings(v, skip);
              if (found[0] && found[0].score >= 4) {
                const b = found[0];
                return hit({ ...b, flag: b.flag || 'Needs attention' });
              }
            }
          }
          await sleep(3000);
        }
        return null;
      }

      async function publishVehicle(v) {
        mpActive = { vehicleId: v.id, action: 'publish' }; emit({ type: 'mp', active: mpActive });
        setListing(v, { status: 'publishing', error: '' }, 'Publishing started');
        log(`Marketplace: preparing ${v.year} ${v.make} ${v.model}...`);
        await useProfile(); // vehicles are listed by your personal profile (Pages cannot list vehicles)
        await page().goto('https://www.facebook.com/marketplace/create/vehicle', { waitUntil: 'domcontentloaded' });
        if (await page().$('#email, input[name="email"]')) throw new Error('Facebook asked for login again. Click "Connect Facebook" and log in.');
        // wait for the form instead of a fixed pause
        const typeField = await waitForField(['Vehicle type', 'Vehicle Type', 'Type of vehicle', 'Year'], 15000);
        if (/\/marketplace\/create\/vehicle/.test(page().url()) === false) {
          throw new Error(`Facebook redirected away from the vehicle form (${page().url()}). Make sure you are using your personal profile, not acting as a Page.`);
        }
        if (!typeField) {
          const txt = await pageText();
          const s0 = await shot('mp_noform');
          if (/(isn't|is not|not) available|you can.t (sell|use marketplace)|marketplace is unavailable/i.test(txt)) {
            throw new Error('Facebook says Marketplace / vehicle listings are not available for this account. Use a personal profile that has Marketplace access (pages cannot list vehicles).');
          }
          throw new Error(`The vehicle form did not load (screenshot ${s0}).`);
        }
        await overlay('Filling in the vehicle details and photos… please don\'t click in this window.');
        const report = await fillVehicleForm(v);
        const missed = report.filter((r) => !r.ok);
        for (const r of report) log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.note ? ' — ' + r.note : ''}`);
        emit({ type: 'mp', vehicleId: v.id, report });

        // Fields Facebook needs before it lets you continue
        const REQUIRED = ['Vehicle type', 'Year', 'Make', 'Model', 'Price'];
        const missedRequired = missed.filter((m) => REQUIRED.includes(m.name) || m.name.startsWith('Photos'));
        const auto = hooks.autoPublish() !== 'off' && !missedRequired.length;

        let published = false;
        if (auto) {
          // ---- automatic: Next → Publish
          setListing(v, { status: 'publishing' }, missed.length ? `Form filled (optional fields skipped: ${missed.map((m) => m.name).join(', ')}), publishing` : 'Form filled, publishing');
          await overlay('Form filled. Publishing automatically…', 'ok');
          await page().keyboard.press('Escape').catch(() => {}); // close any open dropdown
          let next = await waitFbButton(['next'], 12000);
          let pub = null;
          if (next && !next.disabled) {
            log('Marketplace: clicking Next...');
            await realClick(next.h);
            pub = await waitFbButton(['publish', 'post', 'list item'], 20000);
          } else {
            pub = await waitFbButton(['publish', 'post', 'list item'], 3000); // some layouts publish from page 1
          }
          if (pub && !pub.disabled) {
            log('Marketplace: clicking Publish...');
            await realClick(pub.h);
            published = true;
          } else {
            const s1 = await shot('mp_autopublish');
            log(`Marketplace: Facebook did not enable ${next && next.disabled ? 'Next' : 'Publish'} (a required field may be empty, screenshot ${s1}). Finish it in Chrome.`);
          }
        }

        if (!published) {
          // ---- manual fallback: you finish the form, the app watches for Publish
          await armClickWatch(['publish', 'post', 'list']);
          await overlay(
            (missed.length ? `<b>Fix these fields:</b> ${missed.map((m) => m.name).join(', ')}<br>` : '') +
            'Then click Facebook\'s <b>Next</b> and <b>Publish</b>. The link is saved automatically.', 'warn');
          setListing(v, { status: 'awaiting_publish' }, missed.length ? `Needs you: ${missed.map((m) => m.name).join(', ')}` : 'Waiting for you to click Publish');
          const end = Date.now() + 15 * 60000;
          let lastUrl = page().url();
          while (Date.now() < end && !mpCancel) {
            await sleep(700);
            if (!page() || page().isClosed()) throw new Error('Chrome window was closed.');
            const url = page().url();
            const c = await clicked();
            if (c.some((t) => t === 'publish' || t.startsWith('publish') || t === 'post' || t === 'list')) { published = true; break; }
            if (!/\/marketplace\/create/.test(url) && /\/marketplace\/create/.test(lastUrl)) { published = true; break; }
            if (!/\/marketplace\/create/.test(url) && !/\/marketplace\/create/.test(lastUrl)) break;
            lastUrl = url;
            if (url.includes('/marketplace/create')) await armClickWatch(['publish', 'post', 'list']);
          }
          if (mpCancel) throw new Error('Stopped by you.');
          if (!published) throw new Error('Not published: Publish was not clicked within 15 minutes (or the form was closed).');
        }

        // wait for Facebook to leave the form (= listing created) instead of a fixed pause
        for (let i = 0; i < 40 && page().url().includes('/marketplace/create'); i++) await sleep(500);
        await overlay('Publishing… waiting for Facebook to finish.');
        await sleep(1500);
        const fbErr = await page().evaluate(() => {
          const t = Array.from(document.querySelectorAll('div[role="dialog"], div[role="alert"]')).map((d) => d.innerText || '').join(' ');
          const m = t.match(/(couldn.t (publish|post|list)[^.\n]*|something went wrong[^.\n]*|limit[^.\n]*listings?[^.\n]*|you can.t (list|post|sell)[^.\n]*|try again later[^.\n]*|temporarily blocked[^.\n]*|[^.\n]*duplicate[^.\n]*|[^.\n]*similar to (a|one of your|another) listing[^.\n]*)/i);
          return m ? m[0].trim() : '';
        }).catch(() => '');
        if (fbErr) throw new Error('Facebook said: "' + fbErr + '"');

        const hit = await findListingOnSellingPage(v);
        if (hit && hit.flagged) {
          // created, but Facebook did not publish it (e.g. "duplicate listing", rejected, under review)
          const s2 = await shot('mp_needs_attention');
          setListing(v, {
            status: 'needs_attention', url: hit.url, fbId: hit.fbId, postedPrice: v.price, publishedAt: now(), checkedAt: now(),
            error: `Facebook put this listing under "Needs attention": ${hit.flagged}. Open it on Facebook to see why (for example a duplicate of an earlier listing) and fix or delete it (screenshot ${s2}).`,
          }, 'Needs attention on Facebook: ' + hit.flagged);
          log(`Marketplace: created but NOT live — Facebook says "${hit.flagged}" (Needs attention).`);
          return;
        }
        if (hit) {
          setListing(v, { status: 'published', url: hit.url, fbId: hit.fbId, postedPrice: v.price, error: '', publishedAt: now(), checkedAt: now() }, 'Published, listing link found: ' + hit.url);
          log(`Marketplace: PUBLISHED ✓ ${hit.url}`);
          return;
        }
        const s = await shot('mp_unconfirmed');
        setListing(v, { status: 'unconfirmed', error: 'Publish was clicked but the new listing was found neither in "Your listings" nor under "Needs attention". Facebook can take a few minutes: open Facebook, copy the listing link and paste it here (screenshot ' + s + ').' }, 'Publish clicked, listing not found yet');
        log('Marketplace: Publish was clicked but the listing was not found in "Your listings" or "Needs attention" yet. Paste its link on the Marketplace page once it appears.');
      }

      async function updateListing(v, { price, description }) {
        if (!v.listing.fbId) throw new Error('This vehicle has no saved Facebook listing ID. Paste the listing link first.');
        mpActive = { vehicleId: v.id, action: 'update' }; emit({ type: 'mp', active: mpActive });
        await page().goto(`https://www.facebook.com/marketplace/edit/?listing_id=${v.listing.fbId}`, { waitUntil: 'domcontentloaded' });
        await sleep(4500);
        const priceF = await findField(['Price']);
        if (!priceF) { const s = await shot('mp_edit'); throw new Error(`The edit form did not open (screenshot ${s}). The listing may have been removed.`); }
        if (price) await typeInto(priceF.h, price);
        if (description) {
          const d = await findField(['Description']);
          if (d && d.h) await typeInto(d.h, fbDescription(v), true);
        }
        await armClickWatch(['update', 'save', 'publish']);
        await overlay(`New price <b>$${fmtNum(price)}</b> entered. Check it and click Facebook's <b>Update</b> button.`);
        log('Marketplace: new price entered, click "Update" in Chrome.');
        const end = Date.now() + 10 * 60000;
        let done = false;
        while (Date.now() < end && !mpCancel) {
          await sleep(1000);
          const c = await clicked();
          if (c.some((t) => /^(update|save|publish)/.test(t))) { done = true; break; }
          if (!page().url().includes('/marketplace/edit')) { done = true; break; }
        }
        if (!done) throw new Error(mpCancel ? 'Stopped by you.' : 'Update was not clicked within 10 minutes.');
        await sleep(5000);
        // verify on the listing page
        await page().goto(v.listing.url, { waitUntil: 'domcontentloaded' });
        await sleep(4000);
        const t = (await pageText()).replace(/,/g, '');
        const verified = t.includes(String(price));
        setListing(v, { postedPrice: price, checkedAt: now(), error: verified ? '' : 'Price change clicked but not yet visible on the listing page, check it on Facebook.' },
          verified ? `Price updated to $${fmtNum(price)} (verified)` : `Price update clicked ($${fmtNum(price)}), not verified yet`);
        log(verified ? 'Marketplace: price update verified on the listing ✓' : 'Marketplace: Update clicked; the new price is not visible on the listing yet.');
      }

      async function checkListing(v) {
        await page().goto(v.listing.url, { waitUntil: 'domcontentloaded' });
        await sleep(4500);
        const t = await pageText();
        if (/this listing (isn.t|is no longer) available|content isn.t available|listing (was|has been) (removed|deleted)|page isn.t available/i.test(t)) return 'gone';
        if (/\bsold\b/i.test(t.slice(0, 3000)) && t.toLowerCase().includes(String(v.model || '').toLowerCase().split(' ')[0])) return 'sold';
        if (t.includes(String(v.year)) && t.toLowerCase().includes(String(v.make || '').toLowerCase())) return 'active';
        return 'unknown';
      }

      async function removeListing(v, mode) {
        if (!v.listing.url) throw new Error('No Facebook link saved for this vehicle.');
        mpActive = { vehicleId: v.id, action: mode }; emit({ type: 'mp', active: mpActive });
        await page().goto(v.listing.url, { waitUntil: 'domcontentloaded' });
        await sleep(4000);
        await armClickWatch(['mark as sold', 'delete', 'delete listing', 'mark as available']);
        await overlay(mode === 'sold'
          ? 'Click <b>Mark as sold</b> on this listing (it may be under the <b>⋯</b> menu).'
          : 'Open the <b>⋯</b> menu on this listing and click <b>Delete listing</b>, then confirm <b>Delete</b>.');
        log(`Marketplace: ${mode === 'sold' ? 'click "Mark as sold"' : 'delete the listing'} in Chrome.`);
        const end = Date.now() + 10 * 60000;
        let done = false;
        while (Date.now() < end && !mpCancel) {
          await sleep(1000);
          const c = await clicked();
          if (mode === 'sold' && c.some((t) => t.startsWith('mark as sold'))) { done = true; break; }
          if (mode === 'delete' && c.filter((t) => t.startsWith('delete')).length >= 2) { done = true; break; } // menu item + confirm
          if (mode === 'delete' && c.some((t) => t.startsWith('delete')) && !(await page().$('div[role="dialog"]'))) { done = true; break; }
        }
        if (!done) throw new Error(mpCancel ? 'Stopped by you.' : 'Nothing was clicked within 10 minutes.');
        await sleep(5000);
        const st = await checkListing(v);
        if (mode === 'sold') {
          v.status = 'sold';
          setListing(v, { status: 'sold', checkedAt: now(), error: st === 'sold' || st === 'gone' ? '' : 'Marked as sold in Chrome; Facebook page did not show "Sold" yet.' }, `Marked as sold${st === 'sold' || st === 'gone' ? ' (verified)' : ''}`);
        } else if (st === 'gone') {
          setListing(v, { status: 'removed', checkedAt: now(), error: '' }, 'Deleted on Facebook (verified)');
        } else {
          setListing(v, { checkedAt: now(), error: 'Delete was clicked but the listing still opens on Facebook. Check it, then use "Mark removed".' }, 'Delete clicked, listing still visible');
        }
        log(`Marketplace: ${mode} finished (listing check: ${st}).`);
      }

      async function verifyListing(v) {
        if (!v.listing.url) throw new Error('No Facebook link saved for this vehicle.');
        mpActive = { vehicleId: v.id, action: 'verify' }; emit({ type: 'mp', active: mpActive });
        const st = await checkListing(v);
        const map = { active: 'published', gone: 'removed', sold: 'sold' };
        if (map[st]) setListing(v, { status: map[st], checkedAt: now(), error: '' }, `Checked on Facebook: ${st}`);
        else setListing(v, { checkedAt: now() }, 'Checked on Facebook: could not tell (page layout)');
        log(`Marketplace: listing check for ${v.year} ${v.make} ${v.model}: ${st}`);
      }


    return { publishVehicle, updateListing, removeListing, verifyListing, removeOverlay };
  })();
  S.page = () => page;

  // ---------- Marketplace queue: one vehicle at a time ----------
  const queue = [];
  let running = false;

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const task = queue.shift();
        let v = null;
        try { v = await hooks.getVehicle(task.id, task.action); } catch (e) { log(`Marketplace: ${e.message}`); }
        if (!v) continue;
        try {
          // a group posting run (or a Pages / groups load) may be busy: wait for it instead of failing
          while (busy && !mpCancel) await sleep(1000);
          if (mpCancel) throw new Error('Stopped by you.');
          busy = true; busyWhat = 'Marketplace'; mpCancel = false; S.lastAction = Date.now();
          try {
            await needLogin(); // starts Chrome with the saved login when it is asleep
            if (task.action === 'publish') await MP.publishVehicle(v);
            else if (task.action === 'update') await MP.updateListing(v, task.opts || {});
            else if (task.action === 'sold' || task.action === 'delete') await MP.removeListing(v, task.action);
            else if (task.action === 'verify') await MP.verifyListing(v);
          } finally {
            busy = false; busyWhat = ''; mpActive = null;
            await MP.removeOverlay();
          }
        } catch (e) {
          log(`Marketplace: ${task.action} failed: ${e.message}`);
          if (task.action === 'publish') hooks.setListing(v.id, { status: 'failed', error: e.message }, 'Failed: ' + e.message);
          else hooks.setListing(v.id, { error: e.message }, `${task.action} failed: ${e.message}`);
          if (/Stopped by you|login|Not logged in/i.test(e.message)) dropQueue();
        } finally {
          try { hooks.releaseVehicle && hooks.releaseVehicle(v.id); } catch (e) {}
        }
        if (queue.length) {
          const gap = Math.max(10, Number(hooks.gapSeconds()) || 45);
          const wait = Math.round(gap * (0.8 + Math.random() * 0.4));
          log(`Marketplace: next vehicle in ${wait}s (${queue.length} left)...`);
          for (let i = 0; i < wait && !mpCancel; i++) await sleep(1000);
        }
      }
    } finally {
      running = false;
      mpCancel = false;
    }
  }

  function dropQueue() {
    for (const t of queue.splice(0)) if (t.action === 'publish') hooks.setListing(t.id, { status: 'none' }, 'Removed from queue');
  }

  function mpEnqueue(tasks) {
    for (const t of tasks) if (!queue.some((q) => q.id === t.id && q.action === t.action)) queue.push(t);
    S.lastAction = Date.now();
    pump();
  }

  function mpStop() {
    mpCancel = true;
    dropQueue();
    log('Marketplace: stopped.');
  }

  // ---------- state for the portal ----------
  async function state(logAfter = 0, peek = false) {
    if (!peek) S.lastSeen = Date.now();
    const open = !!(browser && page && !page.isClosed());
    const li = open ? await isLoggedIn() : null;
    if (li) S.loginLost = false;
    return {
      browserOpen: open,
      loggedIn: open ? li : S.loginLost ? false : null, // null = browser asleep, login not checked
      loginLost: S.loginLost,
      busy,
      busyWhat,
      view: view.on,
      url: open ? page.url() : '',
      job,
      mp: { active: mpActive, queue: queue.map((q) => ({ id: q.id, action: q.action })), running, report: lastReport },
      logs: logs.filter((l) => l.seq > logAfter),
      logSeq,
    };
  }

  const idle = () => !busy && !running && !queue.length && !launching;

  return {
    S, log, state, idle,
    isOpen: () => !!browser,
    healthy, viewOn: () => view.on,
    ensureBrowser, warm, isLoggedIn, fbUserId, fetchName, connect, close, switchAccount, forget,
    viewStart, viewStop, frame, input, nav,
    loadPages, loadGroups, switchToPage, startPost, stopPosting,
    mpEnqueue, mpStop, mpQueued: () => queue.map((q) => q.id),
  };
}
