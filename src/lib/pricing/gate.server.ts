/**
 * The pricing publication gate.
 *
 * Nothing becomes publicly sellable on any NUR GOODS surface until its price
 * has been calculated on the approved formula, written to the store, read back
 * from the store, and confirmed identical. The gate is deliberately blunt:
 *
 *   pricing_pending  a variant with no calculation on the approved formula
 *   pricing_hold     no usable cost of goods, so no price may be guessed
 *   drift / failed   the store does not yet show the calculated price
 *   verified         the store was read back and matches to the penny
 *
 * A product is publication eligible only when every one of its variants is
 * verified. The storefront projection enforces the same rule in the database,
 * so the public website cannot show a listing this module has not cleared.
 *
 * While a product is not eligible it is withdrawn from the two customer facing
 * store channels, the Online Store and Shop, and put back on them the moment
 * pricing verifies. Point of Sale is never touched.
 */
import { zendropAdminClient } from "../zendrop/client.server";
import { PRICING_FORMULA_VERSION, repriceProducts } from "./authority.server";

/** A penny. Prices equal within this are the same price. */
const PENCE = 0.005;

export type VariantGateState = "pending" | "held" | "drift" | "failed" | "verified";

export interface ProductGateVerdict {
  shopifyProductId: string;
  productId: string | null;
  status: string | null;
  eligible: boolean;
  variants: number;
  verified: number;
  pending: number;
  held: number;
  drift: number;
  failed: number;
  reason: string | null;
}

export interface GateEnforcementResult {
  evaluated: number;
  eligible: number;
  blocked: number;
  restored: string[];
  withdrawn: string[];
  exceptions: string[];
  message: string;
}

export interface PricingGateStats {
  formula_version: string;
  variants_total: number;
  pending: number;
  held: number;
  failed: number;
  drift: number;
  verified: number;
  retry_due: number;
  products_eligible: number;
  products_blocked: number;
  active_products_blocked: number;
  snapshot_products: number;
  last_error: string | null;
  measured_at: string;
}

/**
 * Keeps the database's copy of the approved formula version identical to the
 * one this code calculates with, so the projection gate and the pricing
 * service can never disagree about what "current" means.
 */
export async function syncApprovedFormulaVersion(): Promise<string> {
  const supabase = await zendropAdminClient();
  await supabase
    .from("pricing_formula_policy")
    .upsert({ id: true, formula_version: PRICING_FORMULA_VERSION } as never, { onConflict: "id" });
  return PRICING_FORMULA_VERSION;
}

/**
 * Whether the pricing service is currently permitted to put stock on sale.
 *
 * Pricing correctness and commercial activation are two different decisions.
 * A repair, a backfill or a formula change can run across the whole catalogue
 * with this off, correcting every price while every product stays exactly as
 * the merchant left it. Absence of the policy row is a no.
 */
export async function activationAllowed(): Promise<boolean> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("pricing_formula_policy")
    .select("activation_enabled")
    .maybeSingle();
  return (data as any)?.activation_enabled === true;
}

function classify(row: any): VariantGateState {
  if (!row || row.formula_version !== PRICING_FORMULA_VERSION) return "pending";
  if (row.hold_reason || row.push_state === "held") return "held";
  if (row.push_state === "failed") return "failed";
  if (row.push_state === "drifted") return "drift";
  const expected = row.expected_price === null ? null : Number(row.expected_price);
  const observed = row.observed_shopify_price === null ? null : Number(row.observed_shopify_price);
  if (row.push_state === "in_sync" && expected !== null && observed !== null && Math.abs(observed - expected) < PENCE) {
    return "verified";
  }
  return "pending";
}

/**
 * Decides publication eligibility for a bounded set of store products from the
 * recorded calculation and the price read back from the store.
 */
export async function evaluateProductPricingGate(
  shopifyProductIds: string[],
): Promise<ProductGateVerdict[]> {
  const ids = Array.from(new Set(shopifyProductIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const supabase = await zendropAdminClient();

  const { data: products } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id, status")
    .in("shopify_product_id", ids);
  const productRows = (products ?? []) as any[];
  const mirrorIds = productRows.map((row) => String(row.id));

  const { data: variants } = mirrorIds.length
    ? await supabase
        .from("shopify_product_variants")
        .select("product_id, shopify_variant_id")
        .in("product_id", mirrorIds)
    : { data: [] as any[] };
  const variantRows = (variants ?? []) as any[];

  const variantIds = variantRows.map((row) => String(row.shopify_variant_id));
  const authorityByVariant = new Map<string, any>();
  for (let start = 0; start < variantIds.length; start += 300) {
    const slice = variantIds.slice(start, start + 300);
    const { data: authority } = await supabase
      .from("product_price_authority")
      .select(
        "shopify_variant_id, formula_version, push_state, hold_reason, expected_price, observed_shopify_price",
      )
      .in("shopify_variant_id", slice);
    for (const row of (authority ?? []) as any[]) {
      authorityByVariant.set(String(row.shopify_variant_id), row);
    }
  }

  return productRows.map((product) => {
    const own = variantRows.filter((row) => String(row.product_id) === String(product.id));
    const verdict: ProductGateVerdict = {
      shopifyProductId: String(product.shopify_product_id),
      productId: String(product.id),
      status: product.status ?? null,
      eligible: false,
      variants: own.length,
      verified: 0,
      pending: 0,
      held: 0,
      drift: 0,
      failed: 0,
      reason: null,
    };
    if (own.length === 0) {
      verdict.reason = "The catalogue mirror has no variants for this product yet";
      return verdict;
    }
    for (const variant of own) {
      const state = classify(authorityByVariant.get(String(variant.shopify_variant_id)));
      verdict[state === "verified" ? "verified" : state] += 1;
    }
    verdict.eligible = verdict.verified === own.length;
    if (!verdict.eligible) {
      verdict.reason =
        verdict.held > 0
          ? `${verdict.held} variant(s) have no usable cost of goods, so no price may be set`
          : verdict.failed > 0
            ? `${verdict.failed} variant price update(s) were refused by the store and are awaiting retry`
            : verdict.drift > 0
              ? `${verdict.drift} variant(s) do not yet show the calculated price in the store`
              : `${verdict.pending} variant(s) are not priced on ${PRICING_FORMULA_VERSION} yet`;
    }
    return verdict;
  });
}

/**
 * Prices a bounded set of products, then brings their store channels into line
 * with the verdict: approved channels restored once verified, Online Store and
 * Shop withdrawn while pricing is pending. Safe to call from the intake worker
 * on every store product event.
 */
export async function enforcePricingPublicationGate(options: {
  shopifyProductIds: string[];
  reprice?: boolean;
  dryRun?: boolean;
}): Promise<GateEnforcementResult> {
  const ids = Array.from(new Set(options.shopifyProductIds.filter(Boolean))).slice(0, 40);
  const result: GateEnforcementResult = {
    evaluated: 0,
    eligible: 0,
    blocked: 0,
    restored: [],
    withdrawn: [],
    exceptions: [],
    message: "",
  };
  if (ids.length === 0) {
    result.message = "There was nothing to gate.";
    return result;
  }

  await syncApprovedFormulaVersion();
  if (options.reprice !== false) {
    await repriceProducts({ shopifyProductIds: ids, dryRun: options.dryRun === true });
  }

  const verdicts = await evaluateProductPricingGate(ids);
  result.evaluated = verdicts.length;

  const { ensureStorePublications, withdrawCustomerChannels } = await import(
    "../zendrop/store-publication.server"
  );

  for (const verdict of verdicts) {
    if (verdict.eligible) {
      result.eligible += 1;
      // Only an active product is restored to the selling channels. A draft
      // stays a draft; pricing correctness does not decide commercial intent.
      if (verdict.status !== "active") continue;
      try {
        const publication = await ensureStorePublications(verdict.shopifyProductId, undefined, {
          dryRun: options.dryRun === true,
        });
        if (publication.published.length > 0) result.restored.push(verdict.shopifyProductId);
      } catch (cause) {
        result.exceptions.push(
          `${verdict.shopifyProductId}: ${cause instanceof Error ? cause.message : "publication failed"}`,
        );
      }
      continue;
    }

    result.blocked += 1;
    try {
      const held = await withdrawCustomerChannels(verdict.shopifyProductId, {
        dryRun: options.dryRun === true,
      });
      if (held.removed.length > 0) result.withdrawn.push(verdict.shopifyProductId);
    } catch (cause) {
      result.exceptions.push(
        `${verdict.shopifyProductId}: ${cause instanceof Error ? cause.message : "withdrawal failed"}`,
      );
    }
  }

  result.message = `${result.evaluated} product(s) gated: ${result.eligible} publication eligible, ${result.blocked} held off the selling channels, ${result.withdrawn.length} withdrawn, ${result.restored.length} restored.`;
  return result;
}

/** Cheap, bounded monitoring. One database call, no store traffic. */
export async function pricingGateStats(): Promise<PricingGateStats> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase.rpc("pricing_gate_stats" as never);
  return data as unknown as PricingGateStats;
}
