/**
 * Form 4: Virginia DMV VSA 17A (Application for Certificate of Title and Registration).
 * - built-in layout: every section of the application as labelled boxes, filled from the deal;
 * - official PDF: when a StateFormTemplate is active, the government's own fillable PDF is filled instead,
 *   using its field mappings (PDF field name → deal key, see deal-keys.ts).
 */
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { type DealDoc, mdy, usd } from '../deal-doc.js';
import { keyValue } from '../deal-keys.js';
import { GREY, M, Sheet, W } from './layout.js';

const ODO = { ACTUAL: 'Actual mileage', EXCEEDS_LIMITS: 'Exceeds mechanical limits', NOT_ACTUAL: 'NOT actual mileage' } as const;

export function drawVsa17a(s: Sheet, d: DealDoc) {
  const v = d.vehicle;
  const b = d.buyer;
  s.text(M, s.y, 'COMMONWEALTH OF VIRGINIA - DEPARTMENT OF MOTOR VEHICLES', 9, true);
  s.right(W - M, s.y, 'VSA 17A', 12, true);
  s.y += 14;
  s.text(M, s.y, 'APPLICATION FOR CERTIFICATE OF TITLE AND REGISTRATION', 14, true);
  s.y += 18;
  s.text(M, s.y, `Prepared by ${d.dealer.legalName || d.dealer.name} - Deal ${d.dealNumber}`, 8, false, GREY);
  s.y += 14;

  s.band('PURPOSE OF APPLICATION');
  s.ensure(22);
  const opts: [boolean, string][] = [
    [d.titlePurpose === 'TITLE_AND_REGISTRATION', 'Title and registration'],
    [d.titlePurpose === 'TITLE_ONLY', 'Title only'],
    [d.titlePurpose === 'TRANSFER_PLATE', `Transfer plate${d.plateNumber ? ` no. ${d.plateNumber}` : ''}`],
  ];
  opts.forEach(([on, label], i) => {
    const x = M + 4 + i * 170;
    s.check(x, s.y, on, 11);
    s.text(x + 16, s.y + 1, label, 9.5, on);
  });
  s.y += 20;

  s.band('OWNER INFORMATION');
  s.cells([['Last name', b.lastName || b.fullName.split(' ').slice(-1)[0], 2], ['First name', b.firstName || b.fullName.split(' ')[0], 1.6], ['Middle name', b.middleName, 1.2], ['Date of birth', mdy(b.dob), 1.1]]);
  s.cells([["VA driver's license / DMV customer no.", b.licenseNumber, 2], ['Issuing state', b.licenseState, 0.8], ['Phone', b.phone, 1.4], ['Email', b.email, 2]]);
  s.cells([['Residence street address', b.address, 3], ['City', b.city, 1.5], ['State', b.state, 0.6], ['ZIP', b.zip, 0.9]]);
  s.cells([['County / city of jurisdiction (where vehicle is garaged)', b.county, 1]]);
  s.y += 4;

  s.band('CO-OWNER INFORMATION');
  s.cells([['Co-owner full legal name', d.coBuyer.fullName, 2], ["Driver's license / customer no.", d.coBuyer.licenseNumber, 1.3], ['Phone', d.coBuyer.phone, 1]]);
  s.cells([['Co-owner address', d.coBuyer.address, 1]]);
  s.y += 4;

  s.band('VEHICLE INFORMATION');
  s.cells([['Vehicle identification number (VIN)', v.vin, 3], ['Year', v.year, 0.7], ['Make', v.make, 1.3], ['Model', v.model, 1.4]]);
  s.cells([['Body type', v.bodyStyle, 1.3], ['Color', v.color, 1], ['Fuel type', v.fuelType, 1], ['Gross vehicle weight (GVWR)', d.gvwr, 1.3]]);
  s.cells([
    ['Odometer reading', d.odometer.reading === null ? '' : d.odometer.reading.toLocaleString('en-US'), 1.2],
    ['Odometer status', ODO[d.odometer.status], 1.5],
    ['Date of sale', mdy(d.saleDate), 1],
    ['Purchase price', usd(d.money.salePrice), 1],
    ['Trade-in', d.money.tradeInAllowance ? usd(d.money.tradeInAllowance) : '', 1],
    ['Sales & use tax', usd(d.money.salesTaxAmount), 1],
  ]);
  s.y += 4;

  s.band('LIENHOLDER INFORMATION');
  const lien = d.paymentMethod !== 'CASH' && !!d.lienholder.name;
  s.ensure(18);
  s.check(M + 4, s.y, !lien, 10);
  s.text(M + 18, s.y + 1, 'No lien', 9);
  s.y += 16;
  s.cells([['First lienholder name', lien ? d.lienholder.name : '', 2], ['Date of lien', lien ? mdy(d.lienholder.date) : '', 1]]);
  s.cells([['Lienholder address', lien ? d.lienholder.address : '', 1]]);
  s.y += 4;

  s.band('SELLER / VIRGINIA DEALER CERTIFICATION');
  s.cells([['Dealership name', d.dealer.legalName || d.dealer.name, 2], ['VA dealer certificate / license no.', d.dealer.licenseNumber, 1.3]]);
  s.cells([['Dealer address', [d.dealer.street, d.dealer.city, d.dealer.state, d.dealer.zip].filter(Boolean).join(', '), 3], ['Phone', d.dealer.phone, 1]]);
  s.ensure(40);
  s.y += 26;
  s.sign(M, s.y, 330, 'Authorized dealer signature');
  s.sign(M + 360, s.y, W - 2 * M - 360, 'Date');
  s.y += 18;

  s.band('APPLICANT CERTIFICATION');
  s.para('I certify that the information on this application is true and correct.', { size: 8.5, gap: 4 });
  s.ensure(70);
  s.y += 22;
  s.sign(M, s.y, 330, 'Owner signature');
  s.sign(M + 360, s.y, W - 2 * M - 360, 'Date');
  s.y += 30;
  s.sign(M, s.y, 330, 'Co-owner signature');
  s.sign(M + 360, s.y, W - 2 * M - 360, 'Date');
  s.y += 18;
  s.text(M, s.y, 'Virginia DMV may require its official form; an official fillable VSA 17A can be uploaded to fill it automatically.', 7, false, GREY);
  s.y += 12;
}

/** every fillable field of a PDF: name + kind */
export async function readPdfFields(bytes: Uint8Array): Promise<{ name: string; type: string }[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdf
    .getForm()
    .getFields()
    .map((f) => ({ name: f.getName(), type: f.constructor.name.replace(/^PDF/, '') }));
}

/** fills the official PDF from the deal; fields stay editable */
export async function fillOfficialPdf(bytes: Uint8Array, mappings: Record<string, string>, d: DealDoc): Promise<PDFDocument> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  for (const f of form.getFields()) {
    const key = mappings[f.getName()];
    if (!key) continue;
    const val = keyValue(key, d);
    try {
      if (f instanceof PDFTextField) {
        const t = typeof val === 'boolean' ? (val ? 'X' : '') : val;
        const max = f.getMaxLength();
        f.setText(max ? t.slice(0, max) : t);
      } else if (f instanceof PDFCheckBox) {
        if (val === true || (typeof val === 'string' && val.trim() !== '')) f.check();
        else f.uncheck();
      } else if (f instanceof PDFRadioGroup) {
        const o = f.getOptions().find((x) => x.toLowerCase() === String(val).toLowerCase());
        if (o) f.select(o);
      } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
        const o = f.getOptions().find((x) => x.toLowerCase() === String(val).toLowerCase());
        if (o) f.select(o);
      }
    } catch {
      // a field the PDF won't let us fill (read-only, odd appearance): left blank
    }
  }
  return pdf;
}
