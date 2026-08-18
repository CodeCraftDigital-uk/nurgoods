/**
 * Per market supplier shipping evidence.
 *
 * A product is only sellable into a market when the supplier has given a
 * destination specific shipping quote for that market, in a known currency,
 * for a named service, recently enough to still be true. This module records
 * that evidence one row per product and market, and reads it back so the
 * import pipeline and the pricing audit can both fail closed on the same
 * facts.
 *
 * Reading a shipping quote is a read only supplier operation. Nothing here
 * creates, confirms, pays for or modifies a supplier order.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  evaluateMarketEligibility,
  MARKETS,
  resolveSupportedMarkets,
  type MarketCode,
  type MarketEligibilityResult,
  type MarketEvidence,
} from "./markets";

const TABLE = "product_market_eligibility";

export interface RecordedMarketQuote {
  market: MarketCode;
  amount: number | null;
  currency: string | null;
  service: string | null;
  quotedAt: string | null;
}

function client() {
  return supabaseAdmin as unknown as {
    from: (table: string) => any;
  };
}

/** Reads back whatever evidence has already been captured for a product. */
export async function loadMarketEvidence(supplierProductId: string): Promise<MarketEvidence[]> {
  const { data } = await client()
    .from(TABLE)
    .select("market, shipping_amount, shipping_currency, shipping_service, quoted_at")
    .eq("supplier_product_id", supplierProductId);
  return ((data ?? []) as any[]).map((row) => ({
    market: String(row.market ?? ""),
    amount: row.shipping_amount === null || row.shipping_amount === undefined
      ? null
      : Number(row.shipping_amount),
    currency: row.shipping_currency ?? null,
    destination: String(row.market ?? ""),
    service: row.shipping_service ?? null,
    quotedAt: row.quoted_at ?? null,
  }));
}

/**
 * Persists the evidence and the resulting eligibility decision for every
 * supported market. Rows are upserted on (supplier product, market) so a
 * repeated run never duplicates and never leaves a stale eligible flag behind.
 */
export async function recordMarketEligibility(input: {
  supplierProductId: string;
  shopifyProductId?: string | null;
  quotes: RecordedMarketQuote[];
  supported: MarketCode[];
  maxAgeDays: number;
  now?: Date;
}): Promise<MarketEligibilityResult> {
  const evidence: MarketEvidence[] = input.quotes.map((quote) => ({
    market: quote.market,
    amount: quote.amount,
    currency: quote.currency,
    destination: quote.market,
    service: quote.service,
    quotedAt: quote.quotedAt,
  }));

  const result = evaluateMarketEligibility({
    supported: input.supported,
    evidence,
    maxAgeDays: input.maxAgeDays,
    ...(input.now ? { now: input.now } : {}),
  });

  const rows = result.markets.map((decision) => {
    const quote = input.quotes.find((entry) => entry.market === decision.market);
    return {
      supplier_product_id: input.supplierProductId,
      shopify_product_id: input.shopifyProductId ?? null,
      market: decision.market,
      shipping_amount: quote?.amount ?? null,
      shipping_currency: quote?.currency ?? null,
      shipping_service: quote?.service ?? null,
      quoted_at: quote?.quotedAt ?? null,
      status: decision.status,
      eligible: decision.eligible,
      reason: decision.reason,
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    await client().from(TABLE).upsert(rows as never, {
      onConflict: "supplier_product_id,market",
    });
  }

  return result;
}

/**
 * Quotes every supported market for one supplier product and stores the
 * outcome. A market whose quote cannot be read is recorded as unavailable
 * rather than skipped, so the absence of evidence is itself evidence.
 */
export async function quoteAndRecordMarkets(input: {
  supplierProductId: string;
  shopifyProductId?: string | null;
  supported: MarketCode[];
  maxAgeDays: number;
  quote: (productId: string, market: string) => Promise<{ cost: number | null; service: string | null }>;
  supplierCurrency?: string;
}): Promise<MarketEligibilityResult> {
  const now = new Date().toISOString();
  const quotes: RecordedMarketQuote[] = [];
  for (const market of input.supported) {
    try {
      const quote = await input.quote(input.supplierProductId, market);
      quotes.push({
        market,
        amount: quote.cost,
        currency: quote.cost === null ? null : (input.supplierCurrency ?? "USD"),
        service: quote.cost === null ? null : (quote.service ?? "supplier standard"),
        quotedAt: quote.cost === null ? null : now,
      });
    } catch {
      quotes.push({ market, amount: null, currency: null, service: null, quotedAt: null });
    }
  }
  return recordMarketEligibility({
    supplierProductId: input.supplierProductId,
    shopifyProductId: input.shopifyProductId ?? null,
    quotes,
    supported: input.supported,
    maxAgeDays: input.maxAgeDays,
  });
}

export interface MarketCoverageSummary {
  supported: MarketCode[];
  perMarket: Array<{ market: MarketCode; country: string; eligible: number; total: number }>;
  productsWithNoMarket: number;
  productsCovered: number;
}

/** Read only coverage snapshot for the admin console. */
export async function summariseMarketCoverage(
  supportedInput: unknown,
): Promise<MarketCoverageSummary> {
  const supported = resolveSupportedMarkets(supportedInput);
  const { data } = await client()
    .from(TABLE)
    .select("supplier_product_id, market, eligible");
  const rows = (data ?? []) as Array<{
    supplier_product_id: string;
    market: string;
    eligible: boolean;
  }>;

  const perMarket = supported.map((market) => {
    const scoped = rows.filter((row) => row.market === market);
    return {
      market,
      country: MARKETS[market].country,
      eligible: scoped.filter((row) => row.eligible).length,
      total: scoped.length,
    };
  });

  const byProduct = new Map<string, boolean>();
  for (const row of rows) {
    if (!supported.includes(row.market as MarketCode)) continue;
    byProduct.set(row.supplier_product_id, (byProduct.get(row.supplier_product_id) ?? false) || row.eligible);
  }
  const productsCovered = [...byProduct.values()].filter(Boolean).length;

  return {
    supported,
    perMarket,
    productsWithNoMarket: byProduct.size - productsCovered,
    productsCovered,
  };
}
