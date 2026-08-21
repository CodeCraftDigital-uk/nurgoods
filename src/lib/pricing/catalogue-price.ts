/**
 * NUR GOODS catalogue pricing.
 *
 * One commercial rule, deliberately simple and deterministic so the admin, the
 * pricing worker and any audit always agree:
 *
 *   target after-payment revenue = unit_cost * markup      (markup 1.60 = +60%)
 *   raw price P = (unit_cost * markup + fee_fixed) / (1 - fee_variable)
 *   advertised price = smallest price ending .99 that is >= P
 *
 * The only cost input is the store's own inventory unit cost. Supplier
 * shipping is not part of catalogue pricing: deliverable stock is filtered by
 * the supplier before it ever reaches the store, and order-time safety checks
 * still cover the economics of an actual order.
 *
 * Pure, no network, safe on the client.
 */

/** Identifies the calculation behind a stored price. */
export const CATALOGUE_FORMULA_VERSION = "shopify-unitcost-markup-v4";

/** Default commercial markup on cost of goods. */
export const DEFAULT_MARKUP = 1.6;

export interface CataloguePriceInput {
  unitCost: number | null | undefined;
  /** Multiplier applied to unit cost, for example 1.6 for a 60% markup. */
  markup?: number;
  /** Proportion of the price taken by the payment provider. */
  feeVariable: number;
  /** Fixed amount taken per transaction, in the selling currency. */
  feeFixed: number;
}

export interface CataloguePrice {
  complete: boolean;
  reason: string | null;
  unitCost: number | null;
  markup: number;
  /** Revenue we intend to keep after payment fees. */
  targetRevenue: number | null;
  /** Exact price before charm rounding. */
  rawPrice: number | null;
  /** The advertised price, always rounded up to end .99. */
  price: number | null;
  expectedFee: number | null;
  expectedPayout: number | null;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Smallest price ending .99 that is not below the given price. */
export function charmUp(price: number): number {
  let charm = Math.floor(price) + 0.99;
  if (charm < price - 1e-9) charm += 1;
  return round2(charm);
}

export function computeCataloguePrice(input: CataloguePriceInput): CataloguePrice {
  const markup = typeof input.markup === "number" && input.markup > 0 ? input.markup : DEFAULT_MARKUP;
  const empty: CataloguePrice = {
    complete: false,
    reason: null,
    unitCost: null,
    markup,
    targetRevenue: null,
    rawPrice: null,
    price: null,
    expectedFee: null,
    expectedPayout: null,
  };

  const unitCost =
    typeof input.unitCost === "number" && Number.isFinite(input.unitCost) ? input.unitCost : null;
  if (unitCost === null) {
    return { ...empty, reason: "No cost of goods is recorded against this variant in the store" };
  }
  if (unitCost <= 0) {
    return {
      ...empty,
      unitCost,
      reason: "The store records a zero cost of goods, so no price can be derived",
    };
  }
  if (!(input.feeVariable >= 0 && input.feeVariable < 1)) {
    return { ...empty, unitCost, reason: "The payment fee percentage is not usable" };
  }

  const targetRevenue = round2(unitCost * markup);
  const rawPrice = (unitCost * markup + input.feeFixed) / (1 - input.feeVariable);
  const price = charmUp(rawPrice);
  const expectedFee = round2(price * input.feeVariable + input.feeFixed);
  return {
    complete: true,
    reason: null,
    unitCost,
    markup,
    targetRevenue,
    rawPrice: round2(rawPrice),
    price,
    expectedFee,
    expectedPayout: round2(price - expectedFee),
  };
}
