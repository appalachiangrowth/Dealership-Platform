/**
 * Values a state's official fillable PDF (e.g. Virginia DMV VSA 17A) can be filled with, and the automatic
 * matching of the PDF's own field names to them. Field names differ in every revision of a form, so the
 * match is a best guess: Platform Admin › Deal forms (or the dealer's own upload) lets the mapping be corrected.
 */
import { type DealDoc, mdy, usd, dealerAddress } from './deal-doc.js';

export interface DealKey {
  key: string;
  label: string;
  group: string;
  /** checkbox-style values (true / false) */
  bool?: boolean;
  /** words that appear in PDF field names for this value (compared without spaces / punctuation) */
  hints: string[];
  get: (d: DealDoc) => string | boolean;
}

const money = (x: number) => (x ? usd(x).replace('$', '') : '');

export const DEAL_KEYS: DealKey[] = [
  // owner
  { key: 'owner.lastName', label: 'Owner last name', group: 'Owner', hints: ['ownerlastname', 'lastname', 'last'], get: (d) => d.buyer.lastName || d.buyer.fullName.split(' ').slice(-1)[0] || '' },
  { key: 'owner.firstName', label: 'Owner first name', group: 'Owner', hints: ['ownerfirstname', 'firstname', 'first'], get: (d) => d.buyer.firstName || d.buyer.fullName.split(' ')[0] || '' },
  { key: 'owner.middleName', label: 'Owner middle name', group: 'Owner', hints: ['ownermiddlename', 'middlename', 'middle', 'mi'], get: (d) => d.buyer.middleName },
  { key: 'owner.fullName', label: 'Owner full name', group: 'Owner', hints: ['ownername', 'ownersname', 'applicantname', 'purchasername', 'buyername', 'name'], get: (d) => d.buyer.fullName },
  { key: 'owner.dob', label: 'Owner date of birth', group: 'Owner', hints: ['dateofbirth', 'birthdate', 'dob'], get: (d) => mdy(d.buyer.dob) },
  { key: 'owner.dlNumber', label: "Owner driver's licence / customer number", group: 'Owner', hints: ['customernumber', 'dmvcustomer', 'driverslicense', 'licensenumber', 'dlnumber', 'license', 'customerno', 'dl'], get: (d) => d.buyer.licenseNumber },
  { key: 'owner.dlState', label: 'Licence state', group: 'Owner', hints: ['licensestate', 'dlstate', 'issuingstate'], get: (d) => d.buyer.licenseState },
  { key: 'owner.phone', label: 'Owner phone', group: 'Owner', hints: ['telephone', 'phonenumber', 'phone'], get: (d) => d.buyer.phone },
  { key: 'owner.email', label: 'Owner email', group: 'Owner', hints: ['emailaddress', 'email'], get: (d) => d.buyer.email },
  { key: 'owner.street', label: 'Owner street address', group: 'Owner', hints: ['residenceaddress', 'streetaddress', 'mailingaddress', 'address', 'street'], get: (d) => d.buyer.address },
  { key: 'owner.city', label: 'Owner city', group: 'Owner', hints: ['city', 'town'], get: (d) => d.buyer.city },
  { key: 'owner.state', label: 'Owner state', group: 'Owner', hints: ['state', 'st'], get: (d) => d.buyer.state },
  { key: 'owner.zip', label: 'Owner ZIP code', group: 'Owner', hints: ['zipcode', 'zip'], get: (d) => d.buyer.zip },
  { key: 'owner.county', label: 'County / city of residence', group: 'Owner', hints: ['countyorcity', 'jurisdiction', 'locality', 'county'], get: (d) => d.buyer.county },
  // co-owner
  { key: 'coOwner.fullName', label: 'Co-owner name', group: 'Co-owner', hints: ['coownername', 'coowner', 'cobuyer', 'secondowner'], get: (d) => d.coBuyer.fullName },
  { key: 'coOwner.dlNumber', label: 'Co-owner licence number', group: 'Co-owner', hints: ['coownercustomer', 'coownerlicense', 'coownerdl'], get: (d) => d.coBuyer.licenseNumber },
  // vehicle
  { key: 'vehicle.vin', label: 'VIN', group: 'Vehicle', hints: ['vehicleidentificationnumber', 'vin'], get: (d) => d.vehicle.vin },
  { key: 'vehicle.year', label: 'Year', group: 'Vehicle', hints: ['vehicleyear', 'modelyear', 'year', 'yr'], get: (d) => d.vehicle.year },
  { key: 'vehicle.make', label: 'Make', group: 'Vehicle', hints: ['vehiclemake', 'make'], get: (d) => d.vehicle.make },
  { key: 'vehicle.model', label: 'Model', group: 'Vehicle', hints: ['vehiclemodel', 'model'], get: (d) => d.vehicle.model },
  { key: 'vehicle.body', label: 'Body type', group: 'Vehicle', hints: ['bodytype', 'bodystyle', 'body'], get: (d) => d.vehicle.bodyStyle },
  { key: 'vehicle.color', label: 'Color', group: 'Vehicle', hints: ['vehiclecolor', 'color', 'colour'], get: (d) => d.vehicle.color },
  { key: 'vehicle.fuel', label: 'Fuel type', group: 'Vehicle', hints: ['fueltype', 'fuel'], get: (d) => d.vehicle.fuelType },
  { key: 'vehicle.gvwr', label: 'GVWR / weight', group: 'Vehicle', hints: ['gvwr', 'grossweight', 'weight'], get: (d) => d.gvwr },
  { key: 'vehicle.odometer', label: 'Odometer reading', group: 'Vehicle', hints: ['odometerreading', 'mileage', 'odometer', 'miles'], get: (d) => (d.odometer.reading === null ? '' : String(d.odometer.reading)) },
  { key: 'odo.actual', label: 'Odometer: actual mileage (checkbox)', group: 'Vehicle', bool: true, hints: ['actualmileage', 'actual'], get: (d) => d.odometer.status === 'ACTUAL' },
  { key: 'odo.exceeds', label: 'Odometer: exceeds mechanical limits (checkbox)', group: 'Vehicle', bool: true, hints: ['exceedsmechanicallimits', 'mechanicallimits', 'exceeds'], get: (d) => d.odometer.status === 'EXCEEDS_LIMITS' },
  { key: 'odo.notActual', label: 'Odometer: NOT actual mileage (checkbox)', group: 'Vehicle', bool: true, hints: ['notactualmileage', 'notactual', 'discrepancy'], get: (d) => d.odometer.status === 'NOT_ACTUAL' },
  // sale
  { key: 'sale.date', label: 'Date of sale', group: 'Sale', hints: ['dateofsale', 'purchasedate', 'datepurchased', 'saledate', 'date'], get: (d) => mdy(d.saleDate) },
  { key: 'sale.price', label: 'Sale price', group: 'Sale', hints: ['grosssalesprice', 'salesprice', 'saleprice', 'purchaseprice', 'price'], get: (d) => money(d.money.salePrice) },
  { key: 'sale.tradeIn', label: 'Trade-in allowance', group: 'Sale', hints: ['tradeinallowance', 'tradein', 'trade'], get: (d) => money(d.money.tradeInAllowance) },
  { key: 'sale.tax', label: 'Sales and use tax', group: 'Sale', hints: ['salesandusetax', 'salesusetax', 'sut', 'tax'], get: (d) => money(d.money.salesTaxAmount) },
  { key: 'sale.total', label: 'Total price', group: 'Sale', hints: ['totalprice', 'totaldue', 'total'], get: (d) => money(d.money.totalPrice) },
  { key: 'deal.number', label: 'Deal number', group: 'Sale', hints: ['dealnumber', 'dealno', 'stocknumber'], get: (d) => d.dealNumber },
  // lien
  { key: 'lien.name', label: 'First lienholder name', group: 'Lien', hints: ['lienholdername', 'firstlienholder', 'lienholder', 'lienname'], get: (d) => (d.paymentMethod === 'CASH' ? '' : d.lienholder.name) },
  { key: 'lien.address', label: 'Lienholder address', group: 'Lien', hints: ['lienholderaddress', 'lienaddress'], get: (d) => (d.paymentMethod === 'CASH' ? '' : d.lienholder.address) },
  { key: 'lien.date', label: 'Date of lien', group: 'Lien', hints: ['dateoflien', 'liendate'], get: (d) => (d.paymentMethod === 'CASH' ? '' : mdy(d.lienholder.date)) },
  { key: 'lien.none', label: 'No lien (checkbox)', group: 'Lien', bool: true, hints: ['nolien', 'nolienholder', 'none'], get: (d) => d.paymentMethod === 'CASH' || !d.lienholder.name },
  // title purpose
  { key: 'title.titleAndReg', label: 'Title and registration (checkbox)', group: 'Title', bool: true, hints: ['titleandregistration', 'titleandreg', 'titleregister'], get: (d) => d.titlePurpose === 'TITLE_AND_REGISTRATION' },
  { key: 'title.titleOnly', label: 'Title only (checkbox)', group: 'Title', bool: true, hints: ['titleonly'], get: (d) => d.titlePurpose === 'TITLE_ONLY' },
  { key: 'title.transferPlate', label: 'Transfer plates (checkbox)', group: 'Title', bool: true, hints: ['transferplates', 'transferplate', 'platetransfer'], get: (d) => d.titlePurpose === 'TRANSFER_PLATE' },
  { key: 'title.plateNumber', label: 'Plate number', group: 'Title', hints: ['platenumber', 'licenseplate', 'plateno', 'plate'], get: (d) => d.plateNumber },
  // dealer
  { key: 'dealer.name', label: 'Dealer name', group: 'Dealer', hints: ['dealername', 'dealershipname', 'sellername', 'dealer'], get: (d) => d.dealer.legalName || d.dealer.name },
  { key: 'dealer.license', label: 'Dealer licence / certificate number', group: 'Dealer', hints: ['dealercertificate', 'dealerlicense', 'dealernumber', 'certificatenumber'], get: (d) => d.dealer.licenseNumber },
  { key: 'dealer.address', label: 'Dealer address', group: 'Dealer', hints: ['dealeraddress', 'selleraddress'], get: (d) => dealerAddress(d.dealer) },
  { key: 'dealer.phone', label: 'Dealer phone', group: 'Dealer', hints: ['dealerphone', 'sellerphone'], get: (d) => d.dealer.phone },
];

export const DEAL_KEY_MAP = new Map(DEAL_KEYS.map((k) => [k.key, k]));

const norm = (x: string) => x.toLowerCase().replace(/\[\d+\]/g, '').replace(/[^a-z0-9]/g, '');

/** PDF field names → best-guess deal keys (fields with no confident match are left out). */
export function autoMap(fields: { name: string; type: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  // longer, more specific field names first so "Owner Last Name" wins "lastname" before a bare "Name"
  const sorted = [...fields].sort((a, b) => norm(b.name).length - norm(a.name).length);
  for (const f of sorted) {
    const fn = norm(f.name.split('.').slice(-2).join(''));
    if (!fn) continue;
    const isBox = /check|radio|button/i.test(f.type);
    const coOwner = /co.?owner|co.?buyer|co.?applicant|second/i.test(f.name);
    let best: { key: string; score: number } | null = null;
    for (const k of DEAL_KEYS) {
      if (!!k.bool !== isBox) continue;
      if (coOwner && k.key.startsWith('owner.')) continue;
      if (!coOwner && k.key.startsWith('coOwner.')) continue;
      for (const h of k.hints) {
        if (h.length < 3 && fn !== h) continue;
        const hit = fn === h ? 100 + h.length : fn.includes(h) ? h.length * 2 - Math.max(0, fn.length - h.length) * 0.2 : 0;
        if (hit > 0 && (!best || hit > best.score)) best = { key: k.key, score: hit };
      }
    }
    // a value already used by a better field is only re-used for checkboxes and very strong matches
    if (best && best.score >= 6 && (!used.has(best.key) || best.score >= 100)) {
      out[f.name] = best.key;
      used.add(best.key);
    }
  }
  return out;
}

export function keyValue(key: string, d: DealDoc): string | boolean {
  const k = DEAL_KEY_MAP.get(key);
  return k ? k.get(d) : '';
}
