/**
 * Refreshes destination specific supplier shipping quotes.
 *
 * This is a read only supplier operation. It calls the supplier shipping quote
 * action for every supported market and records the amount, the currency, the
 * named service, the destination and the timestamp so the pricing audit has
 * evidence it can actually trust. The pricing market keeps its figure on the
 * supplier link, because that is the basis the selling price is solved from,
 * while every supported market also gets its own eligibility row. It never
 * creates, confirms, pays for or modifies a supplier order.
 */
import { zendropAdminClient } from "../zendrop/client.server";
import { quoteZendropShipping } from "../zendrop/catalogue.server";
import { loadPricingSettings } from "../zendrop/import.server";
import { resolvePricingMarket, resolveSupportedMarkets, type MarketCode } from "./markets";
import { recordMarketEligibility, type RecordedMarketQuote } from "./market-eligibility.server";
import { planCycle } from "./shipping-cycle";

const CYCLE_STATE_ID = "shipping_quote_cycle";

export interface ShippingQuoteRefreshResult {
  attempted: number;
  refreshed: number;
  unavailable: number;
  /** Products with usable evidence for at least one supported market. */
  marketEligible: number;
  markets: string[];
  failures: string[];
  /** Refresh cycle this pass belonged to. */
  cycle: number;
  /** Links still to be attempted in this cycle after the pass. */
  remaining: number;
  message: string;
}

export async function refreshShippingQuotes(input?: {
  limit?: number | undefined;
  reset?: boolean | undefined;
}): Promise<ShippingQuoteRefreshResult> {
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const supported = resolveSupportedMarkets(settings.supported_markets);
  const pricingMarket: MarketCode = resolvePricingMarket(
    supported,
    settings.currency,
    settings.shipping_market,
  );
  const limit = Math.max(1, Math.min(input?.limit ?? 60, 200));

  // The cycle number lives beside the other pricing checkpoints so a refresh
  // survives a restart and resumes exactly where it stopped.
  const { data: stateRow } = await supabase
    .from("pricing_backfill_state")
    .select("cursor")
    .eq("id", CYCLE_STATE_ID)
    .maybeSingle();
  const storedCycle = Number((stateRow as any)?.cursor ?? 0);

  const countOutstanding = async (cycle: number) => {
    const { count } = await supabase
      .from("product_supplier_links")
      .select("id", { count: "exact", head: true })
      .not("supplier_product_id", "is", null)
      .lt("shipping_attempt_cycle", cycle);
    return count ?? 0;
  };

  const outstanding = storedCycle > 0 ? await countOutstanding(storedCycle) : 0;
  const plan = planCycle({
    storedCycle,
    outstanding,
    ...(input?.reset ? { reset: true } : {}),
  });
  const cycle = plan.cycle;
  if (plan.started) {
    await supabase
      .from("pricing_backfill_state")
      .upsert({ id: CYCLE_STATE_ID, cursor: String(cycle) } as never, { onConflict: "id" });
  }

  const { data: links } = await supabase
    .from("product_supplier_links")
    .select("id, product_id, shopify_product_id, supplier_product_id, shipping_quoted_at")
    .not("supplier_product_id", "is", null)
    .lt("shipping_attempt_cycle", cycle)
    .order("id", { ascending: true })
    .limit(limit);

  const result: ShippingQuoteRefreshResult = {
    attempted: 0,
    refreshed: 0,
    unavailable: 0,
    marketEligible: 0,
    markets: supported,
    failures: [],
    cycle,
    remaining: 0,
    message: "",
  };

  for (const raw of ((links ?? []) as any[])) {
    result.attempted += 1;
    const supplierProductId = String(raw.supplier_product_id);
    const now = new Date().toISOString();
    const quotes: RecordedMarketQuote[] = [];

    for (const market of supported) {
      try {
        const quote = await quoteZendropShipping(supplierProductId, market);
        quotes.push({
          market,
          amount: quote.cost,
          currency: quote.cost === null ? null : "USD",
          service: quote.cost === null ? null : (quote.service ?? "supplier standard"),
          quotedAt: quote.cost === null ? null : now,
        });
      } catch (cause) {
        quotes.push({ market, amount: null, currency: null, service: null, quotedAt: null });
        result.failures.push(
          `${supplierProductId} (${market}): ${
            cause instanceof Error ? cause.message : "The supplier quote could not be read"
          }`,
        );
      }
    }

    try {
      const eligibility = await recordMarketEligibility({
        supplierProductId,
        shopifyProductId: raw.shopify_product_id ?? null,
        quotes,
        supported,
        maxAgeDays: settings.shipping_quote_max_age_days,
      });
      if (eligibility.qualifies) result.marketEligible += 1;
    } catch (cause) {
      result.failures.push(
        `${supplierProductId}: market eligibility could not be recorded (${
          cause instanceof Error ? cause.message : "unknown reason"
        })`,
      );
    }

    // Every attempt is stamped with the cycle, successful or not, so a
    // supplier that never quotes cannot be picked again ahead of links that
    // have not been tried yet.
    const attempt = { shipping_attempt_at: now, shipping_attempt_cycle: cycle };

    // The supplier link carries the pricing market basis, because that is the
    // only market the selling price is currently solved for.
    const priced = quotes.find((quote) => quote.market === pricingMarket);
    if (!priced || priced.amount === null) {
      result.unavailable += 1;
      await supabase
        .from("product_supplier_links")
        .update({
          quoted_amount: null,
          shipping_cost: null,
          shipping_service: null,
          shipping_destination: pricingMarket,
          shipping_quoted_at: null,
          shipping_source: "supplier_quote_unavailable",
          ...attempt,
        } as never)
        .eq("id", raw.id);
      continue;
    }

    await supabase
      .from("product_supplier_links")
      .update({
        quoted_amount: priced.amount,
        quoted_currency: priced.currency ?? "USD",
        shipping_cost: priced.amount,
        shipping_currency: priced.currency ?? "USD",
        shipping_service: priced.service ?? "supplier standard",
        shipping_destination: pricingMarket,
        shipping_quoted_at: priced.quotedAt,
        shipping_source: "supplier_destination_quote",
        ...attempt,
      } as never)
      .eq("id", raw.id);
    result.refreshed += 1;
  }

  result.remaining = await countOutstanding(cycle);
  result.message = `Cycle ${cycle}: ${result.refreshed} pricing market quote(s) refreshed for ${pricingMarket}, ${result.marketEligible} product(s) eligible for at least one of ${supported.join(" and ")}, ${result.unavailable} unavailable, ${result.failures.length} quote failure(s), ${result.remaining} link(s) still to attempt.`;
  return result;
}
