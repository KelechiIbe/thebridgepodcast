// Calculators used by the episode widgets. Figures follow the Nigeria Tax Act 2025.

export const PIT_BANDS: [number, number][] = [
  [800_000, 0],
  [2_200_000, 0.15],
  [9_000_000, 0.18],
  [13_000_000, 0.21],
  [25_000_000, 0.23],
  [Infinity, 0.25],
];

export function personalIncomeTax(taxable: number): number {
  let rest = Math.max(0, taxable);
  let tax = 0;
  for (const [width, rate] of PIT_BANDS) {
    const part = Math.min(rest, width);
    tax += part * rate;
    rest -= part;
    if (rest <= 0) break;
  }
  return tax;
}

export const SMALL_COMPANY_TURNOVER = 100_000_000;

export function companyRouteTax(profit: number, turnover: number): { total: number; note: string; cit: number; levy: number; wht: number } {
  const p = Math.max(0, profit);
  if (turnover <= SMALL_COMPANY_TURNOVER) {
    return { total: 0.1 * p, cit: 0, levy: 0, wht: 0.1 * p, note: "Small company: 0% CIT, 10% WHT on the dividend" };
  }
  const cit = 0.3 * p;
  const levy = 0.04 * p;
  const wht = 0.1 * (p - cit - levy);
  return { total: cit + levy + wht, cit, levy, wht, note: "30% CIT + 4% development levy + 10% WHT on what's left" };
}

export function vatOnCommission(price: number, commissionPct: number) {
  const full = 0.075 * Math.max(0, price);
  const fee = full * Math.min(100, Math.max(0, commissionPct)) / 100;
  return { full, fee, saving: full - fee };
}

export const naira = (v: number) => "₦" + Math.round(v).toLocaleString("en-NG");

export function nairaShort(v: number): string {
  if (Math.abs(v) >= 1e9) return "₦" + trim(v / 1e9) + "bn";
  if (Math.abs(v) >= 1e6) return "₦" + trim(v / 1e6) + "m";
  return naira(v);
}

const trim = (x: number) => x.toFixed(2).replace(/\.?0+$/, "");
