/**
 * Deal totals. Virginia motor vehicle sales and use tax (SUT): 4.15 % of the gross sales price, at least $75,
 * collected at titling. A trade-in does NOT lower the taxed amount in Virginia; the dealer processing fee is part
 * of the gross sales price. Other states: rate × (price + doc fee − trade-in allowance), no minimum.
 * The dealer can always type the tax by hand (salesTaxManual).
 */
export const VA_SUT_RATE = 4.15;
export const VA_SUT_MIN = 75;

const r2 = (x: number) => Math.round((Number.isFinite(x) ? x : 0) * 100) / 100;

export interface MoneyIn {
  salePrice: number;
  tradeInAllowance: number;
  tradeInPayoff: number;
  docFee: number;
  titleRegFee: number;
  otherFees: number;
  salesTaxRate: number;
  salesTaxAmount: number;
  salesTaxManual: boolean;
  downPayment: number;
  stateCode: string;
}

export function salesTax(m: Pick<MoneyIn, 'salePrice' | 'docFee' | 'tradeInAllowance' | 'salesTaxRate' | 'stateCode'>): number {
  const rate = Math.max(0, m.salesTaxRate || 0) / 100;
  if (!m.salePrice || m.salePrice <= 0 || rate <= 0) return 0;
  if ((m.stateCode || 'VA').toUpperCase() === 'VA') return r2(Math.max((m.salePrice + Math.max(0, m.docFee)) * rate, VA_SUT_MIN));
  return r2(Math.max(0, m.salePrice + Math.max(0, m.docFee) - Math.max(0, m.tradeInAllowance)) * rate);
}

export function computeTotals(m: MoneyIn) {
  const tax = m.salesTaxManual ? r2(Math.max(0, m.salesTaxAmount)) : salesTax(m);
  const total = r2(
    m.salePrice + m.docFee + m.titleRegFee + m.otherFees + tax - m.tradeInAllowance + m.tradeInPayoff,
  );
  return { salesTaxAmount: tax, totalPrice: total, balanceDue: r2(total - m.downPayment) };
}
