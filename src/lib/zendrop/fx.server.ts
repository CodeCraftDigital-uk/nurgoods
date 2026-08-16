/**
 * Currency conversion for supplier pricing.
 *
 * Supplier costs are quoted in USD while the store sells in GBP, so landed
 * cost has to be converted before any margin maths runs. Rates come from the
 * European Central Bank daily reference feed. If a rate cannot be fetched the
 * conversion fails loudly rather than guessing, so pricing stays honest.
 */

interface CachedRate {
  rate: number;
  fetchedAt: number;
  asOf: string;
}

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, CachedRate>();

export interface FxQuote {
  from: string;
  to: string;
  rate: number;
  asOf: string;
  source: string;
}

export async function getFxRate(from: string, to: string): Promise<FxQuote> {
  const base = from.toUpperCase();
  const quote = to.toUpperCase();
  const source = "European Central Bank daily reference rates";
  if (base === quote) {
    return { from: base, to: quote, rate: 1, asOf: new Date().toISOString().slice(0, 10), source };
  }

  const key = `${base}:${quote}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return { from: base, to: quote, rate: cached.rate, asOf: cached.asOf, source };
  }

  const response = await fetch(
    `https://api.frankfurter.app/latest?from=${base}&to=${quote}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`The ${base} to ${quote} exchange rate could not be retrieved`);
  }
  const payload = (await response.json()) as { rates?: Record<string, number>; date?: string };
  const rate = payload?.rates?.[quote];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`The ${base} to ${quote} exchange rate was not returned`);
  }
  const asOf = payload.date ?? new Date().toISOString().slice(0, 10);
  cache.set(key, { rate, fetchedAt: Date.now(), asOf });
  return { from: base, to: quote, rate, asOf, source };
}

export function convertAmount(value: number | null, rate: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * rate * 100) / 100;
}
