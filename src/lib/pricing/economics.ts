/**
 * NUR GOODS landed economics.
 *
 * Deterministic, no network, safe on the client so the admin preview and the
 * server pricing path always agree.
 *
 * The customer pays one price in pounds and UK delivery is free, so supplier
 * shipping is a cost of goods, never a shipping revenue line. Card processing
 * takes a percentage plus a fixed amount out of that single price, so the
 * price has to be solved backwards from the landed cost:
 *
 *   P - (variable_fee * P + fixed_fee) - landed_cogs = target_margin * P
 *   P = (landed_cogs + fixed_fee) / (1 - variable_fee - target_margin)
 *
 * Supplier costs are quoted in dollars while we settle in pounds, so the
 * conversion always uses a protected rate that is deliberately worse than the
 * reference rate. Nothing here invents an input: when a cost, a shipping
 * figure or an exchange rate is missing the calculation fails closed and says
 * why.
 */
import { applyRounding } from "../zendrop/pricing";

export type RoundingMode = "charm_99" | "whole" | "none";

export interface FeeModel {
  /** Proportion of the selling price taken by the payment provider. */
  variable: number;
  /** Fixed amount taken per transaction, in the selling currency. */
  fixed: number;
}

export interface EconomicsInput {
  supplierItemCost: number | null | undefined;
  supplierShippingCost: number | null | undefined;
  supplierAdditionalCost?: number | null | undefined;
  /** Reference rate from supplier currency into the selling currency. */
  referenceFxRate: number | null | undefined;
  fxBufferPct: number;
  /**
   * True when the item cost is already recorded in the selling currency, for
   * example a cost per item read back from the store. It is then added after
   * conversion so it is never converted twice.
   */
  itemCostIsSettlementCurrency?: boolean;
  targetMargin: number;
  fee: FeeModel;
  roundingMode: RoundingMode;
  promoDiscount: number;
  minPromoMargin: number;
}


export interface Economics {
  complete: boolean;
  reason: string | null;
  supplierLandedTotalSource: number | null;
  effectiveFxRate: number | null;
  protectedLandedCogs: number | null;
  /** Exact price needed to hold the target margin after fees. Unrounded. */
  requiredPrice: number | null;
  /** The price we would advertise, always rounded up from the requirement. */
  advertisedPrice: number | null;
  expectedFee: number | null;
  expectedPayout: number | null;
  expectedProfit: number | null;
  expectedMargin: number | null;
  promoPrice: number | null;
  promoProfit: number | null;
  promoMargin: number | null;
  promoWithinFloor: boolean;
}

const EMPTY: Economics = {
  complete: false,
  reason: null,
  supplierLandedTotalSource: null,
  effectiveFxRate: null,
  protectedLandedCogs: null,
  requiredPrice: null,
  advertisedPrice: null,
  expectedFee: null,
  expectedPayout: null,
  expectedProfit: null,
  expectedMargin: null,
  promoPrice: null,
  promoProfit: null,
  promoMargin: null,
  promoWithinFloor: false,
};

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The rate pricing is allowed to use. Always worse than the reference rate so
 * an adverse move between quoting and settlement cannot erase the margin.
 */
export function effectiveFxRate(reference: number, bufferPct: number): number {
  return round6(reference * (1 + bufferPct));
}

export interface RequiredPriceInput {
  landedCogs: number;
  fee: FeeModel;
  targetMargin: number;
}

/**
 * Solves the selling price that leaves the target margin after both the
 * percentage and the fixed part of the payment fee. Returns null when the
 * settings make the equation impossible, which happens as soon as the fee
 * share plus the target margin reaches or passes the whole price.
 */
export function requiredPrice(input: RequiredPriceInput): number | null {
  const denominator = 1 - input.fee.variable - input.targetMargin;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  if (input.landedCogs < 0 || input.fee.fixed < 0) return null;
  const price = (input.landedCogs + input.fee.fixed) / denominator;
  if (!Number.isFinite(price) || price <= 0) return null;
  return round6(price);
}

/** Margin left after the payment fee, expressed against the selling price. */
export function marginAtPrice(price: number, landedCogs: number, fee: FeeModel): number | null {
  if (!isNumber(price) || price <= 0) return null;
  const feeTaken = round2(price * fee.variable + fee.fixed);
  const profit = round2(price - feeTaken - landedCogs);
  return round6(profit / price);
}

export function settingsAreUsable(targetMargin: number, fee: FeeModel): boolean {
  if (!(targetMargin > 0 && targetMargin < 1)) return false;
  if (!(fee.variable >= 0 && fee.variable < 1)) return false;
  if (!(fee.fixed >= 0)) return false;
  return 1 - fee.variable - targetMargin > 0;
}

export function computeEconomics(input: EconomicsInput): Economics {
  const item = isNumber(input.supplierItemCost) ? input.supplierItemCost : null;
  const shipping = isNumber(input.supplierShippingCost) ? input.supplierShippingCost : null;
  const additional = isNumber(input.supplierAdditionalCost) ? input.supplierAdditionalCost : 0;

  if (item === null) {
    return { ...EMPTY, reason: "No supplier item cost is recorded for this variant" };
  }
  if (shipping === null) {
    return {
      ...EMPTY,
      reason: "No verified supplier shipping cost is available, so the landed cost is unknown",
    };
  }
  if (!isNumber(input.referenceFxRate) || input.referenceFxRate <= 0) {
    return { ...EMPTY, reason: "No usable exchange rate is available for the supplier currency" };
  }
  if (!(input.fxBufferPct >= 0 && input.fxBufferPct < 1)) {
    return { ...EMPTY, reason: "The configured exchange rate buffer is not a usable percentage" };
  }
  if (!settingsAreUsable(input.targetMargin, input.fee)) {
    return {
      ...EMPTY,
      reason:
        "The target gross margin and the payment fee settings leave nothing to price against, so no price can hold the target",
    };
  }

  const settled = input.itemCostIsSettlementCurrency === true;
  const landedSource = round2((settled ? 0 : item) + shipping + additional);
  const rate = effectiveFxRate(input.referenceFxRate, input.fxBufferPct);
  const landedCogs = round2(landedSource * rate + (settled ? item : 0));


  const required = requiredPrice({ landedCogs, fee: input.fee, targetMargin: input.targetMargin });
  if (required === null) {
    return {
      ...EMPTY,
      supplierLandedTotalSource: landedSource,
      effectiveFxRate: rate,
      protectedLandedCogs: landedCogs,
      reason: "No selling price can satisfy the configured target margin after fees",
    };
  }

  // Rounding is upwards only, so the advertised price can never fall under
  // the price the target margin needs.
  const advertised = applyRounding(required, input.roundingMode);
  const expectedFee = round2(advertised * input.fee.variable + input.fee.fixed);
  const expectedPayout = round2(advertised - expectedFee);
  const expectedProfit = round2(expectedPayout - landedCogs);
  const expectedMargin = round6(expectedProfit / advertised);

  const promoPrice = round2(advertised * (1 - input.promoDiscount));
  const promoFee = round2(promoPrice * input.fee.variable + input.fee.fixed);
  const promoProfit = round2(promoPrice - promoFee - landedCogs);
  const promoMargin = promoPrice > 0 ? round6(promoProfit / promoPrice) : null;

  return {
    complete: true,
    reason: null,
    supplierLandedTotalSource: landedSource,
    effectiveFxRate: rate,
    protectedLandedCogs: landedCogs,
    requiredPrice: required,
    advertisedPrice: advertised,
    expectedFee,
    expectedPayout,
    expectedProfit,
    expectedMargin,
    promoPrice,
    promoProfit,
    promoMargin,
    promoWithinFloor: promoMargin !== null && promoMargin >= input.minPromoMargin,
  };
}

export interface OrderEconomicsInput {
  grossPayment: number | null;
  paymentFee: number | null;
  payout: number | null;
  supplierCostSource: number | null;
  supplierCostSettlement: number | null;
  forecastProfit?: number | null;
}

export interface OrderEconomics {
  realisedFxRate: number | null;
  realisedProfit: number | null;
  realisedMargin: number | null;
  profitVariance: number | null;
  /** True only when every figure came from evidence rather than assumption. */
  evidenced: boolean;
  note: string | null;
}

/**
 * Reconciles what an order actually earned. The supplier cost in pounds is
 * only ever the amount genuinely charged: it is never derived from a rate we
 * chose, so an unknown settlement leaves the realised figures unknown.
 */
export function reconcileOrderEconomics(input: OrderEconomicsInput): OrderEconomics {
  const payout =
    isNumber(input.payout)
      ? input.payout
      : isNumber(input.grossPayment) && isNumber(input.paymentFee)
        ? round2(input.grossPayment - input.paymentFee)
        : null;

  const realisedFxRate =
    isNumber(input.supplierCostSettlement) &&
    isNumber(input.supplierCostSource) &&
    input.supplierCostSource > 0
      ? round6(input.supplierCostSettlement / input.supplierCostSource)
      : null;

  if (payout === null || !isNumber(input.supplierCostSettlement)) {
    return {
      realisedFxRate,
      realisedProfit: null,
      realisedMargin: null,
      profitVariance: null,
      evidenced: false,
      note: "The realised profit cannot be stated because the payout or the amount actually charged by the supplier is not yet evidenced",
    };
  }

  const realisedProfit = round2(payout - input.supplierCostSettlement);
  const realisedMargin =
    isNumber(input.grossPayment) && input.grossPayment > 0
      ? round6(realisedProfit / input.grossPayment)
      : null;

  return {
    realisedFxRate,
    realisedProfit,
    realisedMargin,
    profitVariance: isNumber(input.forecastProfit)
      ? round2(realisedProfit - input.forecastProfit)
      : null,
    evidenced: true,
    note: null,
  };
}
