/**
 * Catalogue wide application of the sellability gate.
 *
 * The pure rules live in sellability.ts. This module gathers the evidence we
 * already hold for every active listing, reports what would happen, and, only
 * when explicitly authorised, holds the listings that cannot be proven
 * fulfillable by taking them off every sales channel.
 *
 * Nothing here calls the supplier, charges anything or touches an order.
 */
import { zendropAdminClient } from "@/lib/zendrop/client.server";
import { holdProductOffSalesChannels } from "@/lib/zendrop/store-publication.server";
import { evaluateSellability, type MarketEvidence, type SellabilityVerdict } from "./sellability";

export interface SellabilityRow {
  productId: string;
  shopifyProductId: string;
  title: string | null;
  verdict: SellabilityVerdict;
}

export interface SellabilityAudit {
  activeProducts: number;
  sellable: number;
  held: number;
  reasonCounts: Record<string, number>;
  rows: SellabilityRow[];
}

/** Read only pass over every active listing. Makes no store writes. */
export async function auditSellability(): Promise<SellabilityAudit> {
  const supabase = await zendropAdminClient();

  const { data: products } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id, title, status")
    .limit(5000);
  const active = ((products ?? []) as any[]).filter(
    (row) => String(row.status ?? "").toLowerCase() === "active",
  );

  const { data: links } = await supabase
    .from("product_supplier_links")
    .select(
      "product_id, shopify_product_id, supplier_product_id, variant_map, manual_hold, verified_at, last_supplier_sync_at, supplier_available",
    )
    .limit(5000);
  const linkByShopifyId = new Map(
    ((links ?? []) as any[]).map((row) => [String(row.shopify_product_id), row] as const),
  );

  /**
   * Shipping evidence is written against the supplier product, and only some
   * rows also carry the store identifiers. Indexing every key a row exposes
   * keeps a genuinely evidenced product from being held for lack of evidence.
   */
  const { data: eligibility } = await supabase
    .from("product_market_eligibility")
    .select("product_id, shopify_product_id, supplier_product_id, market, eligible, quoted_at")
    .limit(20000);
  const marketsByKey = new Map<string, MarketEvidence[]>();
  for (const row of ((eligibility ?? []) as any[])) {
    for (const key of [row.shopify_product_id, row.product_id, row.supplier_product_id]) {
      if (key === null || key === undefined || key === "") continue;
      const list = marketsByKey.get(String(key)) ?? [];
      list.push({
        market: String(row.market ?? ""),
        eligible: row.eligible === true,
        quotedAt: row.quoted_at ?? null,
      });
      marketsByKey.set(String(key), list);
    }
  }

  const rows: SellabilityRow[] = [];
  const reasonCounts: Record<string, number> = {};
  for (const product of active) {
    const shopifyProductId = String(product.shopify_product_id);
    const link = linkByShopifyId.get(shopifyProductId) ?? null;
    const supplierKey = link?.supplier_product_id ?? null;
    const markets =
      marketsByKey.get(shopifyProductId) ??
      marketsByKey.get(String(product.id)) ??
      (supplierKey ? marketsByKey.get(String(supplierKey)) : undefined) ??
      [];

    const verdict = evaluateSellability({
      link: link
        ? {
            variantMap: link.variant_map,
            manualHold: link.manual_hold,
            verifiedAt: link.verified_at,
            lastSupplierSyncAt: link.last_supplier_sync_at,
            supplierAvailable: link.supplier_available,
          }
        : null,
      markets,
      mode: "catalogue",
    });
    for (const reason of verdict.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    rows.push({
      productId: String(product.id),
      shopifyProductId,
      title: product.title ?? null,
      verdict,
    });
  }

  const sellable = rows.filter((row) => row.verdict.sellable).length;
  return {
    activeProducts: active.length,
    sellable,
    held: rows.length - sellable,
    reasonCounts,
    rows,
  };
}

export interface SellabilityHoldResult {
  audit: SellabilityAudit;
  attempted: number;
  heldOff: number;
  alreadyOff: number;
  failed: Array<{ shopifyProductId: string; message: string }>;
  applied: boolean;
  message: string;
}

/**
 * Applies the hold. Defaults to a dry run, is bounded per pass, and only ever
 * removes channels: nothing is published, archived or deleted here.
 */
export async function enforceSellabilityHold(
  options: { apply?: boolean; limit?: number } = {},
): Promise<SellabilityHoldResult> {
  const apply = options.apply === true;
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const audit = await auditSellability();
  const candidates = audit.rows.filter((row) => !row.verdict.sellable).slice(0, limit);

  let heldOff = 0;
  let alreadyOff = 0;
  const failed: Array<{ shopifyProductId: string; message: string }> = [];

  for (const row of candidates) {
    try {
      const result = await holdProductOffSalesChannels(row.shopifyProductId, { dryRun: !apply });
      if (result.alreadyUnpublished) alreadyOff += 1;
      else if (result.removed.length > 0) heldOff += 1;
      else failed.push({ shopifyProductId: row.shopifyProductId, message: result.message });
    } catch (cause) {
      failed.push({
        shopifyProductId: row.shopifyProductId,
        message: cause instanceof Error ? cause.message : "Hold failed",
      });
    }
  }

  return {
    audit,
    attempted: candidates.length,
    heldOff,
    alreadyOff,
    failed,
    applied: apply,
    message: apply
      ? `${heldOff} listing(s) taken off every sales channel, ${alreadyOff} already off, ${failed.length} failed`
      : `Dry run. ${candidates.length} listing(s) would be taken off every sales channel`,
  };
}

/**
 * Sellability verdict for a single store product, built from the same evidence
 * as the catalogue audit. Used as the activation gate, so an import can never
 * go live before its supplier mapping and market shipping evidence exist.
 */
export async function productSellability(shopifyProductId: string): Promise<SellabilityVerdict> {
  const supabase = await zendropAdminClient();
  const id = String(shopifyProductId);

  const { data: link } = await supabase
    .from("product_supplier_links")
    .select(
      "product_id, supplier_product_id, variant_map, manual_hold, verified_at, last_supplier_sync_at, supplier_available",
    )
    .eq("shopify_product_id", id)
    .maybeSingle();

  const productId = (link as any)?.product_id ?? null;
  const supplierProductId = (link as any)?.supplier_product_id ?? null;
  // Evidence may be recorded against the store product or the supplier
  // product, so every identifier we hold for this listing is queried.
  const filters = [`shopify_product_id.eq.${id}`];
  if (productId) filters.push(`product_id.eq.${productId}`);
  if (supplierProductId) filters.push(`supplier_product_id.eq.${supplierProductId}`);
  const { data: eligibility } = await supabase
    .from("product_market_eligibility")
    .select("market, eligible, quoted_at, shopify_product_id, product_id, supplier_product_id")
    .or(filters.join(","));


  return evaluateSellability({
    link: link
      ? {
          variantMap: (link as any).variant_map,
          manualHold: (link as any).manual_hold,
          verifiedAt: (link as any).verified_at,
          lastSupplierSyncAt: (link as any).last_supplier_sync_at,
          supplierAvailable: (link as any).supplier_available,
        }
      : null,
    markets: ((eligibility ?? []) as any[]).map((row) => ({
      market: String(row.market ?? ""),
      eligible: row.eligible === true,
      quotedAt: row.quoted_at ?? null,
    })),
    mode: "catalogue",
  });
}
