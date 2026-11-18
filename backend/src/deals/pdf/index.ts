/** The 4 deal forms, one at a time or merged into the complete deal packet. */
import { PDFDocument } from 'pdf-lib';
import type { DealDoc } from '../deal-doc.js';
import { Sheet } from './layout.js';
import { drawBillOfSale } from './bill-of-sale.js';
import { drawOdometer } from './odometer.js';
import { drawBuyersGuide } from './buyers-guide.js';
import { drawVsa17a, fillOfficialPdf } from './vsa17a.js';

export const FORM_KINDS = ['bill-of-sale', 'odometer', 'buyers-guide', 'vsa17a'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export const FORM_TITLES: Record<FormKind, string> = {
  'bill-of-sale': 'Bill of Sale',
  odometer: 'Odometer Disclosure Statement',
  'buyers-guide': 'FTC Buyers Guide',
  vsa17a: 'Virginia VSA 17A',
};

/** an official fillable PDF to use instead of the built-in VSA 17A layout */
export interface OfficialForm {
  bytes: Uint8Array;
  mappings: Record<string, string>;
}

const DRAW: Record<FormKind, (s: Sheet, d: DealDoc) => void> = {
  'bill-of-sale': drawBillOfSale,
  odometer: drawOdometer,
  'buyers-guide': drawBuyersGuide,
  vsa17a: drawVsa17a,
};

function meta(pdf: PDFDocument, d: DealDoc, title: string) {
  pdf.setTitle(`${title} - ${d.dealNumber}`);
  pdf.setAuthor(d.dealer.legalName || d.dealer.name || 'Dealership');
  pdf.setCreator('Dealer portal - Deals');
  pdf.setProducer('pdf-lib');
  pdf.setCreationDate(new Date());
}

async function builtIn(kind: FormKind, d: DealDoc): Promise<PDFDocument> {
  const s = await Sheet.create();
  DRAW[kind](s, d);
  s.footer(`${FORM_TITLES[kind]} - Deal ${d.dealNumber}`);
  return s.pdf;
}

async function one(kind: FormKind, d: DealDoc, official?: OfficialForm | null): Promise<PDFDocument> {
  if (kind === 'vsa17a' && official) {
    try {
      return await fillOfficialPdf(official.bytes, official.mappings, d);
    } catch {
      // unreadable upload: the built-in layout still works
    }
  }
  return builtIn(kind, d);
}

export async function buildForm(kind: FormKind, d: DealDoc, official?: OfficialForm | null): Promise<Uint8Array> {
  const pdf = await one(kind, d, official);
  meta(pdf, d, FORM_TITLES[kind]);
  return pdf.save();
}

/** all 4 forms in one PDF (an official fillable form is flattened so its values print) */
export async function buildPacket(d: DealDoc, official?: OfficialForm | null): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const kind of FORM_KINDS) {
    const src = await one(kind, d, official);
    try {
      src.getForm().flatten();
    } catch {
      // no form / cannot flatten: pages are copied as they are
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  meta(out, d, 'Deal Packet');
  return out.save();
}
