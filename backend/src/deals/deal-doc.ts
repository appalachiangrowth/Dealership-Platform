/**
 * Everything the 4 deal forms print, flattened from a Deal row + the dealership's Business details.
 * Used by the PDF builders (pdf/*.ts) and by the state-form field mapping (deal-keys.ts).
 */

export interface DealerInfo {
  name: string;
  legalName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  licenseNumber: string;
}

export interface VehicleInfo {
  year: string;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  color: string;
  vin: string;
  stockNumber: string;
  fuelType: string;
}

export interface TradeIn {
  year: string;
  make: string;
  model: string;
  vin: string;
  mileage: string;
}

export interface DealDoc {
  dealNumber: string;
  status: string;
  /** YYYY-MM-DD */
  saleDate: string;
  dealer: DealerInfo;
  vehicle: VehicleInfo;
  buyer: {
    fullName: string;
    firstName: string;
    middleName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    county: string;
    dob: string;
    licenseNumber: string;
    licenseState: string;
    licenseExpiry: string;
  };
  coBuyer: { fullName: string; address: string; phone: string; licenseNumber: string };
  money: {
    salePrice: number;
    tradeInAllowance: number;
    tradeInPayoff: number;
    docFee: number;
    titleRegFee: number;
    otherFees: number;
    otherFeesLabel: string;
    salesTaxRate: number;
    salesTaxAmount: number;
    downPayment: number;
    totalPrice: number;
    balanceDue: number;
  };
  tradeIn: TradeIn;
  paymentMethod: 'CASH' | 'FINANCE' | 'OUTSIDE_LIEN';
  lienholder: { name: string; address: string; date: string };
  odometer: { reading: number | null; status: 'ACTUAL' | 'EXCEEDS_LIMITS' | 'NOT_ACTUAL' };
  warranty: {
    type: 'AS_IS' | 'WARRANTY';
    kind: 'FULL' | 'LIMITED';
    duration: string;
    systemsCovered: string;
    laborPct: string;
    partsPct: string;
    serviceContract: boolean;
  };
  stateCode: string;
  titlePurpose: 'TITLE_AND_REGISTRATION' | 'TITLE_ONLY' | 'TRANSFER_PLATE';
  plateNumber: string;
  gvwr: string;
  notes: string;
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const ymd = (d: unknown) => {
  if (!d) return '';
  const t = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
};

/** Deal row (Prisma) + TenantSettings row → DealDoc */
export function toDealDoc(deal: Record<string, any>, settings: Record<string, any> | null): DealDoc {
  const st = settings || {};
  const snap = (deal.vehicleSnapshot && typeof deal.vehicleSnapshot === 'object' ? deal.vehicleSnapshot : {}) as Record<string, unknown>;
  const ti = (deal.tradeInVehicle && typeof deal.tradeInVehicle === 'object' ? deal.tradeInVehicle : {}) as Record<string, unknown>;
  const pm = ['CASH', 'FINANCE', 'OUTSIDE_LIEN'].includes(deal.paymentMethod) ? deal.paymentMethod : 'CASH';
  const os = ['ACTUAL', 'EXCEEDS_LIMITS', 'NOT_ACTUAL'].includes(deal.odometerStatus) ? deal.odometerStatus : 'ACTUAL';
  const tp = ['TITLE_AND_REGISTRATION', 'TITLE_ONLY', 'TRANSFER_PLATE'].includes(deal.titlePurpose) ? deal.titlePurpose : 'TITLE_AND_REGISTRATION';
  return {
    dealNumber: s(deal.dealNumber),
    status: s(deal.status),
    saleDate: ymd(deal.saleDate),
    dealer: {
      name: s(st.name),
      legalName: s(st.legalName),
      street: s(st.street),
      city: s(st.city),
      state: s(st.state),
      zip: s(st.zip),
      phone: s(st.phone),
      email: s(st.email),
      licenseNumber: s(st.dealerLicenseNumber),
    },
    vehicle: {
      year: s(snap.year),
      make: s(snap.make),
      model: s(snap.model),
      trim: s(snap.trim),
      bodyStyle: s(snap.bodyStyle),
      color: s(snap.exteriorColor ?? snap.color),
      vin: s(snap.vin),
      stockNumber: s(snap.stockNumber),
      fuelType: s(snap.fuelType),
    },
    buyer: {
      fullName: s(deal.buyerFullName) || [deal.buyerFirstName, deal.buyerMiddleName, deal.buyerLastName].filter(Boolean).join(' '),
      firstName: s(deal.buyerFirstName),
      middleName: s(deal.buyerMiddleName),
      lastName: s(deal.buyerLastName),
      email: s(deal.buyerEmail),
      phone: s(deal.buyerPhone),
      address: s(deal.buyerAddress),
      city: s(deal.buyerCity),
      state: s(deal.buyerState),
      zip: s(deal.buyerZip),
      county: s(deal.buyerCounty),
      dob: s(deal.buyerDob),
      licenseNumber: s(deal.buyerLicenseNumber),
      licenseState: s(deal.buyerLicenseState),
      licenseExpiry: s(deal.buyerLicenseExpiry),
    },
    coBuyer: {
      fullName: s(deal.coBuyerFullName),
      address: s(deal.coBuyerAddress),
      phone: s(deal.coBuyerPhone),
      licenseNumber: s(deal.coBuyerLicenseNumber),
    },
    money: {
      salePrice: n(deal.salePrice),
      tradeInAllowance: n(deal.tradeInAllowance),
      tradeInPayoff: n(deal.tradeInPayoff),
      docFee: n(deal.docFee),
      titleRegFee: n(deal.titleRegFee),
      otherFees: n(deal.otherFees),
      otherFeesLabel: s(deal.otherFeesLabel),
      salesTaxRate: n(deal.salesTaxRate),
      salesTaxAmount: n(deal.salesTaxAmount),
      downPayment: n(deal.downPayment),
      totalPrice: n(deal.totalPrice),
      balanceDue: n(deal.balanceDue),
    },
    tradeIn: { year: s(ti.year), make: s(ti.make), model: s(ti.model), vin: s(ti.vin), mileage: s(ti.mileage) },
    paymentMethod: pm,
    lienholder: { name: s(deal.lienholderName), address: s(deal.lienholderAddress), date: s(deal.lienDate) },
    odometer: { reading: deal.odometerReading === null || deal.odometerReading === undefined ? null : n(deal.odometerReading), status: os },
    warranty: {
      type: deal.warrantyType === 'WARRANTY' ? 'WARRANTY' : 'AS_IS',
      kind: deal.warrantyKind === 'FULL' ? 'FULL' : 'LIMITED',
      duration: s(deal.warrantyDuration),
      systemsCovered: s(deal.warrantySystemsCovered),
      laborPct: s(deal.warrantyLaborPct),
      partsPct: s(deal.warrantyPartsPct),
      serviceContract: !!deal.serviceContract,
    },
    stateCode: s(deal.stateCode) || 'VA',
    titlePurpose: tp,
    plateNumber: s(deal.plateNumber),
    gvwr: s(deal.gvwr),
    notes: s(deal.notes),
  };
}

export const usd = (x: number) =>
  '$' + (Math.round(x * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-11-18" → "11/18/2026" */
export const mdy = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : d || '';
};

export const vehicleTitle = (v: VehicleInfo) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
export const dealerAddress = (d: DealerInfo) => [d.street, [d.city, [d.state, d.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
export const buyerAddress = (b: DealDoc['buyer']) => [b.address, [b.city, [b.state, b.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
