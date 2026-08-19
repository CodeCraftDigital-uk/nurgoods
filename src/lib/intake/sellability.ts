/**
 * Sellability gate for NUR GOODS.
 *
 * A product may only be active and published to the approved sales channels
 * when we can prove, from evidence we already hold, that an order placed for
 * it can actually be fulfilled:
 *
 *   - a supplier link exists for the store product,
 *   - that link carries a variant map, so an order line can be resolved to a
 *     supplier line at order time,
 *   - the supplier facts behind it are fresh rather than indefinitely stale,
 *   - the link is not on manual hold, and
 *   - shipping to at least one of our markets (UK or USA) has been quoted by
 *     the supplier.
 *
 * The rules are pure so they can be tested directly and so no caller can
 * quietly widen them. Missing evidence always means not sellable: this gate
 * fails closed by design, because the alternative is discovering the problem
 * after a customer has paid.
 */

/**
 * Markets NUR GOODS sells into. At least one of them must be evidenced as
 * shippable: a product deliverable to only the UK, or only the USA, is still
 * sellable. Only a product deliverable to neither is held.
 */
export const REQUIRED_MARKETS = ["GB", "US"] as const;

/** How old supplier evidence may be before a listing is held. */
export const EVIDENCE_FRESHNESS_HOURS = 72;

export interface SupplierLinkFacts {
  variantMap: unknown;
  manualHold?: boolean | null;
  verifiedAt?: string | null;
  lastSupplierSyncAt?: string | null;
  supplierAvailable?: boolean | null;
}

export interface MarketEvidence {
  market: string;
  eligible: boolean;
  quotedAt?: string | null;
}

export interface SellabilityInput {
  link: SupplierLinkFacts | null;
  markets: MarketEvidence[];
  now?: Date;
  freshnessHours?: number;
  requiredMarkets?: readonly string[];
}

export interface SellabilityVerdict {
  sellable: boolean;
  /** Machine readable reasons, empty when sellable. */
  reasons: string[];
  /** One line a person can act on. */
  message: string;
}

function variantCount(map: unknown): number {
  if (Array.isArray(map)) return map.length;
  if (map && typeof map === "object") return Object.keys(map as Record<string, unknown>).length;
  return 0;
}

function hoursSince(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return (now.getTime() - at) / 3_600_000;
}

/**
 * Decides whether one product may be sellable. Anything unproven is refused,
 * so a transient read that produced no evidence holds the listing rather than
 * releasing it.
 */
export function evaluateSellability(input: SellabilityInput): SellabilityVerdict {
  const now = input.now ?? new Date();
  const freshness = input.freshnessHours ?? EVIDENCE_FRESHNESS_HOURS;
  const required = input.requiredMarkets ?? REQUIRED_MARKETS;
  const reasons: string[] = [];

  const link = input.link;
  if (!link) {
    reasons.push("no_supplier_link");
  } else {
    if (variantCount(link.variantMap) === 0) reasons.push("no_variant_map");
    if (link.manualHold === true) reasons.push("manual_hold");
    if (link.supplierAvailable === false) reasons.push("supplier_unavailable");

    const age = hoursSince(link.lastSupplierSyncAt ?? link.verifiedAt, now);
    if (age === null) reasons.push("no_supplier_verification");
    else if (age > freshness) reasons.push("supplier_evidence_stale");
  }

  const byMarket = new Map(
    input.markets.map((entry) => [entry.market.trim().toUpperCase(), entry] as const),
  );
  /**
   * One evidenced market is enough. We still record why each other market did
   * not qualify, so an operator can see UK only or USA only coverage, but that
   * detail never holds the listing on its own.
   */
  const marketDetail: string[] = [];
  let anyShippable = false;
  for (const market of required) {
    const evidence = byMarket.get(market.toUpperCase());
    if (!evidence) marketDetail.push(`no_shipping_evidence_${market.toLowerCase()}`);
    else if (!evidence.eligible) marketDetail.push(`not_shippable_${market.toLowerCase()}`);
    else anyShippable = true;
  }
  if (!anyShippable) reasons.push("no_shippable_market", ...marketDetail);

  const sellable = reasons.length === 0;
  return {
    sellable,
    reasons,
    message: sellable
      ? "Supplier mapping is complete and shipping is evidenced for at least one market"
      : `Held because ${reasons.join(", ").replace(/_/g, " ")}`,
  };
}
