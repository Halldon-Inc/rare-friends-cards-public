export const usd = (v: number, d = 2) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const num = (v: number, d = 0) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
export const pct = (v: number, d = 2) => `${num(v, d)}%`;
export const compact = (v: number) =>
  v >= 1e9 ? `${num(v / 1e9, 1)}B` : v >= 1e6 ? `${num(v / 1e6, 1)}M` : v >= 1e3 ? `${num(v / 1e3, 1)}K` : num(v, 0);
export const eth = (v: number) => (v >= 100 ? num(v, 1) : v >= 1 ? num(v, 3) : num(v, 5));
/** APR the way the site prints it: two decimals, grouped. */
export const apyPct = (v: number) => pct(v, 2);
/**
 * Share of active weight as a percentage. Two decimals normally; below 0.01% two significant digits, so an earning
 * Gen-6 Friend (weight 1.1 of about 855M) reads 0.00000013% rather than 0%.
 */
export const sharePct = (v: number) =>
  v === 0 ? "0%" : v >= 0.01 ? pct(v, 2) : `${v.toLocaleString("en-US", { maximumSignificantDigits: 2 })}%`;
