/**
 * Refreshes destination specific supplier shipping quotes.
 *
 * This is a read only supplier operation. It calls the supplier shipping quote
 * action for the configured shipping market and records the amount, the
 * currency, the named service, the destination and the timestamp so the
 * pricing audit has evidence it can actually trust. It never creates,
 * confirms, pays for or modifies a supplier order.
 */
import { zendropAdminClient } from "../zendrop/client.server";
import { quoteZendropShipping } from "../zendrop/catalogue.server";
import { loadPricingSettings } from "../zendrop/import.server";

export interface ShippingQuoteRefreshResult {
  attempted: number;
  refreshed: number;
  unavailable: number;
  failures: string[];
  message: string;
}

export async function refreshShippingQuotes(input?: {
  limit?: number | undefined;
}): Promise<ShippingQuoteRefreshResult> {
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const market = settings.shipping_market;
  const limit = Math.max(1, Math.min(input?.limit ?? 60, 200));

  const { data: links } = await supabase
    .from("product_supplier_links")
    .select("id, product_id, shopify_product_id, supplier_product_id, shipping_quoted_at")
    .not("supplier_product_id", "is", null)
    .order("shipping_quoted_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const result: ShippingQuoteRefreshResult = {
    attempted: 0,
    refreshed: 0,
    unavailable: 0,
    failures: [],
    message: "",
  };

  for (const raw of ((links ?? []) as any[])) {
    result.attempted += 1;
    try {
      const quote = await quoteZendropShipping(String(raw.supplier_product_id), market);
      if (quote.cost === null) {
        result.unavailable += 1;
        await supabase
          .from("product_supplier_links")
          .update({
            quoted_amount: null,
            shipping_cost: null,
            shipping_service: null,
            shipping_destination: market,
            shipping_quoted_at: null,
            shipping_source: "supplier_quote_unavailable",
          } as never)
          .eq("id", raw.id);
        continue;
      }
      await supabase
        .from("product_supplier_links")
        .update({
          quoted_amount: quote.cost,
          quoted_currency: "USD",
          shipping_cost: quote.cost,
          shipping_currency: "USD",
          shipping_service: quote.service ?? "supplier standard",
          shipping_destination: market,
          shipping_quoted_at: new Date().toISOString(),
          shipping_source: "supplier_destination_quote",
        } as never)
        .eq("id", raw.id);
      result.refreshed += 1;
    } catch (cause) {
      result.failures.push(
        `${raw.supplier_product_id}: ${
          cause instanceof Error ? cause.message : "The supplier quote could not be read"
        }`,
      );
    }
  }

  result.message = `${result.refreshed} shipping quote(s) refreshed for ${market}, ${result.unavailable} unavailable, ${result.failures.length} failed.`;
  return result;
}
