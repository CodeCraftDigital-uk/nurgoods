/**
 * Sales channel policy for NUR GOODS.
 *
 * NUR GOODS at https://nurgoods.com is the only shopping and browsing
 * storefront. The store behind it exists to take payment and own the order, so
 * a product belongs on the headless channel that issues our checkout links and
 * nowhere a shopper could discover it as a competing storefront.
 *
 * Headless only checkout has been proven on a controlled product, so headless
 * only is now the default. Online Store, Shop and Point of Sale are all off
 * unless a deliberate admin opt in is recorded.
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
   * Publish to the Online Store channel as well as the headless channel.
   *
   * Off by default. Headless only checkout has been verified against a real
   * product, so the Online Store is not part of the selling path. It can be
   * turned back on by an admin setting if a future checkout change needs it.
   */
  includeOnlineStore: boolean;
  /**
   * Publish to the Shop channel. This is the Shop app marketplace surface and
   * is a second shopping storefront for our catalogue, so it is never enabled
   * from automated code.
   */
  allowShopChannel: boolean;
  /** Publish to Point of Sale. There is no physical retail, so this is off. */
  allowPointOfSale: boolean;
}

export const DEFAULT_PUBLICATION_POLICY: PublicationPolicy = {
  includeOnlineStore: false,
  allowShopChannel: false,
  allowPointOfSale: false,
};

/** The channel that serves the NUR GOODS storefront and issues checkout links. */
export const HEADLESS_CHANNEL_NAME = "Nur Goods Headless Store";

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
      excluded.push({
        channel,
        reason: policy.allowShopChannel
          ? "The Shop channel opt in is recorded but publishing there is still blocked in code"
          : "The Shop channel is a separate shopping surface and is never published to automatically",
      });
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
 * empty plan, so a repeated import or a repeated migration pass can never add
 * the Shop or Online Store channel back.
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

/**
 * Hard guard used by the publishing call. Even with an opt in recorded
 * somewhere, the Shop and Point of Sale channels never reach a publish
 * mutation from automated code. Removing this guard should require a
 * deliberate, reviewed change.
 */
export function assertNoShopChannel(channels: Channel[]): void {
  const offender = channels.find((channel) => {
    const kind = classifyChannel(channel.name);
    return kind === "shop" || kind === "point_of_sale";
  });
  if (offender) {
    throw new Error(
      `Refusing to publish to the ${offender.name} channel. NUR GOODS does not sell through the Shop channel.`,
    );
  }
}
