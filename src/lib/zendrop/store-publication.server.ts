/**
 * Sales channel publication for products in the store.
 *
 * NUR GOODS sells on three live surfaces and the store is the checkout,
 * payment and order engine behind all of them. A verified sellable product
 * belongs on three approved channels: the headless channel that issues our
 * checkout links, the Shopify Online Store website channel, and Shop so it is
 * discoverable and trackable in the Shop app. Point of Sale stays off.
 *
 * The channel rules themselves are pure and tested in publication-policy.ts.
 * This module only talks to the store.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import {
  assertOnlyApprovedChannels,
  classifyChannel,
  DEFAULT_PUBLICATION_POLICY,
  evaluateCompliance,
  planPublicationReconciliation,
  resolveHeadlessChannel,
  selectPublicationTargets,
  type Channel,
  type ComplianceVerdict,
  type PublicationPolicy,
} from "./publication-policy";

const PUBLICATIONS_QUERY = `
  query NurGoodsPublications($id: ID!) {
    publications(first: 25) { nodes { id name } }
    product(id: $id) {
      title
      status
      resourcePublicationsV2(first: 25) { nodes { isPublished publication { id } } }
    }
  }
`;

const CHANNELS_QUERY = `
  query NurGoodsChannels {
    publications(first: 25) { nodes { id name } }
  }
`;

const PUBLISH_MUTATION = `
  mutation NurGoodsPublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

const UNPUBLISH_MUTATION = `
  mutation NurGoodsUnpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

/**
 * Reads the publication policy from the store integration settings.
 *
 * The three live selling surfaces, headless, Online Store and Shop, are all on
 * by default. Only the Online Store can be switched off, and only by an
 * explicit admin setting, because narrowing the selling path is a deliberate
 * commercial decision. Point of Sale is never configurable, so no setting can
 * turn it on.
 */
export async function loadPublicationPolicy(): Promise<PublicationPolicy> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: integration } = await (supabaseAdmin as any)
      .from("integrations")
      .select("id")
      .eq("provider", "shopify")
      .maybeSingle();
    if (!integration?.id) return DEFAULT_PUBLICATION_POLICY;
    const { data } = await (supabaseAdmin as any)
      .from("integration_settings")
      .select("value")
      .eq("integration_id", integration.id)
      .eq("key", "publication_include_online_store")
      .maybeSingle();
    const raw = data?.value;
    const value = (raw === null || raw === undefined ? "" : String(raw)).trim().toLowerCase();
    if (value === "false" || value === "off" || value === "0") {
      // Turning a live selling surface off narrows the selling path, so it is
      // recorded every time it takes effect.
      await (supabaseAdmin as any).from("integration_events").insert({
        integration_id: integration.id,
        event_type: "publication_channel_override",
        status: "warning",
        message: "Online Store publication switched off by an explicit admin setting",
        payload: {
          channel: "Online Store",
          enabled: false,
          note: "Online Store publication switched off by an explicit admin setting",
        },
      });
      return { ...DEFAULT_PUBLICATION_POLICY, includeOnlineStore: false };
    }
    return DEFAULT_PUBLICATION_POLICY;
  } catch {
    // Any doubt about the setting means the documented default.
    return DEFAULT_PUBLICATION_POLICY;
  }
}

/** Reads the store's sales channels, resolved by name at runtime. */
export async function readStoreChannels(): Promise<Channel[]> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, CHANNELS_QUERY, {});
  return (data?.publications?.nodes ?? [])
    .filter((node: any) => node?.id)
    .map((node: any) => ({ id: String(node.id), name: String(node.name ?? "") }));
}

export interface PublicationResult {
  published: string[];
  alreadyPublished: string[];
  /** Channels the product was removed from because policy does not want them. */
  unpublished: string[];
  /** Channels deliberately skipped, so the decision is visible in the log. */
  skipped: string[];
  /**
   * The store's own reason for refusing Shop publication for this product, if
   * it did. The product keeps the headless channel and is surfaced for review.
   */
  shopIneligible: string | null;
  message: string;
}

interface ProductPublicationState {
  title: string | null;
  status: string | null;
  channels: Channel[];
  publishedIds: string[];
}

async function readProductPublicationState(
  shopifyProductId: string,
): Promise<ProductPublicationState> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, PUBLICATIONS_QUERY, { id: shopifyProductId });
  const channels: Channel[] = (data?.publications?.nodes ?? [])
    .filter((node: any) => node?.id)
    .map((node: any) => ({ id: String(node.id), name: String(node.name ?? "") }));
  const publishedIds = (data?.product?.resourcePublicationsV2?.nodes ?? [])
    .filter((node: any) => node?.isPublished)
    .map((node: any) => String(node.publication?.id));
  return {
    title: data?.product?.title ?? null,
    status: typeof data?.product?.status === "string" ? data.product.status.toLowerCase() : null,
    channels,
    publishedIds,
  };
}

/**
 * Brings one product to the desired channel state.
 *
 * Publishing and unpublishing are both driven from the same idempotent plan,
 * so re-running this can never add the Point of Sale channel or any
 * unapproved channel, and a product that is already correct results in no
 * store writes.
 *
 * Product status, price, variants and inventory are never touched here.
 */
export async function ensureStorePublications(
  shopifyProductId: string,
  policy?: PublicationPolicy,
  options: { removeUnwanted?: boolean; dryRun?: boolean } = {},
): Promise<PublicationResult> {
  const effective = policy ?? (await loadPublicationPolicy());
  // Removal is destructive, so it only happens on an explicitly authorised
  // reconciliation path. Ordinary import activation publishes the approved
  // channels and never widens to a forbidden one, but it also never strips a
  // channel a human may have set deliberately.
  const removeUnwanted = options.removeUnwanted === true;
  const state = await readProductPublicationState(shopifyProductId);

  // Fails closed when the headless channel cannot be identified uniquely.
  resolveHeadlessChannel(state.channels);

  const plan = planPublicationReconciliation(state.channels, state.publishedIds, effective);
  const { excluded } = selectPublicationTargets(state.channels, effective);
  const skipped = excluded.map((entry) => entry.channel.name);
  const alreadyPublished = plan.desired
    .filter((channel) => !plan.toPublish.some((target) => target.id === channel.id))
    .map((channel) => channel.name);

  // Belt and braces: only approved channels may reach the publish mutation,
  // whatever a caller passed in as policy.
  assertOnlyApprovedChannels(plan.toPublish, effective);

  const toUnpublish = removeUnwanted ? plan.toUnpublish : [];

  if (plan.toPublish.length === 0 && toUnpublish.length === 0) {
    return {
      published: [],
      alreadyPublished,
      unpublished: [],
      skipped,
      shopIneligible: null,
      message: `Already on the approved sales channels only${
        skipped.length > 0 ? `. Left alone: ${skipped.join(", ")}` : ""
      }`,
    };
  }

  if (options.dryRun) {
    return {
      published: plan.toPublish.map((channel) => channel.name),
      alreadyPublished,
      unpublished: toUnpublish.map((channel) => channel.name),
      skipped,
      shopIneligible: null,
      message: "Dry run. No change was made in the store",
    };
  }

  const credentials = await intakeCredentials();
  const problems: string[] = [];
  const published: string[] = [];
  let shopIneligible: string | null = null;

  // Each approved channel is published on its own call. Shop can refuse an
  // individual product on eligibility grounds, and that refusal must never
  // take the headless channel down with it, so the failures are isolated.
  for (const channel of plan.toPublish) {
    const isShop = classifyChannel(channel.name) === "shop";
    let failure: string | null = null;
    try {
      const result: any = await shopifyGraphql(credentials, PUBLISH_MUTATION, {
        id: shopifyProductId,
        input: [{ publicationId: channel.id }],
      });
      const errors = (result?.publishablePublish?.userErrors ?? []).map((error: any) =>
        String(error?.message ?? "Publishing failed"),
      );
      if (errors.length > 0) failure = errors.join(" ");
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : "Publishing failed";
    }

    if (!failure) {
      published.push(channel.name);
      continue;
    }
    if (isShop) {
      // Recorded as an exception for admin review. nurgoods.com is unaffected.
      shopIneligible = failure;
      continue;
    }
    problems.push(failure);
  }

  if (problems.length === 0 && toUnpublish.length > 0) {
    const result: any = await shopifyGraphql(credentials, UNPUBLISH_MUTATION, {
      id: shopifyProductId,
      input: toUnpublish.map((channel) => ({ publicationId: channel.id })),
    });
    for (const error of result?.publishableUnpublish?.userErrors ?? []) {
      problems.push(String(error?.message ?? "Unpublishing failed"));
    }
  }

  if (problems.length > 0) {
    return {
      published,
      alreadyPublished,
      unpublished: [],
      skipped,
      shopIneligible,
      message: problems.join(" "),
    };
  }

  const parts: string[] = [];
  if (published.length > 0) parts.push(`Published to ${published.join(", ")}`);
  if (toUnpublish.length > 0)
    parts.push(`Removed from ${toUnpublish.map((c) => c.name).join(", ")}`);
  if (shopIneligible)
    parts.push(`Shop refused this product and it stays headless only: ${shopIneligible}`);
  if (skipped.length > 0) parts.push(`Left alone: ${skipped.join(", ")}`);

  return {
    published,
    alreadyPublished,
    unpublished: toUnpublish.map((channel) => channel.name),
    skipped,
    shopIneligible,
    message: parts.join(". "),
  };
}

export interface ProductPublicationReport {
  shopifyProductId: string;
  title: string | null;
  status: string | null;
  channels: Array<{ name: string; published: boolean; wanted: boolean }>;
  currentChannels: string[];
  desiredChannels: string[];
  toPublish: string[];
  toUnpublish: string[];
  drifted: boolean;
  /** Approved channels present, unapproved channels absent, exceptions apart. */
  compliance: ComplianceVerdict;
}

/**
 * Read only channel report for a single product. It never writes to the store
 * and is what the admin dry run is built from.
 */
export async function readStorePublications(
  shopifyProductId: string,
  policy?: PublicationPolicy,
  options: { shopIneligibleReason?: string | null } = {},
): Promise<ProductPublicationReport> {
  const effective = policy ?? (await loadPublicationPolicy());
  const state = await readProductPublicationState(shopifyProductId);
  const plan = planPublicationReconciliation(state.channels, state.publishedIds, effective);
  const published = new Set(state.publishedIds);
  const wanted = new Set(plan.desired.map((channel) => channel.id));
  const compliance = evaluateCompliance(plan, {
    shopIneligibleReason: options.shopIneligibleReason ?? null,
  });

  return {
    compliance,
    shopifyProductId,
    title: state.title,
    status: state.status,
    channels: state.channels.map((channel) => ({
      name: channel.name,
      published: published.has(channel.id),
      wanted: wanted.has(channel.id),
    })),
    currentChannels: plan.current.map((channel) => channel.name),
    desiredChannels: plan.desired.map((channel) => channel.name),
    toPublish: plan.toPublish.map((channel) => channel.name),
    toUnpublish: plan.toUnpublish.map((channel) => channel.name),
    drifted: !compliance.compliant,
  };
}

export interface HoldResult {
  removed: string[];
  alreadyUnpublished: boolean;
  message: string;
}

/**
 * Takes one product off every sales channel it is currently on, so it stops
 * being sellable anywhere while the reason for the hold is investigated.
 *
 * Product status, price, variants and inventory are untouched, so the listing
 * and its history survive and a later reconciliation can put it back on the
 * approved channels once the evidence is restored.
 */
export async function holdProductOffSalesChannels(
  shopifyProductId: string,
  options: { dryRun?: boolean } = {},
): Promise<HoldResult> {
  const state = await readProductPublicationState(shopifyProductId);
  const current = state.channels.filter((channel) => state.publishedIds.includes(channel.id));
  if (current.length === 0) {
    return { removed: [], alreadyUnpublished: true, message: "Already off every sales channel" };
  }
  if (options.dryRun) {
    return {
      removed: current.map((channel) => channel.name),
      alreadyUnpublished: false,
      message: "Dry run. No change was made in the store",
    };
  }

  const credentials = await intakeCredentials();
  const result: any = await shopifyGraphql(credentials, UNPUBLISH_MUTATION, {
    id: shopifyProductId,
    input: current.map((channel) => ({ publicationId: channel.id })),
  });
  const errors = (result?.publishableUnpublish?.userErrors ?? []).map((error: any) =>
    String(error?.message ?? "Unpublishing failed"),
  );
  if (errors.length > 0) {
    return { removed: [], alreadyUnpublished: false, message: errors.join(" ") };
  }
  return {
    removed: current.map((channel) => channel.name),
    alreadyUnpublished: false,
    message: `Removed from ${current.map((channel) => channel.name).join(", ")}`,
  };
}

/**
 * Withdraws one product from the two customer facing store channels, the
 * Online Store and Shop, while leaving the headless channel and Point of Sale
 * state untouched.
 *
 * This is the fail closed half of the pricing publication gate: a product that
 * arrives before its price has been calculated and verified stops being
 * sellable to customers immediately, without changing its status, price,
 * variants or inventory. A later gate pass puts it back on the approved
 * channels once pricing verifies.
 */
export async function withdrawCustomerChannels(
  shopifyProductId: string,
  options: { dryRun?: boolean } = {},
): Promise<HoldResult> {
  const state = await readProductPublicationState(shopifyProductId);
  const current = state.channels.filter(
    (channel) =>
      state.publishedIds.includes(channel.id) &&
      (classifyChannel(channel.name) === "online_store" || classifyChannel(channel.name) === "shop"),
  );
  if (current.length === 0) {
    return {
      removed: [],
      alreadyUnpublished: true,
      message: "Already off the Online Store and Shop",
    };
  }
  if (options.dryRun) {
    return {
      removed: current.map((channel) => channel.name),
      alreadyUnpublished: false,
      message: "Dry run. No change was made in the store",
    };
  }

  const credentials = await intakeCredentials();
  const result: any = await shopifyGraphql(credentials, UNPUBLISH_MUTATION, {
    id: shopifyProductId,
    input: current.map((channel) => ({ publicationId: channel.id })),
  });
  const errors = (result?.publishableUnpublish?.userErrors ?? []).map((error: any) =>
    String(error?.message ?? "Unpublishing failed"),
  );
  if (errors.length > 0) {
    return { removed: [], alreadyUnpublished: false, message: errors.join(" ") };
  }
  return {
    removed: current.map((channel) => channel.name),
    alreadyUnpublished: false,
    message: `Withdrawn from ${current.map((channel) => channel.name).join(", ")} while pricing is pending`,
  };
}
