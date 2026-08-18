/**
 * Sales channel publication for supplier imported products.
 *
 * NUR GOODS is the only shopping and browsing storefront. The store behind it
 * is the checkout, payment and order engine. A product therefore has to be on
 * the headless sales channel that issues our checkout links, or "Buy now"
 * fails with an unknown merchandise error, and it must never be pushed onto
 * the Shop channel, which is a competing shopping surface.
 *
 * The channel rules themselves are pure and tested in publication-policy.ts.
 * This module only talks to the store.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import {
  assertNoShopChannel,
  DEFAULT_PUBLICATION_POLICY,
  selectPublicationTargets,
  type Channel,
  type PublicationPolicy,
} from "./publication-policy";

const PUBLICATIONS_QUERY = `
  query NurGoodsPublications($id: ID!) {
    publications(first: 25) { nodes { id name } }
    product(id: $id) {
      resourcePublicationsV2(first: 25) { nodes { isPublished publication { id } } }
    }
  }
`;

const PUBLISH_MUTATION = `
  mutation NurGoodsPublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

export interface PublicationResult {
  published: string[];
  alreadyPublished: string[];
  /** Channels deliberately skipped, so the decision is visible in the log. */
  skipped: string[];
  message: string;
}

export async function ensureStorePublications(
  shopifyProductId: string,
  policy: PublicationPolicy = DEFAULT_PUBLICATION_POLICY,
): Promise<PublicationResult> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, PUBLICATIONS_QUERY, { id: shopifyProductId });
  const channels: Channel[] = (data?.publications?.nodes ?? [])
    .filter((node: any) => node?.id)
    .map((node: any) => ({ id: String(node.id), name: String(node.name ?? "") }));

  const current = new Set(
    (data?.product?.resourcePublicationsV2?.nodes ?? [])
      .filter((node: any) => node?.isPublished)
      .map((node: any) => String(node.publication?.id)),
  );

  const { targets, excluded } = selectPublicationTargets(channels, policy);
  // Belt and braces: nothing classified as the Shop channel may reach the
  // publish mutation, whatever a caller passed in as policy.
  assertNoShopChannel(targets);

  const missing = targets.filter((channel) => !current.has(channel.id));
  const alreadyPublished = targets.filter((channel) => current.has(channel.id)).map((c) => c.name);
  const skipped = excluded.map((entry) => entry.channel.name);

  if (missing.length === 0) {
    return {
      published: [],
      alreadyPublished,
      skipped,
      message: `Already on every required sales channel${
        skipped.length > 0 ? `. Left alone: ${skipped.join(", ")}` : ""
      }`,
    };
  }

  const result: any = await shopifyGraphql(credentials, PUBLISH_MUTATION, {
    id: shopifyProductId,
    input: missing.map((channel) => ({ publicationId: channel.id })),
  });
  const errors = result?.publishablePublish?.userErrors ?? [];
  if (errors.length > 0) {
    return {
      published: [],
      alreadyPublished,
      skipped,
      message: errors.map((error: any) => error.message).join(" "),
    };
  }
  return {
    published: missing.map((channel) => channel.name),
    alreadyPublished,
    skipped,
    message: `Published to ${missing.map((channel) => channel.name).join(", ")}${
      skipped.length > 0 ? `. Left alone: ${skipped.join(", ")}` : ""
    }`,
  };
}

/**
 * Read only channel report for a single product. Used to prove the effect of a
 * publication change on one controlled product before anything is done in
 * bulk. It never writes to the store.
 */
export async function readStorePublications(shopifyProductId: string): Promise<{
  channels: Array<{ name: string; published: boolean; wanted: boolean }>;
}> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, PUBLICATIONS_QUERY, { id: shopifyProductId });
  const channels: Channel[] = (data?.publications?.nodes ?? [])
    .filter((node: any) => node?.id)
    .map((node: any) => ({ id: String(node.id), name: String(node.name ?? "") }));
  const current = new Set(
    (data?.product?.resourcePublicationsV2?.nodes ?? [])
      .filter((node: any) => node?.isPublished)
      .map((node: any) => String(node.publication?.id)),
  );
  const wanted = new Set(selectPublicationTargets(channels).targets.map((c) => c.id));
  return {
    channels: channels.map((channel) => ({
      name: channel.name,
      published: current.has(channel.id),
      wanted: wanted.has(channel.id),
    })),
  };
}
