/**
 * Deterministic pricing maths. No AI, no network, safe on the client so the
 * admin preview and the server import path always agree.
 *
 * Gross margin is margin on the selling price, never a markup on cost:
 *   selling_price = landed_cost / (1 - target_margin)
 */
import type { PricingBreakdown, PricingSettings } from "./types";

export const DEFAULT_PRICING: PricingSettings = {
  pricing_mode: "target_gross_margin",
  target_margin: 0.6,
  rounding_mode: "charm_99",
  min_promo_margin: 0.35,
  promo_discount: 0.2,
  shipping_market: "GB",
  currency: "GBP",
  allow_incomplete_pricing: false,
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Rounds up only, so a rounded price can never fall under the margin floor. */
export function applyRounding(price: number, mode: PricingSettings["rounding_mode"]): number {
  if (mode === "none") return round2(price);
  if (mode === "whole") return Math.ceil(price - 1e-9);
  let charm = Math.floor(price) + 0.99;
  if (charm < price - 1e-9) charm += 1;
  return round2(charm);
}

export function computePricing(input: {
  supplierCost: number | null | undefined;
  shippingCost: number | null | undefined;
  suggestedRetail?: number | null | undefined;
  settings: PricingSettings;
}): PricingBreakdown {
  const settings = input.settings;
  const supplierCost = typeof input.supplierCost === "number" ? input.supplierCost : null;
  const shippingCost = typeof input.shippingCost === "number" ? input.shippingCost : null;
  const suggestedRetail =
    typeof input.suggestedRetail === "number" ? input.suggestedRetail : null;

  const base: PricingBreakdown = {
    supplierCost,
    shippingCost,
    landedCost: null,
    targetMargin: settings.target_margin,
    price: null,
    suggestedRetail,
    grossProfit: null,
    grossMargin: null,
    promoDiscount: settings.promo_discount,
    promoPrice: null,
    promoMargin: null,
    promoWithinFloor: false,
    complete: false,
    reason: null,
  };

  if (supplierCost === null) {
    return { ...base, reason: "Supplier cost is not available for this product" };
  }
  if (shippingCost === null) {
    return {
      ...base,
      reason: `Shipping cost to ${settings.shipping_market} is not available, so pricing is incomplete`,
    };
  }
  if (settings.target_margin <= 0 || settings.target_margin >= 1) {
    return { ...base, reason: "The target gross margin must be between 0 and 100 percent" };
  }

  const landedCost = round2(supplierCost + shippingCost);
  const raw = landedCost / (1 - settings.target_margin);
  const price = applyRounding(raw, settings.rounding_mode);
  const grossProfit = round2(price - landedCost);
  const grossMargin = price > 0 ? grossProfit / price : 0;

  const promoPrice = round2(price * (1 - settings.promo_discount));
  const promoProfit = round2(promoPrice - landedCost);
  const promoMargin = promoPrice > 0 ? promoProfit / promoPrice : 0;

  return {
    ...base,
    landedCost,
    price,
    grossProfit,
    grossMargin,
    promoPrice,
    promoMargin,
    promoWithinFloor: promoMargin >= settings.min_promo_margin,
    complete: true,
    reason: null,
  };
}

export function formatMoney(value: number | null | undefined, currency = "GBP"): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "Not available";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "Not available";
  return `${(value * 100).toFixed(1)}%`;
}
