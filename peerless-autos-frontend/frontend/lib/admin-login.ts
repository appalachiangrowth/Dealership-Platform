/**
 * "Admin Login" link in the website footer (Peerless storefront only).
 *
 * The designs are shared with the multi-dealer platform. There, Classic links "admin/" relative to the site; the
 * other designs have no admin link at all. On the Peerless site the Dealer Portal lives at
 * https://peerlessautosales1.com/admin (NEXT_PUBLIC_DEALER_PORTAL_URL overrides it), so every rendered page:
 *  - points an existing admin link (Classic) at the Peerless Dealer Portal, and
 *  - gets the same small link next to the © line of its footer's bottom bar when the design has none.
 * Done when the page is rendered, so designs installed later get it too, without editing their files.
 */

const DEFAULT_PORTAL = 'https://peerlessautosales1.com/admin';

/** The Peerless Dealer Portal address (absolute, no trailing slash). */
export function dealerPortalUrl(): string {
  const raw = String(process.env.NEXT_PUBLIC_DEALER_PORTAL_URL || process.env.DEALER_PORTAL_URL || '').trim();
  const m = raw.match(/^https?:\/\/[^\s"'<>]+/i);
  return (m ? m[0] : DEFAULT_PORTAL).replace(/\/+$/, '');
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** a design's own admin link: href="admin/", "./admin", "/admin/" … */
const OWN_LINK = /href="(?:\.?\/)?admin\/?"/g;

/**
 * The © line of the footer's bottom bar: the first <span> starting with © after the last <footer>, which may hold one
 * nested <span> (e.g. Vroomfox: <span>© <span id="ftYear">2026</span> Name. All rights reserved.</span>).
 */
const COPYRIGHT = /<span>\s*(?:©|&copy;|&#169;)(?:[^<]|<span[^>]*>[^<]*<\/span>|<(?:b|strong|em|i)>[^<]*<\/(?:b|strong|em|i)>)*?<\/span>/;

/** @param label the dealer's own text for the link (Content › global.footer.admin), "Admin Login" when not set */
export function withAdminLogin(html: string, label = ''): string {
  const url = attr(dealerPortalUrl());
  const name = text(String(label || '').trim() || 'Admin Login');

  // 1. designs that already have the link (Classic): same place, same style, Peerless portal address
  const pointed = html.replace(OWN_LINK, `href="${url}"`);
  if (pointed !== html || pointed.includes('data-pa-admin-login')) return pointed;

  // 2. designs without one: add it to the © line of the footer's bottom bar
  const f = pointed.lastIndexOf('<footer');
  if (f < 0) return pointed;
  const m = COPYRIGHT.exec(pointed.slice(f));
  if (!m) return pointed;
  const end = f + m.index + m[0].length - '</span>'.length;
  const link =
    `<span aria-hidden="true">&nbsp;&nbsp;•&nbsp;&nbsp;</span>` +
    `<a href="${url}" class="pa-admin-login" data-pa-admin-login rel="nofollow" ` +
    `style="color:inherit;text-decoration:none;opacity:.85" ` +
    `onmouseover="this.style.opacity=1;this.style.textDecoration='underline'" onmouseout="this.style.opacity=.85;this.style.textDecoration='none'">${name}</a>`;
  return pointed.slice(0, end) + link + pointed.slice(end);
}
