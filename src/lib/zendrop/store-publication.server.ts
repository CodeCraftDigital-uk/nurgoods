/**
 * Sales channel publication for supplier imported products.
 *
 * A supplier push can land a product on the Online Store only. The NUR GOODS
 * checkout is served through the headless storefront channel, so a product
 * that is missing from that channel cannot be added to a cart and "Buy now"
 * fails with an unknown merchandise error. Publishing is therefore part of
 * the import, not a manual step.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";

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

/** Channels a saleable NUR GOODS product must appear on. */
const REQUIRED_CHANNEL_PATTERNS = [/online store/i, /headless/i, /^shop$/i];

export interface PublicationResult {
  published: string[];
  alreadyPublished: string[];
  message: string;
}

export async function ensureStorePublications(
  shopifyProductId: string,
): Promise<PublicationResult> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, PUBLICATIONS_QUERY, { id: shopifyProductId });
  const channels: Array<{ id: string; name: string }> = data?.publications?.nodes ?? [];
  const current = new Set(
    (data?.product?.resourcePublicationsV2?.nodes ?? [])
      .filter((node: any) => node?.isPublished)
      .map((node: any) => String(node.publication?.id)),
  );

  const wanted = channels.filter((channel) =>
    REQUIRED_CHANNEL_PATTERNS.some((pattern) => pattern.test(channel.name ?? "")),
  );
  const missing = wanted.filter((channel) => !current.has(channel.id));
  const alreadyPublished = wanted.filter((channel) => current.has(channel.id)).map((c) => c.name);

  if (missing.length === 0) {
    return {
      published: [],
      alreadyPublished,
      message: "Already on every required sales channel",
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
      message: errors.map((error: any) => error.message).join(" "),
    };
  }
  return {
    published: missing.map((channel) => channel.name),
    alreadyPublished,
    message: `Published to ${missing.map((channel) => channel.name).join(", ")}`,
  };
}
