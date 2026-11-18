/**
 * Form 3: FTC Buyers Guide (Used Car Rule, 16 CFR 455), laid out as a summary of the official form.
 * Dealers who prefer the FTC's own fillable form can print it from ftc.gov; this sheet carries the same facts.
 */
import { type DealDoc, dealerAddress, mdy } from '../deal-doc.js';
import { GREY, M, Sheet, W } from './layout.js';

const SYSTEMS = [
  'Frame & body',
  'Engine',
  'Transmission & drive shaft',
  'Differential',
  'Cooling system',
  'Electrical system',
  'Fuel system',
  'Inoperable accessories',
  'Brake system',
  'Steering system',
  'Suspension system',
  'Tires',
  'Wheels',
  'Exhaust system',
];

export function drawBuyersGuide(s: Sheet, d: DealDoc) {
  const w = d.warranty;
  const v = d.vehicle;
  s.center(s.y, 'BUYERS GUIDE', 30, true);
  s.y += 36;
  s.center(s.y, 'IMPORTANT: Ask the dealer to put all promises in writing. Keep this form.', 10, true);
  s.y += 18;

  s.cells([
    ['Vehicle make', v.make, 1.3],
    ['Model', [v.model, v.trim].filter(Boolean).join(' '), 1.6],
    ['Year', v.year, 0.7],
    ['VIN', v.vin, 2.6],
  ]);
  s.cells([
    ['Stock number (optional)', v.stockNumber, 1],
    ['Deal number', d.dealNumber, 1],
    ['Date', mdy(d.saleDate), 1],
  ]);
  s.y += 10;

  s.band('WARRANTIES FOR THIS VEHICLE', 12);
  // AS IS
  const asIs = w.type === 'AS_IS';
  s.ensure(48);
  s.check(M + 4, s.y + 4, asIs, 22);
  s.text(M + 36, s.y + 2, 'AS IS - NO DEALER WARRANTY', 17, true);
  s.text(M + 36, s.y + 23, 'The dealer does not provide a warranty for repairs after the sale.', 9);
  s.y += 44;
  s.hline(M, W - M, s.y - 4, 0.4);

  // DEALER WARRANTY
  s.ensure(150);
  s.check(M + 4, s.y + 4, !asIs, 22);
  s.text(M + 36, s.y + 2, 'DEALER WARRANTY', 17, true);
  s.y += 28;
  s.check(M + 36, s.y, !asIs && w.kind === 'FULL', 11);
  s.text(M + 52, s.y + 1, 'FULL WARRANTY', 10, true);
  s.check(M + 170, s.y, !asIs && w.kind === 'LIMITED', 11);
  s.text(M + 186, s.y + 1, 'LIMITED WARRANTY', 10, true);
  s.y += 18;
  const pct = (x: string) => (!asIs && w.kind === 'LIMITED' && x ? x : '____');
  s.para(
    `Dealer pays ${pct(w.laborPct)}% of labor and ${pct(w.partsPct)}% of parts for covered systems that fail during the warranty period. Ask the dealer for a copy of the warranty document.`,
    { x: M + 36, size: 9, gap: 6 },
  );
  s.cells(
    [
      ['SYSTEMS COVERED', asIs ? '' : w.systemsCovered, 3],
      ['DURATION', asIs ? '' : w.duration, 2],
    ],
    34,
    M + 36,
  );
  s.y += 10;

  s.ensure(40);
  s.check(M + 4, s.y, w.serviceContract, 12);
  s.text(M + 24, s.y + 1, 'SERVICE CONTRACT', 10, true);
  s.text(M + 130, s.y + 1.5, 'A service contract is available for this vehicle at an extra charge. Ask for details.', 8.5);
  s.y += 22;

  s.band('BEFORE YOU BUY');
  s.para('Ask the dealer if your mechanic can inspect the vehicle on or off the lot.', { size: 9, gap: 2 });
  s.para('Get a vehicle history report (ftc.gov/usedcars) and check for open safety recalls (safercar.gov) using the VIN above.', { size: 9, gap: 8 });

  // major systems (summary of the list on the back of the official guide)
  s.band('MAJOR SYSTEMS - ask about defects that may occur in used vehicles');
  const cols = 3;
  const cw = (W - 2 * M) / cols;
  const rows = Math.ceil(SYSTEMS.length / cols);
  s.ensure(rows * 13 + 8);
  SYSTEMS.forEach((name, i) => {
    const c = Math.floor(i / rows);
    const r = i % rows;
    s.text(M + c * cw + 4, s.y + r * 13, `- ${name}`, 9);
  });
  s.y += rows * 13 + 10;

  s.band('DEALER');
  s.cells([
    ['Dealer name', d.dealer.legalName || d.dealer.name, 2],
    ['Dealer license no.', d.dealer.licenseNumber, 1],
  ]);
  s.cells([
    ['Address', dealerAddress(d.dealer), 3],
    ['Phone', d.dealer.phone, 1],
  ]);
  s.cells([['For complaints after the sale, contact', [d.dealer.name, d.dealer.phone, d.dealer.email].filter(Boolean).join(' - '), 1]]);
  s.y += 8;
  s.para('The information on this form is part of any contract to buy this vehicle.', { size: 8.5, bold: true, gap: 4 });

  s.ensure(50);
  s.y += 26;
  s.sign(M, s.y, 320, 'Buyer acknowledges receipt of this Buyers Guide - signature');
  s.sign(M + 350, s.y, W - 2 * M - 350, 'Date');
  s.y += 14;
  s.text(M, s.y + 4, 'Si el concesionario gestiona la venta en espanol, pidale una copia de la Guia del Comprador en espanol.', 7.5, false, GREY);
  s.y += 14;
}
