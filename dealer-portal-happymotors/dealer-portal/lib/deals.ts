'use client';

import { API_URL, ApiError, auth } from './api';

/** Deals / Bill of Sale: shared types, the live totals and PDF downloads. */

export type PaymentMethod = 'CASH' | 'FINANCE' | 'OUTSIDE_LIEN';
export type OdometerStatus = 'ACTUAL' | 'EXCEEDS_LIMITS' | 'NOT_ACTUAL';

export interface Deal {
  id?: string;
  dealNumber?: string;
  status?: 'DRAFT' | 'COMPLETED';
  vehicleId?: string | null;
  vehicleSnapshot?: Record<string, any>;
  saleDate: string;
  buyerFullName: string;
  buyerFirstName: string;
  buyerMiddleName: string;
  buyerLastName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerAddress: string;
  buyerCity: string;
  buyerState: string;
  buyerZip: string;
  buyerCounty: string;
  buyerDob: string;
  buyerLicenseNumber: string;
  buyerLicenseState: string;
  buyerLicenseExpiry: string;
  coBuyerFullName: string;
  coBuyerAddress: string;
  coBuyerPhone: string;
  coBuyerLicenseNumber: string;
  salePrice: number | string;
  tradeInAllowance: number | string;
  tradeInPayoff: number | string;
  tradeInVehicle: { year?: string; make?: string; model?: string; vin?: string; mileage?: string };
  docFee: number | string;
  titleRegFee: number | string;
  otherFees: number | string;
  otherFeesLabel: string;
  salesTaxRate: number | string;
  salesTaxAmount: number | string;
  salesTaxManual: boolean;
  downPayment: number | string;
  totalPrice?: number;
  balanceDue?: number;
  paymentMethod: PaymentMethod;
  lienholderName: string;
  lienholderAddress: string;
  lienDate: string;
  odometerReading: number | string | null;
  odometerStatus: OdometerStatus;
  warrantyType: 'AS_IS' | 'WARRANTY';
  warrantyKind: 'FULL' | 'LIMITED';
  warrantyDuration: string;
  warrantySystemsCovered: string;
  warrantyLaborPct: string;
  warrantyPartsPct: string;
  serviceContract: boolean;
  stateCode: string;
  titlePurpose: 'TITLE_AND_REGISTRATION' | 'TITLE_ONLY' | 'TRANSFER_PLATE';
  plateNumber: string;
  gvwr: string;
  notes: string;
  createdAt?: string;
}

export const EMPTY_DEAL: Deal = {
  saleDate: new Date().toISOString().slice(0, 10),
  buyerFullName: '', buyerFirstName: '', buyerMiddleName: '', buyerLastName: '', buyerEmail: '', buyerPhone: '',
  buyerAddress: '', buyerCity: '', buyerState: 'VA', buyerZip: '', buyerCounty: '', buyerDob: '',
  buyerLicenseNumber: '', buyerLicenseState: 'VA', buyerLicenseExpiry: '',
  coBuyerFullName: '', coBuyerAddress: '', coBuyerPhone: '', coBuyerLicenseNumber: '',
  salePrice: 0, tradeInAllowance: 0, tradeInPayoff: 0, tradeInVehicle: {}, docFee: 0, titleRegFee: 0, otherFees: 0, otherFeesLabel: '',
  salesTaxRate: 4.15, salesTaxAmount: 0, salesTaxManual: false, downPayment: 0,
  paymentMethod: 'CASH', lienholderName: '', lienholderAddress: '', lienDate: '',
  odometerReading: null, odometerStatus: 'ACTUAL',
  warrantyType: 'AS_IS', warrantyKind: 'LIMITED', warrantyDuration: '', warrantySystemsCovered: '', warrantyLaborPct: '', warrantyPartsPct: '', serviceContract: false,
  stateCode: 'VA', titlePurpose: 'TITLE_AND_REGISTRATION', plateNumber: '', gvwr: '', notes: '',
};

export const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/** same rules as the backend (deal-math.ts): VA 4.15 % of price + doc fee, at least $75, trade-in not deducted */
export function totals(d: Deal) {
  const price = num(d.salePrice);
  const doc = num(d.docFee);
  const rate = num(d.salesTaxRate) / 100;
  let tax = 0;
  if (d.salesTaxManual) tax = r2(Math.max(0, num(d.salesTaxAmount)));
  else if (price > 0 && rate > 0) {
    tax = (d.stateCode || 'VA').toUpperCase() === 'VA' ? r2(Math.max((price + doc) * rate, 75)) : r2(Math.max(0, price + doc - num(d.tradeInAllowance)) * rate);
  }
  const total = r2(price + doc + num(d.titleRegFee) + num(d.otherFees) + tax - num(d.tradeInAllowance) + num(d.tradeInPayoff));
  return { tax, total, net: r2(price - num(d.tradeInAllowance) + num(d.tradeInPayoff)), balance: r2(total - num(d.downPayment)) };
}

export const usd = (x: number) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const FORMS = [
  { kind: 'bill-of-sale', title: 'Bill of Sale' },
  { kind: 'odometer', title: 'Odometer Disclosure' },
  { kind: 'buyers-guide', title: 'Buyers Guide' },
  { kind: 'vsa17a', title: 'VA VSA 17A' },
] as const;

/** GET a protected file (PDF) with the login token → Blob */
export async function fetchBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = auth.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenant = auth.supportTenant();
  if (tenant && path.startsWith('/dealer/')) headers['X-Tenant-Id'] = tenant;
  const res = await fetch(API_URL + path, { headers, cache: 'no-store' });
  if (!res.ok) {
    let msg = res.statusText || 'Download failed';
    try {
      const j = await res.json();
      msg = (Array.isArray(j.message) ? j.message.join(', ') : j.message) || msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg, null);
  }
  return res.blob();
}

export async function downloadPdf(path: string, filename: string) {
  const blob = await fetchBlob(path);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** opens the PDF in a new tab (to print) */
export async function openPdf(path: string) {
  const w = window.open('', '_blank');
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  if (w) w.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const US_STATES =
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
