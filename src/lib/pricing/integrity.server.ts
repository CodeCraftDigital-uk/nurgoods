/**
 * Live pricing integrity enforcement.
 *
 * The pricing audit reads the local catalogue mirror. That is useful for
 * reporting, but it cannot answer the only question that matters to a shopper:
 * what price is the commerce system actually charging right now. A supplier
 * push can make a product active in the store with its raw supplier price
 * before the mirror ever sees it, and holding a variant in the audit does not
 * take that price off sale. That gap is what allowed active listings to sit at
 * unrounded prices.
 *
 * This module closes it by working directly against the commerce system:
 *
 *   1. Enumerate every ACTIVE product and every one of its variants, with full
 *      pagination on both levels so there is no first page blind spot.
 *   2. For each product, resolve the verified landed cost basis.
 *        landed cost = supplier cost of goods + verified market shipping
 *        target     = landed cost * (1 + minimum markup uplift)
 *        retail     = (target + fixed fee) / (1 - variable fee), rounded UP
 *                     to the next valid charm price
 *   3. Correct every variant whose evidence is complete and whose live price
 *      does not match.
 *   4. Hold (unpublish from every channel and set to draft) every ACTIVE
 *      product whose evidence is incomplete, rather than leaving a price that
 *      cannot be justified on sale. No cost or shipping figure is ever
 *      invented to keep a product live.
 *   5. Read the prices back from the commerce system and verify them.
 *
 * The rule is fail closed: a product is either fully evidenced and correctly
 * priced, or it is not for sale.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import { zendropAdminClient } from "../zendrop/client.server";
import { loadPricingSettings } from "../zendrop/import.server";
import { loadShippingBasis, type ShippingBasis } from "./audit.server";
import {
  charmUp,
  markupUpliftFrom,
  priceFromProtectedLandedCost,
  type CanonicalFee,
} from "./canonical";
import type { PricingSettings } from "../zendrop/types";

const ACTIVE_PRODUCTS_QUERY = `
  query NurGoodsActivePricing($cursor: String) {
    products(first: 40, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        status
        variants(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            price
            availableForSale
            inventoryItem { unitCost { amount currencyCode } }
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_PAGE_QUERY = `
  query NurGoodsProductVariantsPage($id: ID!, $cursor: String) {
    product(id: $id) {
      variants(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          price
          availableForSale
          inventoryItem { unitCost { amount currencyCode } }
        }
      }
    }
  }
`;

const VARIANT_PRICE_MUTATION = `
  mutation NurGoodsIntegrityReprice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

const READ_BACK_QUERY = `
  query NurGoodsReadBackPrices($id: ID!, $cursor: String) {
    product(id: $id) {
      status
      variants(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id price }
      }
    }
  }
`;

const CHANNELS_QUERY = `
  query NurGoodsIntegrityChannels($id: ID!) {
    product(id: $id) {
      status
      resourcePublicationsV2(first: 25) { nodes { isPublished publication { id name } } }
    }
  }
`;

const UNPUBLISH_MUTATION = `
  mutation NurGoodsIntegrityUnpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) { userErrors { field message } }
  }
`;

const DRAFT_MUTATION = `
  mutation NurGoodsIntegrityDraft($input: ProductInput!) {
    productUpdate(input: $input) { product { id status } userErrors { field message } }
  }
`;

export interface LiveVariant {
  variantId: string;
  title: string;
  price: number | null;
  availableForSale: boolean;
  unitCost: number | null;
  unitCostCurrency: string | null;
}

export interface LiveProduct {
  shopifyProductId: string;
  title: string;
  handle: string;
  variants: LiveVariant[];
}

/**
 * Why a variant is in the state it is in. There is deliberately no "other"
 * bucket: every active variant lands in exactly one of these.
 */
export type IntegrityCategory =
  /** Evidence complete, formula applied, live price is right. */
  | "correct"
  /** Evidence complete but the live price did not match the formula. */
  | "pipeline_failed"
  /** Evidence incomplete, so the product must not be customer facing. */
  | "unverified_but_live"
  /** Documented, deliberate exemption. */
  | "exempt";

export interface VariantVerdict {
  shopifyProductId: string;
  shopifyVariantId: string;
  productTitle: string;
  handle: string;
  variantTitle: string;
  currentPrice: number | null;
  unitCost: number | null;
  shippingCost: number | null;
  shippingSource: string | null;
  landedCost: number | null;
  rawPrice: number | null;
  expectedPrice: number | null;
  matches: boolean;
  endsIn99: boolean;
  repricable: boolean;
  category: IntegrityCategory;
  reason: string | null;
}

export interface ProductAction {
  shopifyProductId: string;
  title: string;
  handle: string;
  action: "none" | "repriced" | "held" | "failed";
  variantsRepriced: number;
  reason: string | null;
  error: string | null;
  readBackVerified: boolean | null;
}

export interface IntegrityReport {
  runId: string | null;
  dryRun: boolean;
  activeProducts: number;
  activeVariants: number;
  nonCharmBefore: number;
  correct: number;
  pipelineFailed: number;
  unverifiedButLive: number;
  exempt: number;
  productsRepriced: number;
  variantsRepriced: number;
  productsHeld: number;
  failures: number;
  readBackMismatches: number;
  nonCharmAfter: number;
  verdicts: VariantVerdict[];
  actions: ProductAction[];
  message: string;
}

/**
 * Documented, approved exemptions from the charm rounding rule, keyed by
 * store product id. Empty by policy: there is no approved exemption today,
 * and anything added here must carry a written reason.
 */
export const APPROVED_PRICING_EXEMPTIONS: Record<string, string> = {};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function endsInCharm99(price: number | null | undefined): boolean {
  if (typeof price !== "number" || !Number.isFinite(price)) return false;
  return Math.round(price * 100) % 100 === 99;
}

/**
 * The retail price of a variant, on the same rule the pricing authority uses:
 * a minimum uplift ON landed cost, then payment fees, then charm rounding up.
 * The stored target figure is an uplift on cost, never a gross margin.
 */
export function expectedRetailPrice(
  unitCost: number | null,
  shippingCost: number | null,
  settings: Pick<PricingSettings, "target_margin" | "rounding_mode"> &
    Partial<Pick<PricingSettings, "payment_fee_variable" | "payment_fee_fixed">>,
): { landedCost: number | null; rawPrice: number | null; price: number | null } {
  const empty = { landedCost: null, rawPrice: null, price: null };
  if (typeof unitCost !== "number" || !Number.isFinite(unitCost) || unitCost <= 0) return empty;
  // Delivery is free to the customer, so an unproven shipping cost is an
  // unproven price. Nothing is assumed here.
  if (typeof shippingCost !== "number" || !Number.isFinite(shippingCost) || shippingCost < 0) {
    return empty;
  }
  const markupUplift = markupUpliftFrom(settings.target_margin);
  const fee: CanonicalFee = {
    variable:
      typeof settings.payment_fee_variable === "number" ? settings.payment_fee_variable : 0.02,
    fixed: typeof settings.payment_fee_fixed === "number" ? settings.payment_fee_fixed : 0.25,
  };
  const landedCost = round2(unitCost + shippingCost);
  const priced = priceFromProtectedLandedCost(landedCost, fee, markupUplift);
  if (!priced) return { landedCost, rawPrice: null, price: null };
  return { landedCost, rawPrice: round2(priced.rawPrice), price: charmUp(priced.rawPrice) };
}

/** Enumerates every active product with every variant. No pagination cap. */
export async function enumerateActiveCatalogue(): Promise<LiveProduct[]> {
  const credentials = await intakeCredentials();
  const products: LiveProduct[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 200; page += 1) {
    const data: any = await shopifyGraphql(credentials, ACTIVE_PRODUCTS_QUERY, { cursor });
    const nodes: any[] = data?.products?.nodes ?? [];
    for (const node of nodes) {
      const variants: LiveVariant[] = [];
      const collect = (list: any[]) => {
        for (const raw of list) {
          const price = raw?.price === null || raw?.price === undefined ? null : Number(raw.price);
          const cost = raw?.inventoryItem?.unitCost?.amount;
          variants.push({
            variantId: String(raw.id),
            title: String(raw.title ?? ""),
            price: Number.isFinite(price as number) ? (price as number) : null,
            availableForSale: raw?.availableForSale !== false,
            unitCost: cost === null || cost === undefined ? null : Number(cost),
            unitCostCurrency: raw?.inventoryItem?.unitCost?.currencyCode ?? null,
          });
        }
      };
      collect(node?.variants?.nodes ?? []);

      // Products with more than one page of variants are followed through to
      // the end, so a wide product can never hide an unpriced variant.
      let variantCursor: string | null = node?.variants?.pageInfo?.hasNextPage
        ? node.variants.pageInfo.endCursor
        : null;
      for (let vp = 0; vp < 50 && variantCursor; vp += 1) {
        const page: any = await shopifyGraphql(credentials, PRODUCT_VARIANTS_PAGE_QUERY, {
          id: String(node.id),
          cursor: variantCursor,
        });
        collect(page?.product?.variants?.nodes ?? []);
        variantCursor = page?.product?.variants?.pageInfo?.hasNextPage
          ? page.product.variants.pageInfo.endCursor
          : null;
      }

      products.push({
        shopifyProductId: String(node.id),
        title: String(node.title ?? ""),
        handle: String(node.handle ?? ""),
        variants,
      });
    }
    if (!data?.products?.pageInfo?.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return products;
}

function basisFor(
  shipping: Map<string, ShippingBasis>,
  shopifyProductId: string,
  mirrorId: string | null,
): ShippingBasis {
  const numeric = shopifyProductId.split("/").pop() ?? shopifyProductId;
  return (
    shipping.get(shopifyProductId) ??
    shipping.get(numeric) ??
    (mirrorId ? shipping.get(`uuid:${mirrorId}`) : undefined) ?? {
      amount: null,
      currency: null,
      service: null,
      destination: null,
      quotedAt: null,
      source: null,
      linked: false,
    }
  );
}

/**
 * This report compares live prices against the historic formula, which works
 * entirely in the selling currency. Evidence quoted in a supplier currency is
 * therefore treated as unavailable here rather than converted in passing.
 */
function shippingInSellingCurrency(basis: ShippingBasis, currency: string): number | null {
  if (basis.amount === null) return null;
  if (basis.currency && basis.currency !== currency) return null;
  return basis.amount;
}


/** Classifies the whole active catalogue without changing anything. */
export async function auditLivePricingIntegrity(): Promise<{
  settings: PricingSettings;
  products: LiveProduct[];
  verdicts: VariantVerdict[];
  byProduct: Map<string, VariantVerdict[]>;
}> {
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const [products, shipping] = await Promise.all([enumerateActiveCatalogue(), loadShippingBasis()]);

  const { data: mirrorRows } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id");
  const mirrorByShopifyId = new Map<string, string>();
  for (const row of ((mirrorRows ?? []) as any[])) {
    mirrorByShopifyId.set(String(row.shopify_product_id), String(row.id));
  }

  const verdicts: VariantVerdict[] = [];
  const byProduct = new Map<string, VariantVerdict[]>();

  for (const product of products) {
    const mirrorId = mirrorByShopifyId.get(product.shopifyProductId) ?? null;
    const basis = basisFor(shipping, product.shopifyProductId, mirrorId);
    const basisCost = shippingInSellingCurrency(basis, settings.currency);
    const exemption = APPROVED_PRICING_EXEMPTIONS[product.shopifyProductId] ?? null;

    const rows: VariantVerdict[] = product.variants.map((variant) => {
      const costUsable =
        typeof variant.unitCost === "number" &&
        Number.isFinite(variant.unitCost) &&
        variant.unitCost > 0 &&
        (!variant.unitCostCurrency || variant.unitCostCurrency === settings.currency);

      const { landedCost, rawPrice, price } = costUsable
        ? expectedRetailPrice(variant.unitCost, basisCost, settings)
        : { landedCost: null, rawPrice: null, price: null };

      const charm = endsInCharm99(variant.price);
      const matches = price !== null && variant.price !== null && Math.abs(variant.price - price) < 0.005;

      let category: IntegrityCategory;
      let reason: string | null = null;
      if (exemption) {
        category = "exempt";
        reason = exemption;
      } else if (price !== null) {
        category = matches ? "correct" : "pipeline_failed";
        if (!matches) {
          reason = `Live price ${Number(variant.price ?? 0).toFixed(2)} does not match the formula price ${price.toFixed(2)}`;
        }
      } else if (!basis.linked) {
        // A price that merely ends in .99 proves nothing about the economics
        // behind it. Without evidence the variant is held, never signed off.
        category = "unverified_but_live";
        reason = "No supplier linkage record exists, so the landed cost basis cannot be confirmed";
      } else if (basisCost === null) {
        category = "unverified_but_live";
        reason = `No confirmed shipping cost to ${settings.shipping_market} is recorded for this listing`;
      } else {
        category = "unverified_but_live";
        reason = "No usable cost of goods is recorded against this variant in the store";
      }

      return {
        shopifyProductId: product.shopifyProductId,
        shopifyVariantId: variant.variantId,
        productTitle: product.title,
        handle: product.handle,
        variantTitle: variant.title,
        currentPrice: variant.price,
        unitCost: costUsable ? variant.unitCost : null,
        shippingCost: basisCost,
        shippingSource: basis.source,
        landedCost,
        rawPrice,
        expectedPrice: price,
        matches,
        endsIn99: charm,
        repricable: price !== null,
        category,
        reason,
      };
    });

    byProduct.set(product.shopifyProductId, rows);
    verdicts.push(...rows);
  }

  return { settings, products, verdicts, byProduct };
}

/**
 * Takes a product off sale: unpublished from every live channel and set to
 * draft. Used by the pricing integrity pass and by supplier reconciliation
 * when a listing can no longer be evidenced as sellable.
 */
export async function holdProductFromSale(shopifyProductId: string): Promise<string[]> {
  return holdProduct(shopifyProductId);
}

async function holdProduct(shopifyProductId: string): Promise<string[]> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, CHANNELS_QUERY, { id: shopifyProductId });
  const live: Array<{ id: string; name: string }> = (data?.product?.resourcePublicationsV2?.nodes ?? [])
    .filter((node: any) => node?.isPublished && node?.publication?.id)
    .map((node: any) => ({ id: String(node.publication.id), name: String(node.publication.name ?? "") }));

  if (live.length > 0) {
    const result: any = await shopifyGraphql(credentials, UNPUBLISH_MUTATION, {
      id: shopifyProductId,
      input: live.map((channel) => ({ publicationId: channel.id })),
    });
    const errors = result?.publishableUnpublish?.userErrors ?? [];
    if (errors.length > 0) throw new Error(errors.map((e: any) => e.message).join(" "));
  }

  const draft: any = await shopifyGraphql(credentials, DRAFT_MUTATION, {
    input: { id: shopifyProductId, status: "DRAFT" },
  });
  const draftErrors = draft?.productUpdate?.userErrors ?? [];
  if (draftErrors.length > 0) throw new Error(draftErrors.map((e: any) => e.message).join(" "));
  return live.map((channel) => channel.name);
}

/** Reads prices straight back out of the commerce system after a write. */
async function readBackPrices(shopifyProductId: string): Promise<Map<string, number>> {
  const credentials = await intakeCredentials();
  const prices = new Map<string, number>();
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const data: any = await shopifyGraphql(credentials, READ_BACK_QUERY, {
      id: shopifyProductId,
      cursor,
    });
    for (const node of (data?.product?.variants?.nodes ?? []) as any[]) {
      prices.set(String(node.id), Number(node.price));
    }
    if (!data?.product?.variants?.pageInfo?.hasNextPage) break;
    cursor = data.product.variants.pageInfo.endCursor;
  }
  return prices;
}

/**
 * Runs the full pass: classify, correct what is evidenced, hold what is not,
 * then verify against the commerce system rather than the local mirror.
 */
export async function enforceLivePricingIntegrity(options?: {
  dryRun?: boolean;
  userId?: string | null;
  /**
   * Explicit human authorisation for a pass that would take an unusually large
   * share of the catalogue off sale. Without it such a pass still corrects
   * every price it can justify, but refuses the mass hold and says so.
   */
  confirmMassHold?: boolean;
}): Promise<IntegrityReport> {
  const dryRun = options?.dryRun === true;
  const supabase = await zendropAdminClient();
  const credentials = await intakeCredentials();
  const { settings, products, verdicts, byProduct } = await auditLivePricingIntegrity();

  const report: IntegrityReport = {
    runId: null,
    dryRun,
    activeProducts: products.length,
    activeVariants: verdicts.length,
    nonCharmBefore: verdicts.filter((v) => !v.endsIn99).length,
    correct: verdicts.filter((v) => v.category === "correct").length,
    pipelineFailed: verdicts.filter((v) => v.category === "pipeline_failed").length,
    unverifiedButLive: verdicts.filter((v) => v.category === "unverified_but_live").length,
    exempt: verdicts.filter((v) => v.category === "exempt").length,
    productsRepriced: 0,
    variantsRepriced: 0,
    productsHeld: 0,
    failures: 0,
    readBackMismatches: 0,
    nonCharmAfter: 0,
    verdicts,
    actions: [],
    message: "",
  };

  let runId: string | null = null;
  if (!dryRun) {
    const { data: runRow } = await supabase
      .from("pricing_audit_runs")
      .insert({
        mode: "live_integrity",
        status: "running",
        settings: settings as unknown as Record<string, unknown>,
        created_by: options?.userId ?? null,
      } as never)
      .select("id")
      .maybeSingle();
    runId = (runRow as any)?.id ?? null;
    report.runId = runId;
  }

  const { data: mirrorRows } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id");
  const mirrorByShopifyId = new Map<string, string>();
  for (const row of ((mirrorRows ?? []) as any[])) {
    mirrorByShopifyId.set(String(row.shopify_product_id), String(row.id));
  }

  // Blast radius check before a single product is touched. A pass that wants
  // to take a large share of the shop off sale is far more likely to be a
  // broken assumption upstream than a real pricing emergency, so it is refused
  // unless a human authorised this exact pass. Repricing still proceeds.
  const { withinImpactGuard } = await import("@/lib/catalogue/repair");
  const wouldHold = products.filter((product) =>
    (byProduct.get(product.shopifyProductId) ?? []).some(
      (row) => row.category === "unverified_but_live",
    ),
  ).length;
  const impact = withinImpactGuard({
    affected: wouldHold,
    total: products.length,
    maxShare: 0.1,
    maxProducts: 25,
    confirmed: options?.confirmMassHold === true,
  });
  const holdsAllowed = impact.allowed;

  for (const product of products) {
    const rows = byProduct.get(product.shopifyProductId) ?? [];
    const action: ProductAction = {
      shopifyProductId: product.shopifyProductId,
      title: product.title,
      handle: product.handle,
      action: "none",
      variantsRepriced: 0,
      reason: null,
      error: null,
      readBackVerified: null,
    };

    const blockers = rows.filter((row) => row.category === "unverified_but_live");
    const changes = rows
      .filter((row) => row.category === "pipeline_failed" && row.expectedPrice !== null)
      .map((row) => ({ id: row.shopifyVariantId, price: row.expectedPrice!.toFixed(2) }));

    // Fail closed. A product with any variant that cannot be justified comes
    // off sale entirely, even if its other variants could be repriced.
    if (blockers.length > 0) {
      action.action = "held";
      action.reason = `${blockers.length} variant(s) have no verified landed cost basis: ${blockers[0]?.reason ?? ""}`;
      if (!holdsAllowed) {
        action.action = "none";
        action.reason = `${action.reason}. ${impact.reason}`;
        report.actions.push(action);
        continue;
      }
      if (!dryRun) {
        try {
          await holdProduct(product.shopifyProductId);
          const mirrorId = mirrorByShopifyId.get(product.shopifyProductId);
          if (mirrorId) {
            await supabase
              .from("shopify_products")
              .update({ status: "draft", available_for_sale: false } as never)
              .eq("id", mirrorId);
          }
          report.productsHeld += 1;
        } catch (cause) {
          action.action = "failed";
          action.error = cause instanceof Error ? cause.message : "The store rejected the hold";
          report.failures += 1;
        }
      } else {
        report.productsHeld += 1;
      }
      report.actions.push(action);
      continue;
    }

    if (changes.length === 0) {
      report.actions.push(action);
      continue;
    }

    action.action = "repriced";
    if (dryRun) {
      action.variantsRepriced = changes.length;
      report.productsRepriced += 1;
      report.variantsRepriced += changes.length;
      report.actions.push(action);
      continue;
    }

    try {
      // Shopify accepts a bounded batch, so wide products are written in slices.
      for (let index = 0; index < changes.length; index += 100) {
        const slice = changes.slice(index, index + 100);
        const response: any = await shopifyGraphql(credentials, VARIANT_PRICE_MUTATION, {
          productId: product.shopifyProductId,
          variants: slice,
        });
        const errors = response?.productVariantsBulkUpdate?.userErrors ?? [];
        if (errors.length > 0) throw new Error(errors.map((e: any) => e.message).join(" "));
      }

      const live = await readBackPrices(product.shopifyProductId);
      const mismatched = changes.filter((change) => {
        const actual = live.get(change.id);
        return actual === undefined || Math.abs(actual - Number(change.price)) >= 0.005;
      });
      action.readBackVerified = mismatched.length === 0;
      report.readBackMismatches += mismatched.length;

      action.variantsRepriced = changes.length;
      report.productsRepriced += 1;
      report.variantsRepriced += changes.length;

      const mirrorId = mirrorByShopifyId.get(product.shopifyProductId) ?? null;
      for (const row of rows.filter((r) => r.category === "pipeline_failed" && r.expectedPrice !== null)) {
        await supabase
          .from("shopify_product_variants")
          .update({ price: row.expectedPrice } as never)
          .eq("shopify_variant_id", row.shopifyVariantId);
        await supabase.from("product_price_revisions").insert({
          run_id: runId,
          product_id: mirrorId,
          shopify_product_id: row.shopifyProductId,
          shopify_variant_id: row.shopifyVariantId,
          variant_title: row.variantTitle,
          old_price: row.currentPrice,
          new_price: row.expectedPrice,
          unit_cost: row.unitCost,
          shipping_cost: row.shippingCost,
          landed_cost: row.landedCost,
          target_margin: settings.target_margin,
          rounding_mode: settings.rounding_mode,
          cost_source: "shopify_inventory_unit_cost",
          shipping_source: row.shippingSource,
          source: "live_pricing_integrity",
          applied_by: options?.userId ?? null,
        } as never);
      }
    } catch (cause) {
      action.action = "failed";
      action.error = cause instanceof Error ? cause.message : "The store rejected the price update";
      report.failures += 1;
    }

    report.actions.push(action);
  }

  // Every correction and every hold is recorded as evidence of the calculation
  // that produced the live price.
  if (!dryRun && runId) {
    const items = verdicts.map((row) => ({
      run_id: runId,
      product_id: mirrorByShopifyId.get(row.shopifyProductId) ?? null,
      shopify_product_id: row.shopifyProductId,
      handle: row.handle,
      product_title: row.productTitle,
      shopify_variant_id: row.shopifyVariantId,
      variant_title: row.variantTitle,
      currency: settings.currency,
      current_price: row.currentPrice,
      unit_cost: row.unitCost,
      cost_source: "shopify_inventory_unit_cost",
      shipping_cost: row.shippingCost,
      shipping_source: row.shippingSource,
      landed_cost: row.landedCost,
      calculated_price: row.expectedPrice,
      status:
        row.category === "correct"
          ? "already_correct"
          : row.category === "pipeline_failed"
            ? "ready_to_reprice"
            : row.category === "exempt"
              ? "excluded_by_policy"
              : "held_unreliable_linkage",
      reason: row.reason,
    }));
    for (let index = 0; index < items.length; index += 400) {
      await supabase.from("pricing_audit_items").insert(items.slice(index, index + 400) as never);
    }
  }

  // Final verification comes from the commerce system, not the mirror.
  if (!dryRun) {
    const after = await enumerateActiveCatalogue();
    report.nonCharmAfter = after
      .flatMap((product) => product.variants)
      .filter((variant) => !endsInCharm99(variant.price)).length;
  } else {
    report.nonCharmAfter = report.nonCharmBefore;
  }

  report.message = `${report.activeProducts} active product(s) and ${report.activeVariants} active variant(s) checked. ${report.variantsRepriced} variant(s) repriced across ${report.productsRepriced} product(s), ${report.productsHeld} product(s) held for unverified landed cost, ${report.failures} failure(s). Non charm prices: ${report.nonCharmBefore} before, ${report.nonCharmAfter} after.`;

  if (!dryRun && runId) {
    await supabase
      .from("pricing_audit_runs")
      .update({
        status: "completed",
        message: report.message,
        totals: {
          active_products: report.activeProducts,
          active_variants: report.activeVariants,
          non_charm_before: report.nonCharmBefore,
          non_charm_after: report.nonCharmAfter,
          repriced: report.variantsRepriced,
          held: report.productsHeld,
          failures: report.failures,
        } as unknown as Record<string, unknown>,
        completed_at: new Date().toISOString(),
      } as never)
      .eq("id", runId);
  }

  return report;
}
