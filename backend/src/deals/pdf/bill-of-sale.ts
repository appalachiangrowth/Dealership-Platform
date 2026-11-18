/** Form 1: Motor Vehicle Bill of Sale */
import { type DealDoc, dealerAddress, buyerAddress, mdy, usd } from '../deal-doc.js';
import { GREY, LIGHT, M, Sheet, W } from './layout.js';

const PAY = { CASH: 'Cash', FINANCE: 'Financed (dealer-arranged)', OUTSIDE_LIEN: 'Outside lien / buyer-arranged financing' } as const;

export function drawBillOfSale(sh: Sheet, d: DealDoc) {
  const dl = d.dealer;
  // header
  sh.text(M, sh.y, dl.legalName || dl.name || 'Dealership', 15, true);
  sh.right(W - M, sh.y, 'MOTOR VEHICLE BILL OF SALE', 13, true);
  sh.y += 19;
  sh.text(M, sh.y, dealerAddress(dl), 8.5);
  sh.right(W - M, sh.y, `Deal No. ${d.dealNumber}`, 9, true);
  sh.y += 11;
  sh.text(M, sh.y, [dl.phone && `Phone ${dl.phone}`, dl.email].filter(Boolean).join('   '), 8.5);
  sh.right(W - M, sh.y, `Sale date: ${mdy(d.saleDate)}`, 9);
  sh.y += 11;
  sh.text(M, sh.y, `Dealer License No.: ${dl.licenseNumber || '________________'}`, 8.5, true);
  if (dl.legalName && dl.name && dl.legalName !== dl.name) sh.right(W - M, sh.y, `d/b/a ${dl.name}`, 8.5);
  sh.y += 14;
  sh.hline(M, W - M, sh.y, 1.5);
  sh.y += 8;

  sh.band('BUYER');
  sh.cells([['Buyer full legal name', d.buyer.fullName, 3], ['Phone', d.buyer.phone, 1.4], ['Email', d.buyer.email, 2]]);
  sh.cells([['Address', buyerAddress(d.buyer), 4], ["Driver's license no.", d.buyer.licenseNumber, 1.6], ['State', d.buyer.licenseState, 0.6], ['Date of birth', mdy(d.buyer.dob), 1.1]]);
  if (d.coBuyer.fullName) {
    sh.cells([['Co-buyer name', d.coBuyer.fullName, 3], ['Phone', d.coBuyer.phone, 1.4], ["Driver's license no.", d.coBuyer.licenseNumber, 2]]);
    sh.cells([['Co-buyer address', d.coBuyer.address, 1]]);
  }
  sh.y += 6;

  sh.band('VEHICLE');
  const v = d.vehicle;
  sh.cells([['Year', v.year, 0.8], ['Make', v.make, 1.5], ['Model', v.model, 1.7], ['Trim', v.trim, 1.5], ['Body style', v.bodyStyle, 1.5], ['Color', v.color, 1.2]]);
  sh.cells([['Vehicle identification number (VIN)', v.vin, 3], ['Stock no.', v.stockNumber, 1.3], ['Odometer reading (miles)', d.odometer.reading === null ? '' : d.odometer.reading.toLocaleString('en-US'), 1.6], ['Odometer', d.odometer.status === 'ACTUAL' ? 'Actual' : d.odometer.status === 'EXCEEDS_LIMITS' ? 'Exceeds mech. limits' : 'NOT actual', 1.5]]);
  sh.y += 6;

  const t = d.tradeIn;
  if (t.make || t.model || t.vin || d.money.tradeInAllowance) {
    sh.band('TRADE-IN VEHICLE');
    sh.cells([['Year', t.year, 0.8], ['Make', t.make, 1.5], ['Model', t.model, 1.7], ['VIN', t.vin, 3], ['Mileage', t.mileage, 1.2]]);
    sh.y += 6;
  }

  // money table (right) + payment (left)
  sh.band('PRICE AND PAYMENT');
  const m = d.money;
  const rows: [string, string, boolean?][] = [
    ['Vehicle price', usd(m.salePrice)],
    ['Less trade-in allowance', m.tradeInAllowance ? `(${usd(m.tradeInAllowance)})` : usd(0)],
    ['Plus payoff owed on trade-in', usd(m.tradeInPayoff)],
    ['Net price', usd(m.salePrice - m.tradeInAllowance + m.tradeInPayoff), true],
    ['Dealer processing (doc) fee', usd(m.docFee)],
    ['Title / registration fees', usd(m.titleRegFee)],
  ];
  if (m.otherFees) rows.push([m.otherFeesLabel || 'Other fees', usd(m.otherFees)]);
  rows.push(
    [`${d.stateCode === 'VA' ? 'Virginia motor vehicle sales & use tax' : 'Sales tax'} (${m.salesTaxRate}%)`, usd(m.salesTaxAmount)],
    ['TOTAL PRICE', usd(m.totalPrice), true],
    ['Less down payment / deposit', m.downPayment ? `(${usd(m.downPayment)})` : usd(0)],
    ['BALANCE DUE', usd(m.balanceDue), true],
  );
  const tx = W / 2 + 10;
  const top = sh.y;
  sh.ensure(rows.length * 15 + 10);
  rows.forEach(([a, b, strong], i) => {
    const y = top + i * 15;
    if (strong) sh.rect(tx, y - 2, W - M - tx, 15, { fill: LIGHT, border: 0 });
    sh.text(tx + 4, y + 1, a, 9, !!strong);
    sh.right(W - M - 4, y + 1, b, 9, !!strong);
    sh.hline(tx, W - M, y + 13, 0.3);
  });
  // left: payment + lien
  let ly = top;
  sh.text(M, ly, 'Payment method', 7, false, GREY);
  ly += 10;
  sh.text(M, ly, PAY[d.paymentMethod], 10, true);
  ly += 18;
  if (d.paymentMethod !== 'CASH') {
    sh.text(M, ly, 'Lienholder', 7, false, GREY);
    ly += 10;
    for (const l of sh.lines(d.lienholder.name || '________________________', W / 2 - M - 20, 10, true)) {
      sh.text(M, ly, l, 10, true);
      ly += 12;
    }
    for (const l of sh.lines(d.lienholder.address, W / 2 - M - 20, 9)) {
      sh.text(M, ly, l, 9);
      ly += 11;
    }
    if (d.lienholder.date) {
      sh.text(M, ly, `Lien date: ${mdy(d.lienholder.date)}`, 9);
      ly += 11;
    }
  }
  sh.y = Math.max(ly, top + rows.length * 15) + 10;

  // disclosure
  sh.band('WARRANTY DISCLOSURE');
  if (d.warranty.type === 'AS_IS') {
    sh.para(
      'AS IS - NO DEALER WARRANTY. The buyer purchases the vehicle described above "AS IS", with all faults. The dealer makes no warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose, and assumes no responsibility for any repairs after the sale, except as required by law. The information on the FTC Buyers Guide displayed on this vehicle is part of this contract and overrides any contrary provision in this contract.',
      { size: 8.5 },
    );
  } else {
    const w = d.warranty;
    sh.para(
      `DEALER WARRANTY (${w.kind}). The dealer provides a ${w.kind.toLowerCase()} warranty on the following systems: ${w.systemsCovered || 'see the Buyers Guide'}; duration: ${w.duration || 'see the Buyers Guide'}${w.kind === 'LIMITED' && (w.laborPct || w.partsPct) ? `; the dealer pays ${w.laborPct || '__'}% of labor and ${w.partsPct || '__'}% of parts for covered systems` : ''}. All other terms are on the written warranty and the FTC Buyers Guide displayed on this vehicle, which is part of this contract and overrides any contrary provision in this contract.`,
      { size: 8.5 },
    );
  }
  sh.para(
    'The seller certifies that it has the right to sell the vehicle and that the vehicle is free of all liens and encumbrances except as stated above. The buyer acknowledges receipt of a copy of this Bill of Sale, the Odometer Disclosure Statement and the Buyers Guide, and agrees that the vehicle has been inspected and accepted.',
    { size: 8.5, gap: 6 },
  );
  if (d.notes) sh.para(`Notes: ${d.notes}`, { size: 8.5, gap: 6 });

  // signatures
  sh.ensure(90);
  sh.y += 26;
  const half = (W - 2 * M - 30) / 2;
  sh.sign(M, sh.y, half * 0.7, 'Buyer signature');
  sh.sign(M + half * 0.75, sh.y, half * 0.25, 'Date');
  sh.sign(M + half + 30, sh.y, half * 0.7, 'Co-buyer signature');
  sh.sign(M + half + 30 + half * 0.75, sh.y, half * 0.25, 'Date');
  sh.y += 38;
  sh.sign(M, sh.y, half * 0.7, `Authorized dealer representative - ${dl.legalName || dl.name}`);
  sh.sign(M + half * 0.75, sh.y, half * 0.25, 'Date');
  sh.sign(M + half + 30, sh.y, half, 'Printed name and title');
  sh.y += 20;
}
