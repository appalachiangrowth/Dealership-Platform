/** Form 2: Federal Odometer Disclosure Statement (49 CFR Part 580) */
import { type DealDoc, buyerAddress, dealerAddress, mdy } from '../deal-doc.js';
import { GREY, M, Sheet, W } from './layout.js';

export function drawOdometer(s: Sheet, d: DealDoc) {
  s.center(s.y, 'ODOMETER DISCLOSURE STATEMENT', 17, true);
  s.y += 22;
  s.center(s.y, 'Federal Odometer Disclosure - 49 CFR Part 580', 9, false);
  s.y += 18;
  s.rect(M, s.y, W - 2 * M, 40);
  s.y += 7;
  s.para(
    'Federal law (and State law, if applicable) requires that you state the mileage upon transfer of ownership. Failure to complete or providing a false statement may result in fines and/or imprisonment.',
    { x: M + 8, w: W - 2 * M - 16, size: 10, bold: true, gap: 0 },
  );
  s.y += 16;

  const transferor = d.dealer.legalName || d.dealer.name;
  const miles = d.odometer.reading === null ? '' : d.odometer.reading.toLocaleString('en-US');
  // statement with the reading written in
  s.text(M, s.y, 'I,', 10);
  s.fit(M + 12, s.y - 1, transferor, 260, 10, true);
  s.hline(M + 10, M + 280, s.y + 11);
  s.text(M + 286, s.y, "(transferor's name, print), state that the odometer", 10);
  s.y += 18;
  s.text(M, s.y, '(of the vehicle described below) now reads', 10);
  // the exact reading box (no tenths)
  const bx = M + 206;
  s.rect(bx, s.y - 6, 120, 22);
  s.fit(bx + 8, s.y - 1, miles, 104, 13, true);
  s.text(bx + 128, s.y, 'miles (no tenths) and to the best of my', 10);
  s.y += 22;
  s.para(
    'knowledge that it reflects the actual mileage of the vehicle described below, unless one of the following statements is checked.',
    { size: 10, gap: 12 },
  );

  const st = d.odometer.status;
  const opt = (on: boolean, n: string, t: string, bold = false) => {
    s.ensure(36);
    s.check(M + 4, s.y, on, 12);
    s.text(M + 24, s.y + 1, n, 10, true);
    const top = s.y;
    s.y = top;
    s.para(t, { x: M + 44, w: W - 2 * M - 44, size: 10, bold, gap: 10 });
  };
  opt(st === 'ACTUAL', '(1)', 'ACTUAL MILEAGE: I hereby certify that to the best of my knowledge the odometer reading reflects the actual mileage of the vehicle described below.');
  opt(st === 'EXCEEDS_LIMITS', '(2)', 'I hereby certify that to the best of my knowledge the odometer reading reflects the amount of mileage in excess of its mechanical limits.');
  opt(st === 'NOT_ACTUAL', '(3)', 'I hereby certify that the odometer reading is NOT the actual mileage. WARNING - ODOMETER DISCREPANCY.', true);
  s.y += 4;

  s.band('VEHICLE');
  const v = d.vehicle;
  s.cells([
    ['Year', v.year, 0.7],
    ['Make', v.make, 1.3],
    ['Model', [v.model, v.trim].filter(Boolean).join(' '), 1.8],
    ['Body type', v.bodyStyle, 1.2],
  ]);
  s.cells([
    ['Vehicle identification number (VIN)', v.vin, 3],
    ['Date of statement', mdy(d.saleDate), 1.2],
  ]);
  s.y += 10;

  const party = (title: string, name: string, addr: string, sig: string) => {
    s.ensure(110);
    s.band(title);
    s.cells([
      ['Printed name', name, 2],
      ['Address', addr, 3],
    ]);
    s.y += 30;
    s.sign(M, s.y, 300, sig);
    s.sign(M + 330, s.y, W - 2 * M - 330, 'Date of statement');
    s.text(M + 334, s.y - 13, mdy(d.saleDate), 10);
    s.y += 22;
  };
  party('TRANSFEROR (SELLER / DEALER)', transferor + (d.dealer.licenseNumber ? `  (Dealer Lic. ${d.dealer.licenseNumber})` : ''), dealerAddress(d.dealer), "Transferor's signature (authorized representative)");
  party('TRANSFEREE (BUYER)', [d.buyer.fullName, d.coBuyer.fullName].filter(Boolean).join(' and '), buyerAddress(d.buyer), "Transferee's signature");
  s.para(
    "The transferee acknowledges receipt of this statement and is aware of the odometer certification made by the transferor.",
    { size: 8.5, gap: 4 },
  );
  s.text(M, s.y + 4, `Deal No. ${d.dealNumber}`, 8, false, GREY);
  s.y += 14;
}
