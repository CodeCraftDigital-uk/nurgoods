/**
 * Sales channel publication for products in the store.
 *
 * NUR GOODS is the only shopping and browsing storefront. The store behind it
 * is the checkout, payment and order engine. Headless only publication has
 * been proven against a real product, so a product belongs on the headless
 * sales channel that issues our checkout links and on nothing else.
 *
 * The channel rules themselves are pure and tested in publication-policy.ts.
 * This module only talks to the store.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import {
  assertNoShopChannel,
  DEFAULT_PUBLICATION_POLICY,
  planPublicationReconciliation,
  resolveHeadlessChannel,
  selectPublicationTargets,
  type Channel,
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
 * Only the Online Store switch is configurable, and it defaults to off now
 * that headless only checkout is proven. The Shop and Point of Sale channels
 * are never configurable, so no setting can turn them on.
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
    const value = (data?.value ?? "").toString().trim().toLowerCase();
    if (value === "true" || value === "on" || value === "1") {
      return { ...DEFAULT_PUBLICATION_POLICY, includeOnlineStore: true };
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
 * so re-running this can never add the Shop or Online Store channel back, and
 * a product that is already correct results in no store writes at all.
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
  // reconciliation path. Ordinary import activation publishes the headless
  // channel and never widens to a forbidden one, but it also never strips a
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

  // Belt and braces: nothing classified as Shop or Point of Sale may reach the
  // publish mutation, whatever a caller passed in as policy.
  assertNoShopChannel(plan.toPublish);

  const toUnpublish = removeUnwanted ? plan.toUnpublish : [];

  if (plan.toPublish.length === 0 && toUnpublish.length === 0) {
    return {
      published: [],
      alreadyPublished,
      unpublished: [],
      skipped,
      message: `Already on the required sales channels only${
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
      message: "Dry run. No change was made in the store",
    };
  }

  const credentials = await intakeCredentials();
  const problems: string[] = [];

  if (plan.toPublish.length > 0) {
    const result: any = await shopifyGraphql(credentials, PUBLISH_MUTATION, {
      id: shopifyProductId,
      input: plan.toPublish.map((channel) => ({ publicationId: channel.id })),
    });
    for (const error of result?.publishablePublish?.userErrors ?? []) {
      problems.push(String(error?.message ?? "Publishing failed"));
    }
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
      published: [],
      alreadyPublished,
      unpublished: [],
      skipped,
      message: problems.join(" "),
    };
  }

  const parts: string[] = [];
  if (plan.toPublish.length > 0)
    parts.push(`Published to ${plan.toPublish.map((c) => c.name).join(", ")}`);
  if (toUnpublish.length > 0)
    parts.push(`Removed from ${toUnpublish.map((c) => c.name).join(", ")}`);
  if (skipped.length > 0) parts.push(`Left alone: ${skipped.join(", ")}`);

  return {
    published: plan.toPublish.map((channel) => channel.name),
    alreadyPublished,
    unpublished: toUnpublish.map((channel) => channel.name),
    skipped,
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
}

/**
 * Read only channel report for a single product. It never writes to the store
 * and is what the admin dry run is built from.
 */
export async function readStorePublications(
  shopifyProductId: string,
  policy?: PublicationPolicy,
): Promise<ProductPublicationReport> {
  const effective = policy ?? (await loadPublicationPolicy());
  const state = await readProductPublicationState(shopifyProductId);
  const plan = planPublicationReconciliation(state.channels, state.publishedIds, effective);
  const published = new Set(state.publishedIds);
  const wanted = new Set(plan.desired.map((channel) => channel.id));

  return {
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
    drifted: !plan.compliant,
  };
}
