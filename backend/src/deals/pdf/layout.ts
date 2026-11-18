/** Small drawing helper on top of pdf-lib for the deal forms (US Letter, points, origin top-left). */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

export const W = 612;
export const H = 792;
export const M = 40; // page margin
export const INK = rgb(0, 0, 0);
export const GREY = rgb(0.35, 0.35, 0.35);
export const LIGHT = rgb(0.92, 0.92, 0.92);

/** Standard PDF fonts only know WinAnsi: anything else is simplified or replaced. */
export function safe(t: unknown): string {
  return String(t ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\r\n\t]+/g, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

export class Sheet {
  page!: PDFPage;
  y = M; // distance from the top
  constructor(
    readonly pdf: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.addPage();
  }

  static async create(pdf?: PDFDocument) {
    const doc = pdf ?? (await PDFDocument.create());
    return new Sheet(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  }

  addPage() {
    this.page = this.pdf.addPage([W, H]);
    this.y = M;
    return this.page;
  }

  /** start a new page when fewer than `need` points are left */
  ensure(need: number) {
    if (this.y + need > H - M) this.addPage();
  }

  text(x: number, top: number, t: unknown, size = 9, isBold = false, color = INK) {
    const s = safe(t);
    if (!s) return;
    this.page.drawText(s, { x, y: H - top - size, size, font: isBold ? this.bold : this.font, color });
  }

  width(t: unknown, size = 9, isBold = false) {
    return (isBold ? this.bold : this.font).widthOfTextAtSize(safe(t), size);
  }

  center(top: number, t: unknown, size = 12, isBold = true, x0 = 0, x1 = W) {
    const w = this.width(t, size, isBold);
    this.text(x0 + (x1 - x0 - w) / 2, top, t, size, isBold);
  }

  right(xRight: number, top: number, t: unknown, size = 9, isBold = false) {
    this.text(xRight - this.width(t, size, isBold), top, t, size, isBold);
  }

  /** a value that must fit one line: font shrinks down to 6 pt, then the text is cut */
  fit(x: number, top: number, t: unknown, maxW: number, size = 10, isBold = false) {
    let s = safe(t);
    let sz = size;
    while (sz > 6 && this.width(s, sz, isBold) > maxW) sz -= 0.5;
    while (s && this.width(s, sz, isBold) > maxW) s = s.slice(0, -1);
    this.text(x, top + (size - sz) / 2, s, sz, isBold);
  }

  lines(t: unknown, maxW: number, size = 9, isBold = false): string[] {
    const out: string[] = [];
    for (const para of String(t ?? '').split(/\n/)) {
      const words = safe(para).split(' ');
      let cur = '';
      for (const w of words) {
        const next = cur ? cur + ' ' + w : w;
        if (this.width(next, size, isBold) <= maxW || !cur) cur = next;
        else {
          out.push(cur);
          cur = w;
        }
      }
      out.push(cur);
    }
    return out;
  }

  /** wrapped paragraph at the cursor; returns its height */
  para(t: unknown, opts: { x?: number; w?: number; size?: number; bold?: boolean; gap?: number; lead?: number } = {}) {
    const x = opts.x ?? M;
    const w = opts.w ?? W - M - x;
    const size = opts.size ?? 9;
    const lead = opts.lead ?? size * 1.3;
    const ls = this.lines(t, w, size, opts.bold);
    this.ensure(ls.length * lead);
    ls.forEach((l, i) => this.text(x, this.y + i * lead, l, size, opts.bold));
    const h = ls.length * lead;
    this.y += h + (opts.gap ?? 4);
    return h;
  }

  rect(x: number, top: number, w: number, h: number, opts: { fill?: ReturnType<typeof rgb>; border?: number } = {}) {
    this.page.drawRectangle({
      x,
      y: H - top - h,
      width: w,
      height: h,
      color: opts.fill,
      borderColor: opts.border === 0 ? undefined : INK,
      borderWidth: opts.border ?? 0.75,
    });
  }

  hline(x0: number, x1: number, top: number, thick = 0.75) {
    this.page.drawLine({ start: { x: x0, y: H - top }, end: { x: x1, y: H - top }, thickness: thick, color: INK });
  }

  check(x: number, top: number, on: boolean, size = 10) {
    this.rect(x, top, size, size);
    if (on) {
      const p = this.page;
      const t = 1.4;
      p.drawLine({ start: { x: x + 2, y: H - top - 2 }, end: { x: x + size - 2, y: H - top - size + 2 }, thickness: t, color: INK });
      p.drawLine({ start: { x: x + size - 2, y: H - top - 2 }, end: { x: x + 2, y: H - top - size + 2 }, thickness: t, color: INK });
    }
  }

  /** black band with a white title */
  band(t: string, size = 10) {
    this.ensure(size + 14);
    this.page.drawRectangle({ x: M, y: H - this.y - (size + 8), width: W - 2 * M, height: size + 8, color: INK });
    this.page.drawText(safe(t), { x: M + 6, y: H - this.y - size - 4, size, font: this.bold, color: rgb(1, 1, 1) });
    this.y += size + 10;
  }

  /**
   * a row of labelled boxes: small caption at the top-left, value underneath.
   * cells: [caption, value, relative width]
   */
  cells(cells: [string, unknown, number][], h = 24, x0 = M, x1 = W - M) {
    this.ensure(h);
    const total = cells.reduce((a, c) => a + c[2], 0);
    let x = x0;
    for (const [cap, val, rel] of cells) {
      const w = ((x1 - x0) * rel) / total;
      this.rect(x, this.y, w, h);
      this.text(x + 3, this.y + 2.5, cap, 6.5, false, GREY);
      this.fit(x + 4, this.y + h - 13, val, w - 8, 10);
      x += w;
    }
    this.y += h;
  }

  /** signature line with caption underneath */
  sign(x: number, top: number, w: number, caption: string) {
    this.hline(x, x + w, top);
    this.text(x, top + 3, caption, 7, false, GREY);
  }

  footer(t: string) {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => {
      const s = safe(`${t}   Page ${i + 1} of ${pages.length}`);
      p.drawText(s, { x: M, y: 22, size: 7, font: this.font, color: GREY });
    });
  }
}
