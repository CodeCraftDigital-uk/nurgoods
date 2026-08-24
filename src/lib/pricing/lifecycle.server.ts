/**
 * The pricing publication lifecycle.
 *
 * A product is not sellable because it has a price greater than zero. It is
 * sellable because this service proved, end to end, that the price customers
 * will pay is the price NUR GOODS calculated:
 *
 *   pending     the product is known and waiting for its turn
 *   processing  the service is calculating and writing right now
 *   held        no usable cost of goods, so no price may be invented
 *   error       the store refused the write, or the read back disagreed
 *   verified    every variant was written, read back and matched to the penny
 *
 * The state lives in two places that must agree: an app owned product
 * metafield in the store (nur.pricing_status, nur.pricing_formula_version,
 * nur.pricing_verified_at) and a local lifecycle row used for cheap reporting.
 * Only this service ever writes verified, and only after a read back.
 *
 * Nothing is publicly sellable before verification. A product that is not
 * verified is forced to DRAFT and taken off the Online Store and Shop. After
 * verification the same service activates it and publishes it to the headless
 * channel, the Online Store and Shop. Point of Sale is never touched.
 *
 * Loops are prevented by an input fingerprint and nur.last_app_write_at: our
 * own price write echoes back through the store webhook, recalculates to the
 * identical figure, and settles as a no-op.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import { zendropAdminClient } from "../zendrop/client.server";
import { PRICING_FORMULA_VERSION, repriceProducts } from "./authority.server";

/** A penny. Prices equal within this are the same price. */
const PENCE = 0.005;

/** Bounded retry spacing for a product that could not be verified. */
const BACKOFF_MINUTES = [5, 30, 180, 720];

export const PRICING_METAFIELD_NAMESPACE = "nur";
export const PRICING_STATUS_KEY = "pricing_status";
export const PRICING_VERSION_KEY = "pricing_formula_version";
export const PRICING_VERIFIED_AT_KEY = "pricing_verified_at";
export const PRICING_INPUT_HASH_KEY = "pricing_input_hash";
export const PRICING_LAST_WRITE_KEY = "last_app_write_at";

export type PricingLifecycleStatus = "pending" | "processing" | "verified" | "held" | "error";

export interface LifecycleOutcome {
  shopifyProductId: string;
  status: PricingLifecycleStatus;
  variants: number;
  verifiedVariants: number;
  reason: string;
  activation: string | null;
  publication: string | null;
  skipped: boolean;
}

export interface LifecycleRunResult {
  evaluated: number;
  verified: number;
  held: number;
  errored: number;
  skipped: number;
  activated: number;
  drafted: number;
  outcomes: LifecycleOutcome[];
  message: string;
}

const LIFECYCLE_QUERY = `
  query NurGoodsLifecycleProduct($id: ID!) {
    product(id: $id) {
      id
      title
      status
      metafields(first: 10, namespace: "${PRICING_METAFIELD_NAMESPACE}") {
        nodes { key value }
      }
      variants(first: 100) {
        nodes {
          id
          title
          price
          compareAtPrice
          inventoryItem { unitCost { amount currencyCode } }
        }
      }
    }
  }
`;

const METAFIELDS_SET = `
  mutation NurGoodsPricingState($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

const STATUS_MUTATION = `
  mutation NurGoodsLifecycleStatus($id: ID!, $status: ProductStatus!) {
    productUpdate(product: { id: $id, status: $status }) {
      product { id status }
      userErrors { field message }
    }
  }
`;

function numeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Charm compliance. Every approved retail price ends in .99. */
export function endsInCharm(price: number): boolean {
  return Math.abs(Math.round(price * 100) % 100) === 99;
}

function nextAttemptAt(attempts: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] ?? 720;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Everything the price is derived from, in one fingerprint. If it has not
 * moved, there is nothing to do, which is what makes the webhook driven loop
 * settle instead of running for ever.
 *
 * The per variant fingerprints come from the canonical calculation, so they
 * already cover the cost of goods, every destination shipping quote and its
 * timestamp, the exchange rate, the fees and the markup. A shipping quote that
 * expires therefore changes this hash and forces a fresh decision, which is
 * what stops a stale quote quietly holding a price in place.
 */
export function pricingInputHash(
  variants: Array<{ variantId: string; fingerprint: string }>,
): string {
  const body = variants
    .slice()
    .sort((a, b) => a.variantId.localeCompare(b.variantId))
    .map((entry) => `${entry.variantId}=${entry.fingerprint}`)
    .join(",");
  return [PRICING_FORMULA_VERSION, body].join("|");
}


async function readProduct(shopifyProductId: string) {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, LIFECYCLE_QUERY, { id: shopifyProductId });
  const product = data?.product;
  if (!product?.id) return null;
  const metafields = new Map<string, string>(
    ((product.metafields?.nodes ?? []) as any[]).map((node) => [String(node.key), String(node.value ?? "")]),
  );
  return {
    id: String(product.id),
    title: String(product.title ?? ""),
    status: String(product.status ?? "").toLowerCase(),
    metafields,
    variants: ((product.variants?.nodes ?? []) as any[]).map((variant) => ({
      id: String(variant.id),
      title: variant.title ? String(variant.title) : null,
      price: numeric(variant.price),
      compareAtPrice: numeric(variant.compareAtPrice),
      unitCost: numeric(variant?.inventoryItem?.unitCost?.amount),
      costCurrency: variant?.inventoryItem?.unitCost?.currencyCode ?? null,
    })),
  };
}

/** Writes the app owned pricing state onto the store product. */
async function writeMetafields(
  shopifyProductId: string,
  values: { status: PricingLifecycleStatus; inputHash?: string | null; verifiedAt?: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  const metafields: Array<Record<string, string>> = [
    {
      ownerId: shopifyProductId,
      namespace: PRICING_METAFIELD_NAMESPACE,
      key: PRICING_STATUS_KEY,
      type: "single_line_text_field",
      value: values.status,
    },
    {
      ownerId: shopifyProductId,
      namespace: PRICING_METAFIELD_NAMESPACE,
      key: PRICING_VERSION_KEY,
      type: "single_line_text_field",
      value: PRICING_FORMULA_VERSION,
    },
    {
      ownerId: shopifyProductId,
      namespace: PRICING_METAFIELD_NAMESPACE,
      key: PRICING_LAST_WRITE_KEY,
      type: "date_time",
      value: now,
    },
  ];
  if (values.inputHash) {
    metafields.push({
      ownerId: shopifyProductId,
      namespace: PRICING_METAFIELD_NAMESPACE,
      key: PRICING_INPUT_HASH_KEY,
      type: "single_line_text_field",
      value: values.inputHash,
    });
  }
  if (values.verifiedAt) {
    metafields.push({
      ownerId: shopifyProductId,
      namespace: PRICING_METAFIELD_NAMESPACE,
      key: PRICING_VERIFIED_AT_KEY,
      type: "date_time",
      value: values.verifiedAt,
    });
  }
  const credentials = await intakeCredentials();
  await shopifyGraphql(credentials, METAFIELDS_SET, { metafields });
}

async function setStoreStatus(shopifyProductId: string, status: "ACTIVE" | "DRAFT"): Promise<string> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, STATUS_MUTATION, { id: shopifyProductId, status });
  const errors = (data?.productUpdate?.userErrors ?? []).map((error: any) => String(error.message));
  if (errors.length > 0) return errors.join(" ");
  return String(data?.productUpdate?.product?.status ?? status).toLowerCase();
}

async function recordLifecycle(row: {
  shopifyProductId: string;
  status: PricingLifecycleStatus;
  reason: string;
  inputHash?: string | null;
  verifiedAt?: string | null;
  variants?: number;
  verifiedVariants?: number;
  attempts?: number;
  nextAttemptAt?: string | null;
  activation?: string | null;
  publication?: string | null;
}): Promise<void> {
  const supabase = await zendropAdminClient();
  const { data: mirror } = await supabase
    .from("shopify_products")
    .select("id")
    .eq("shopify_product_id", row.shopifyProductId)
    .maybeSingle();
  await supabase.from("product_pricing_lifecycle").upsert(
    {
      shopify_product_id: row.shopifyProductId,
      product_id: (mirror as any)?.id ?? null,
      status: row.status,
      formula_version: PRICING_FORMULA_VERSION,
      reason: row.reason.slice(0, 500),
      input_hash: row.inputHash ?? null,
      verified_at: row.verifiedAt ?? null,
      last_app_write_at: new Date().toISOString(),
      last_priced_at: new Date().toISOString(),
      variants_total: row.variants ?? 0,
      variants_verified: row.verifiedVariants ?? 0,
      attempts: row.attempts ?? 0,
      next_attempt_at: row.nextAttemptAt ?? null,
      activation_result: row.activation ?? null,
      publication_result: row.publication ?? null,
    } as never,
    { onConflict: "shopify_product_id" },
  );
}

async function currentAttempts(shopifyProductId: string): Promise<number> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("product_pricing_lifecycle")
    .select("attempts")
    .eq("shopify_product_id", shopifyProductId)
    .maybeSingle();
  return Number((data as any)?.attempts ?? 0);
}

/** Fail closed: draft the product and take it off the customer channels. */
async function withdrawFromSale(shopifyProductId: string, status: string): Promise<string> {
  const { withdrawCustomerChannels } = await import("../zendrop/store-publication.server");
  let note = "";
  if (status === "active") {
    note = `store status now ${await setStoreStatus(shopifyProductId, "DRAFT")}`;
  }
  try {
    const held = await withdrawCustomerChannels(shopifyProductId);
    note = note ? `${note}; ${held.message}` : held.message;
  } catch (cause) {
    note = `${note}; ${cause instanceof Error ? cause.message : "channel withdrawal failed"}`;
  }
  return note;
}

/** Keeps the local mirror in step with what the store now holds. */
async function mirrorProduct(shopifyProductId: string): Promise<void> {
  const product = await readProduct(shopifyProductId);
  if (!product) return;
  const supabase = await zendropAdminClient();
  const { data: mirror } = await supabase
    .from("shopify_products")
    .select("id")
    .eq("shopify_product_id", shopifyProductId)
    .maybeSingle();
  const mirrorId = (mirror as any)?.id ?? null;
  if (!mirrorId) return;
  for (const variant of product.variants) {
    await supabase
      .from("shopify_product_variants")
      .update({ price: variant.price, compare_at_price: variant.compareAtPrice } as never)
      .eq("shopify_variant_id", variant.id);
  }
  const prices = product.variants.map((v) => v.price).filter((v): v is number => v !== null);
  await supabase
    .from("shopify_products")
    .update({
      status: product.status,
      price_min: prices.length ? Math.min(...prices) : null,
      price_max: prices.length ? Math.max(...prices) : null,
      compare_at_price_min: null,
      last_synced_at: new Date().toISOString(),
    } as never)
    .eq("id", mirrorId);
}

/**
 * Reads the recorded lifecycle state for a product without touching the store.
 * Every other system asks this before it is allowed to put a product on sale.
 */
export async function readLifecycleState(
  shopifyProductId: string,
): Promise<{ status: PricingLifecycleStatus; formulaVersion: string | null; verifiedAt: string | null } | null> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("product_pricing_lifecycle")
    .select("status, formula_version, verified_at")
    .eq("shopify_product_id", shopifyProductId)
    .maybeSingle();
  if (!data) return null;
  return {
    status: (data as any).status as PricingLifecycleStatus,
    formulaVersion: (data as any).formula_version ?? null,
    verifiedAt: (data as any).verified_at ?? null,
  };
}

/**
 * The single question every activation path must ask: has the pricing service
 * verified this product on the formula currently in force? Absence of evidence
 * is a no.
 */
export async function isPricingVerified(shopifyProductId: string): Promise<boolean> {
  const state = await readLifecycleState(shopifyProductId);
  return state?.status === "verified" && state.formulaVersion === PRICING_FORMULA_VERSION;
}

/**
 * Runs the lifecycle for a bounded set of store products.
 *
 * Safe to call from the intake worker on every product event, from the
 * scheduled pricing worker, and from the catalogue correction script.
 */
export async function runPricingLifecycle(options: {
  shopifyProductIds: string[];
  activate?: boolean;
  force?: boolean;
}): Promise<LifecycleRunResult> {
  const ids = Array.from(new Set(options.shopifyProductIds.filter(Boolean))).slice(0, 60);
  const requestedActivation = options.activate !== false;
  const result: LifecycleRunResult = {
    evaluated: 0,
    verified: 0,
    held: 0,
    errored: 0,
    skipped: 0,
    activated: 0,
    drafted: 0,
    outcomes: [],
    message: "",
  };
  if (ids.length === 0) {
    result.message = "There was nothing to price.";
    return result;
  }

  const { loadCanonicalPricingContext, loadShippingEvidenceForProducts, priceVariant } =
    await import("./canonical.server");
  const context = await loadCanonicalPricingContext();
  const evidenceByProduct = await loadShippingEvidenceForProducts(ids);
  const { syncApprovedFormulaVersion, activationAllowed } = await import("./gate.server");
  await syncApprovedFormulaVersion();
  // Activation is a separate, explicitly enabled decision. During a pricing
  // repair the catalogue can be corrected in full while every product stays a
  // draft, because nothing here may put stock on sale by itself.
  const policyAllowsActivation = await activationAllowed();


  for (const shopifyProductId of ids) {
    result.evaluated += 1;
    const outcome: LifecycleOutcome = {
      shopifyProductId,
      status: "pending",
      variants: 0,
      verifiedVariants: 0,
      reason: "",
      activation: null,
      publication: null,
      skipped: false,
    };

    try {
      const before = await readProduct(shopifyProductId);
      if (!before) {
        outcome.status = "error";
        outcome.reason = "The store product could not be read";
        result.errored += 1;
        await recordLifecycle({
          shopifyProductId,
          status: "error",
          reason: outcome.reason,
          attempts: (await currentAttempts(shopifyProductId)) + 1,
          nextAttemptAt: nextAttemptAt(await currentAttempts(shopifyProductId)),
        });
        result.outcomes.push(outcome);
        continue;
      }

      outcome.variants = before.variants.length;
      // Every variant is evaluated through the canonical calculation before
      // anything is written, so the fingerprint and the hold decision come
      // from exactly the same facts the price would come from.
      const quotes = evidenceByProduct.get(shopifyProductId) ?? [];
      const evaluated = before.variants.map((variant) => ({
        variant,
        priced: priceVariant({
          context,
          itemCost: variant.unitCost,
          itemCostCurrency: variant.costCurrency,
          quotes,
        }),
      }));
      const hash = pricingInputHash(
        evaluated.map((entry) => ({
          variantId: entry.variant.id,
          fingerprint: entry.priced.fingerprint,
        })),
      );


      // Loop prevention. Our own write comes back through the webhook with an
      // unchanged fingerprint and an already verified state, so there is
      // nothing to do and nothing is written to the store.
      if (
        options.force !== true &&
        before.metafields.get(PRICING_STATUS_KEY) === "verified" &&
        before.metafields.get(PRICING_VERSION_KEY) === PRICING_FORMULA_VERSION &&
        before.metafields.get(PRICING_INPUT_HASH_KEY) === hash
      ) {
        outcome.status = "verified";
        outcome.verifiedVariants = before.variants.length;
        outcome.skipped = true;
        outcome.reason = "Already verified on the current formula and the pricing inputs have not moved";
        result.skipped += 1;
        result.verified += 1;
        result.outcomes.push(outcome);
        continue;
      }

      await writeMetafields(shopifyProductId, { status: "processing", inputHash: hash });
      await recordLifecycle({
        shopifyProductId,
        status: "processing",
        reason: "Calculating and writing the approved price",
        inputHash: hash,
        variants: before.variants.length,
      });

      // A missing cost, or shipping evidence that is missing, stale or for the
      // wrong destination, is never guessed around. Delivery is free to the
      // customer, so an unproven shipping cost is an unproven price.
      const unpriceable = evaluated.filter((entry) => !entry.priced.complete);
      if (unpriceable.length > 0) {
        const attempts = (await currentAttempts(shopifyProductId)) + 1;
        outcome.status = "held";
        const first = unpriceable[0]!.priced;
        outcome.reason = `${unpriceable.length} variant(s) cannot be priced: ${first.reason ?? first.status}`;

        outcome.publication = await withdrawFromSale(shopifyProductId, before.status);
        if (before.status === "active") result.drafted += 1;
        await writeMetafields(shopifyProductId, { status: "held", inputHash: hash });
        await recordLifecycle({
          shopifyProductId,
          status: "held",
          reason: outcome.reason,
          inputHash: hash,
          variants: before.variants.length,
          attempts,
          nextAttemptAt: nextAttemptAt(attempts),
          publication: outcome.publication,
        });
        result.held += 1;
        result.outcomes.push(outcome);
        continue;
      }

      // Calculate and write. This also records the per variant calculation,
      // clears unverified compare-at prices and keeps the retry bookkeeping.
      const reprice = await repriceProducts({ shopifyProductIds: [shopifyProductId] });

      // Read back from the store. Nothing is trusted because a mutation
      // returned without an error.
      const after = await readProduct(shopifyProductId);
      const supabase = await zendropAdminClient();
      const { data: authorityRows } = await supabase
        .from("product_price_authority")
        .select("shopify_variant_id, expected_price, hold_reason")
        .eq("shopify_product_id", shopifyProductId);
      const expectedByVariant = new Map<string, number | null>(
        ((authorityRows ?? []) as any[]).map((row) => [
          String(row.shopify_variant_id),
          row.expected_price === null ? null : Number(row.expected_price),
        ]),
      );

      const problems: string[] = [];
      let verifiedVariants = 0;
      for (const variant of after?.variants ?? []) {
        const expected = expectedByVariant.get(variant.id) ?? null;
        if (expected === null) {
          problems.push(`${variant.title ?? variant.id}: no approved price was calculated`);
          continue;
        }
        if (variant.price === null || Math.abs(variant.price - expected) >= PENCE) {
          problems.push(
            `${variant.title ?? variant.id}: the store shows ${variant.price ?? "no price"} instead of ${expected.toFixed(2)}`,
          );
          continue;
        }
        if (!endsInCharm(variant.price)) {
          problems.push(`${variant.title ?? variant.id}: ${variant.price.toFixed(2)} does not end in .99`);
          continue;
        }
        if (variant.compareAtPrice !== null) {
          problems.push(`${variant.title ?? variant.id}: an unverified compare-at price is still set`);
          continue;
        }
        verifiedVariants += 1;
      }
      outcome.verifiedVariants = verifiedVariants;

      if (problems.length > 0 || reprice.failed > 0 || verifiedVariants === 0) {
        const attempts = (await currentAttempts(shopifyProductId)) + 1;
        outcome.status = "error";
        outcome.reason = problems.slice(0, 3).join("; ") || reprice.message;
        outcome.publication = await withdrawFromSale(shopifyProductId, after?.status ?? before.status);
        if ((after?.status ?? before.status) === "active") result.drafted += 1;
        await writeMetafields(shopifyProductId, { status: "error", inputHash: hash });
        await recordLifecycle({
          shopifyProductId,
          status: "error",
          reason: outcome.reason,
          inputHash: hash,
          variants: outcome.variants,
          verifiedVariants,
          attempts,
          nextAttemptAt: nextAttemptAt(attempts),
          publication: outcome.publication,
        });
        result.errored += 1;
        result.outcomes.push(outcome);
        continue;
      }

      // Verified. Only this branch may write the verified state.
      const verifiedAt = new Date().toISOString();
      await writeMetafields(shopifyProductId, { status: "verified", inputHash: hash, verifiedAt });
      outcome.status = "verified";
      outcome.reason = `${verifiedVariants} variant(s) written to the store and read back identical on ${PRICING_FORMULA_VERSION}`;

      if (requestedActivation && policyAllowsActivation && (after?.status ?? before.status) !== "archived") {
        const { blockedFromActivation } = await import("./activation-guard.server");
        const blocked = await blockedFromActivation(shopifyProductId);
        if (blocked) {
          outcome.activation = blocked;
        } else {
          if ((after?.status ?? before.status) !== "active") {
            outcome.activation = `store status now ${await setStoreStatus(shopifyProductId, "ACTIVE")}`;
            result.activated += 1;
          } else {
            outcome.activation = "already active";
          }
          const { ensureStorePublications } = await import("../zendrop/store-publication.server");
          const publication = await ensureStorePublications(shopifyProductId);
          outcome.publication = publication.message;
        }
      } else if (requestedActivation && !policyAllowsActivation) {
        outcome.activation =
          "Pricing is verified, but activation is switched off in the pricing policy, so the product was left exactly as it is";
      }


      await mirrorProduct(shopifyProductId);
      await recordLifecycle({
        shopifyProductId,
        status: "verified",
        reason: outcome.reason,
        inputHash: hash,
        verifiedAt,
        variants: outcome.variants,
        verifiedVariants,
        attempts: 0,
        nextAttemptAt: null,
        activation: outcome.activation,
        publication: outcome.publication,
      });
      result.verified += 1;
      result.outcomes.push(outcome);
    } catch (cause) {
      const attempts = (await currentAttempts(shopifyProductId)) + 1;
      outcome.status = "error";
      outcome.reason = cause instanceof Error ? cause.message : "The pricing lifecycle failed";
      result.errored += 1;
      await recordLifecycle({
        shopifyProductId,
        status: "error",
        reason: outcome.reason,
        attempts,
        nextAttemptAt: nextAttemptAt(attempts),
      });
      result.outcomes.push(outcome);
    }
  }

  result.message = `${result.evaluated} product(s): ${result.verified} verified, ${result.held} held for missing cost, ${result.errored} in error, ${result.skipped} unchanged, ${result.activated} activated, ${result.drafted} withdrawn to draft.`;
  return result;
}

/**
 * The retry pass. Picks up whatever is pending, held, in error or stuck in
 * processing and is due another bounded attempt, plus anything the catalogue
 * knows about that has never been through the lifecycle at all.
 */
export async function runPricingLifecycleRetries(limit = 20): Promise<LifecycleRunResult> {
  const supabase = await zendropAdminClient();
  const nowIso = new Date().toISOString();
  const { data: due } = await supabase
    .from("product_pricing_lifecycle")
    .select("shopify_product_id, next_attempt_at, status")
    .in("status", ["pending", "processing", "held", "error"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  const ids = ((due ?? []) as any[]).map((row) => String(row.shopify_product_id));

  if (ids.length < limit) {
    // Nothing tracked yet is treated as pending, so a new import is picked up
    // even if its webhook never arrived.
    const { data: untracked } = await supabase
      .from("shopify_products")
      .select("shopify_product_id")
      .limit(500);
    const tracked = new Set(ids);
    const { data: all } = await supabase
      .from("product_pricing_lifecycle")
      .select("shopify_product_id")
      .limit(5000);
    const known = new Set(((all ?? []) as any[]).map((row) => String(row.shopify_product_id)));
    for (const row of (untracked ?? []) as any[]) {
      const id = String(row.shopify_product_id);
      if (!known.has(id) && !tracked.has(id) && ids.length < limit) ids.push(id);
    }
  }

  return runPricingLifecycle({ shopifyProductIds: ids });
}
