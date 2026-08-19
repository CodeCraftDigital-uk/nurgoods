/**
 * Sales channel policy for NUR GOODS.
 *
 * NUR GOODS at https://nurgoods.com is the only browsing storefront we run
 * ourselves, and the store behind it takes payment and owns the order. Two
 * sales channels are approved for an active sellable product:
 *
 *   - the NUR GOODS headless channel, which serves nurgoods.com and issues our
 *     checkout links, and
 *   - Shop, so the catalogue is discoverable, orderable and trackable inside
 *     the Shop app.
 *
 * The Shopify Online Store website channel and Point of Sale stay off, as does
 * any channel we have not deliberately approved.
 *
 * The rules live here as pure functions with no network access so they can be
 * tested directly and so no call site can quietly widen them.
 */

export type ChannelKind = "headless" | "online_store" | "shop" | "point_of_sale" | "other";

export interface Channel {
  id: string;
  name: string;
}

export interface PublicationPolicy {
  /**
   * Publish to the Online Store website channel.
   *
   * Off by default. NUR GOODS is the only browsing storefront we operate, so
   * the Online Store exists purely to carry checkout. It can be turned back on
   * by an explicit admin setting if a future checkout change needs it.
   */
  includeOnlineStore: boolean;
  /**
   * Publish to Shop, the Shop app marketplace surface. On by default: the
   * merchant wants the catalogue discoverable and trackable there.
   */
  includeShopChannel: boolean;
  /** Publish to Point of Sale. There is no physical retail, so this is off. */
  allowPointOfSale: boolean;
}

export const DEFAULT_PUBLICATION_POLICY: PublicationPolicy = {
  includeOnlineStore: false,
  includeShopChannel: true,
  allowPointOfSale: false,
};

/** The channel that serves the NUR GOODS storefront and issues checkout links. */
export const HEADLESS_CHANNEL_NAME = "Nur Goods Headless Store";
/** The Shop app marketplace channel. */
export const SHOP_CHANNEL_NAME = "Shop";

/** Human readable description of the approved steady state. */
export const APPROVED_CHANNELS_LABEL = `${HEADLESS_CHANNEL_NAME} + ${SHOP_CHANNEL_NAME}`;

/** Classifies a store channel by its name, which is the only stable signal. */
export function classifyChannel(name: string | null | undefined): ChannelKind {
  const value = (name ?? "").trim().toLowerCase();
  if (!value) return "other";
  if (value.includes("headless")) return "headless";
  if (value === "online store") return "online_store";
  if (value === "shop" || value === "shop app") return "shop";
  if (value.includes("point of sale")) return "point_of_sale";
  return "other";
}

/**
 * Resolves the headless publication by identity at runtime.
 *
 * Publication ids differ per store and per environment, so none is ever
 * hardcoded. If the headless channel cannot be identified, or more than one
 * candidate exists, this fails closed rather than guessing, because guessing
 * would either break checkout or expose a second storefront.
 */
export function resolveHeadlessChannel(channels: Channel[]): Channel {
  const matches = channels.filter((channel) => classifyChannel(channel.name) === "headless");
  if (matches.length === 0) {
    throw new Error(
      `The ${HEADLESS_CHANNEL_NAME} sales channel could not be found in the store, so publication was not changed.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `More than one headless sales channel was found (${matches
        .map((channel) => channel.name)
        .join(", ")}), so publication was not changed.`,
    );
  }
  return matches[0]!;
}

/**
 * Resolves the Shop publication by identity. Shop is required but, unlike the
 * headless channel, a missing or ambiguous Shop channel is not fatal: the
 * storefront keeps working, so the caller reports it instead of refusing to
 * publish anything at all.
 */
export function resolveShopChannel(channels: Channel[]): Channel | null {
  const matches = channels.filter((channel) => classifyChannel(channel.name) === "shop");
  if (matches.length !== 1) return null;
  return matches[0]!;
}

/** The channels an active sellable product must end up on. */
export function resolveRequiredChannels(
  channels: Channel[],
  policy: PublicationPolicy = DEFAULT_PUBLICATION_POLICY,
): Channel[] {
  const required = [resolveHeadlessChannel(channels)];
  if (policy.includeShopChannel) {
    const shop = resolveShopChannel(channels);
    if (shop) required.push(shop);
  }
  return required;
}

export interface PublicationSelection {
  /** Channels the product should be published to. */
  targets: Channel[];
  /** Channels deliberately left alone, with the reason, for the audit trail. */
  excluded: Array<{ channel: Channel; reason: string }>;
}

/**
 * Chooses the channels a product should be published to. A channel is only
 * ever included when the policy names it, so an unknown or newly added channel
 * is excluded rather than picked up by accident.
 */
export function selectPublicationTargets(
  channels: Channel[],
  policy: PublicationPolicy = DEFAULT_PUBLICATION_POLICY,
): PublicationSelection {
  // Fails closed if the headless channel is missing or ambiguous.
  resolveHeadlessChannel(channels);
  const shop = resolveShopChannel(channels);

  const targets: Channel[] = [];
  const excluded: Array<{ channel: Channel; reason: string }> = [];

  for (const channel of channels) {
    const kind = classifyChannel(channel.name);
    if (kind === "headless") {
      targets.push(channel);
      continue;
    }
    if (kind === "online_store") {
      if (policy.includeOnlineStore) targets.push(channel);
      else
        excluded.push({
          channel,
          reason: "NUR GOODS is the only browsing storefront, so the Online Store is not used",
        });
      continue;
    }
    if (kind === "shop") {
      if (policy.includeShopChannel && shop && shop.id === channel.id) {
        targets.push(channel);
      } else {
        excluded.push({
          channel,
          reason: shop
            ? "Shop publication is switched off by policy"
            : "More than one Shop channel was found, so none was selected",
        });
      }
      continue;
    }
    if (kind === "point_of_sale") {
      excluded.push({
        channel,
        reason: policy.allowPointOfSale
          ? "Point of Sale opt in is recorded but there is no physical retail, so it is skipped"
          : "There is no physical retail, so Point of Sale is never published to",
      });
      continue;
    }
    excluded.push({
      channel,
      reason: `${channel.name} is not part of the NUR GOODS selling path`,
    });
  }

  return { targets, excluded };
}

export interface ReconciliationPlan {
  /** Channels the product should end up on. */
  desired: Channel[];
  /** Channels it is on right now, whether wanted or not. */
  current: Channel[];
  /** Wanted channels it is missing from. */
  toPublish: Channel[];
  /** Unwanted channels it is currently on and should be removed from. */
  toUnpublish: Channel[];
  /** True when the product already matches the desired state exactly. */
  compliant: boolean;
}

/**
 * Works out the exact difference between where a product is published and
 * where policy says it should be.
 *
 * The plan is idempotent: running it again on a compliant product produces an
 * empty plan, so a repeated import or a repeated reconciliation pass makes no
 * store writes at all.
 */
export function planPublicationReconciliation(
  channels: Channel[],
  publishedChannelIds: Iterable<string>,
  policy: PublicationPolicy = DEFAULT_PUBLICATION_POLICY,
): ReconciliationPlan {
  const published = new Set(Array.from(publishedChannelIds, (id) => String(id)));
  const { targets } = selectPublicationTargets(channels, policy);
  const wanted = new Set(targets.map((channel) => channel.id));

  const current = channels.filter((channel) => published.has(channel.id));
  const toPublish = targets.filter((channel) => !published.has(channel.id));
  const toUnpublish = current.filter((channel) => !wanted.has(channel.id));

  return {
    desired: targets,
    current,
    toPublish,
    toUnpublish,
    compliant: toPublish.length === 0 && toUnpublish.length === 0,
  };
}

export interface ComplianceVerdict {
  /** Approved channels the product is missing from, excluding known exceptions. */
  missingRequired: string[];
  /** Channels it is on that policy does not approve. */
  disallowedPresent: string[];
  /**
   * Set when Shop is the only missing channel and the store itself refused the
   * publication. This is an exception for review, not accidental drift.
   */
  shopException: string | null;
  /** True when both required channels are on and nothing disallowed is. */
  compliant: boolean;
}

/**
 * The single definition of compliance for an active sellable product: every
 * approved channel present, nothing unapproved present. A Shop refusal from
 * the store is reported separately so it is never mistaken for drift we caused
 * and never triggers a pointless retry loop.
 */
export function evaluateCompliance(
  plan: ReconciliationPlan,
  options: { shopIneligibleReason?: string | null } = {},
): ComplianceVerdict {
  const reason = options.shopIneligibleReason ?? null;
  const missing = plan.toPublish.filter(
    (channel) => !(reason && classifyChannel(channel.name) === "shop"),
  );
  const shopException =
    reason && plan.toPublish.some((channel) => classifyChannel(channel.name) === "shop")
      ? reason
      : null;

  return {
    missingRequired: missing.map((channel) => channel.name),
    disallowedPresent: plan.toUnpublish.map((channel) => channel.name),
    shopException,
    compliant: missing.length === 0 && plan.toUnpublish.length === 0,
  };
}

/**
 * Hard guard used by the publishing call. Whatever a caller passes in as
 * policy, only approved channels may reach a publish mutation. Point of Sale
 * and unrecognised channels are always refused, and the Online Store is
 * refused unless the deliberate opt in is in force.
 */
export function assertOnlyApprovedChannels(
  channels: Channel[],
  policy: PublicationPolicy = DEFAULT_PUBLICATION_POLICY,
): void {
  const offender = channels.find((channel) => {
    const kind = classifyChannel(channel.name);
    if (kind === "headless") return false;
    if (kind === "shop") return !policy.includeShopChannel;
    if (kind === "online_store") return !policy.includeOnlineStore;
    return true;
  });
  if (offender) {
    throw new Error(
      `Refusing to publish to the ${offender.name} channel. NUR GOODS only sells through ${APPROVED_CHANNELS_LABEL}.`,
    );
  }
}
