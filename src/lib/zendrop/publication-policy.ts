/**
 * Sales channel policy for NUR GOODS.
 *
 * NUR GOODS is the only shopping and browsing storefront. The store behind it
 * exists to take payment and own the order, so a product should appear on the
 * headless channel that serves our checkout and nowhere a shopper could
 * discover it as a competing storefront.
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
   * This stays on until a controlled product has proven that a headless only
   * product still produces a working checkout link. Removing it before that is
   * proven would break buying, so the default fails safe.
   */
  includeOnlineStore: boolean;
  /**
   * Publish to the Shop channel. This is the Shop app marketplace surface and
   * is a second shopping storefront for our catalogue, so it is off unless a
   * human explicitly opts in.
   */
  allowShopChannel: boolean;
}

export const DEFAULT_PUBLICATION_POLICY: PublicationPolicy = {
  includeOnlineStore: true,
  allowShopChannel: false,
};

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
    excluded.push({
      channel,
      reason: `${channel.name} is not part of the NUR GOODS selling path`,
    });
  }

  return { targets, excluded };
}

/**
 * Hard guard used by the publishing call. Even with an opt in recorded
 * somewhere, the Shop channel never reaches a publish mutation from automated
 * code. Removing this guard should require a deliberate, reviewed change.
 */
export function assertNoShopChannel(channels: Channel[]): void {
  const offender = channels.find((channel) => classifyChannel(channel.name) === "shop");
  if (offender) {
    throw new Error(
      `Refusing to publish to the ${offender.name} channel. NUR GOODS does not sell through the Shop channel.`,
    );
  }
}
