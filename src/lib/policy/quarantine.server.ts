/**
 * Prohibited category quarantine.
 *
 * Scans the mirrored catalogue for products that fall into a prohibited
 * category, removes them from every sales channel, sets the store record to
 * draft so it cannot be bought, and quarantines the intake record so no
 * automatic path can republish it. Supplier linkage and audit history are
 * kept: the product is made unreachable, not erased.
 */
import { screenProhibitedRow, type ProhibitedMatch } from "./prohibited";
import { intakeCredentials, shopifyGraphql } from "@/lib/services/shopify.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const UNPUBLISH_QUERY = `
  query NurGoodsProductChannels($id: ID!) {
    product(id: $id) {
      id
      status
      resourcePublicationsV2(first: 25) { nodes { isPublished publication { id name } } }
    }
  }
`;

const UNPUBLISH_MUTATION = `
  mutation NurGoodsUnpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) { userErrors { field message } }
  }
`;

const DRAFT_MUTATION = `
  mutation NurGoodsDraft($input: ProductInput!) {
    productUpdate(input: $input) { product { id status } userErrors { field message } }
  }
`;

export interface QuarantineEntry {
  productId: string | null;
  shopifyProductId: string | null;
  title: string | null;
  handle: string | null;
  reason: string;
  terms: string[];
  unpublishedFrom: string[];
  statusBefore: string | null;
  statusAfter: string | null;
  error: string | null;
}

export interface QuarantineReport {
  scanned: number;
  flagged: number;
  quarantined: number;
  alreadyQuarantined: number;
  failures: number;
  entries: QuarantineEntry[];
}

interface MirrorRow {
  id: string;
  shopify_product_id: string | null;
  title: string | null;
  handle: string | null;
  status: string | null;
  description: string | null;
  product_type: string | null;
  vendor: string | null;
  tags: string[] | null;
}

/** Reads every mirrored product and returns the prohibited matches. */
export async function scanProhibitedCatalogue(): Promise<{
  scanned: number;
  matches: Array<{ row: MirrorRow; match: ProhibitedMatch }>;
}> {
  const db = supabaseAdmin as any;
  const rows: MirrorRow[] = [];
  const pageSize = 500;
  for (let page = 0; page < 40; page += 1) {
    const { data, error } = await db
      .from("shopify_products")
      .select("id, shopify_product_id, title, handle, status, description, product_type, vendor, tags")
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as MirrorRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  const matches = rows
    .map((row) => ({ row, match: screenProhibitedRow(row) }))
    .filter((entry) => entry.match.prohibited);
  return { scanned: rows.length, matches };
}

async function unpublishAndDraft(
  shopifyProductId: string,
): Promise<{ channels: string[]; statusBefore: string | null; statusAfter: string | null }> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, UNPUBLISH_QUERY, { id: shopifyProductId });
  const statusBefore = data?.product?.status ?? null;
  const live: Array<{ id: string; name: string }> = (
    data?.product?.resourcePublicationsV2?.nodes ?? []
  )
    .filter((node: any) => node?.isPublished && node?.publication?.id)
    .map((node: any) => ({ id: String(node.publication.id), name: String(node.publication.name ?? "") }));

  if (live.length > 0) {
    const result: any = await shopifyGraphql(credentials, UNPUBLISH_MUTATION, {
      id: shopifyProductId,
      input: live.map((channel) => ({ publicationId: channel.id })),
    });
    const errors = result?.publishableUnpublish?.userErrors ?? [];
    if (errors.length > 0) throw new Error(errors.map((e: any) => e.message).join(" "));
  }

  const draft: any = await shopifyGraphql(credentials, DRAFT_MUTATION, {
    input: { id: shopifyProductId, status: "DRAFT" },
  });
  const draftErrors = draft?.productUpdate?.userErrors ?? [];
  if (draftErrors.length > 0) throw new Error(draftErrors.map((e: any) => e.message).join(" "));

  return {
    channels: live.map((channel) => channel.name),
    statusBefore,
    statusAfter: draft?.productUpdate?.product?.status ?? "DRAFT",
  };
}

/**
 * Quarantines every prohibited product found in the catalogue. Safe to run
 * repeatedly: a product already drafted and quarantined is counted and left
 * alone.
 */
export async function quarantineProhibitedCatalogue(options?: {
  dryRun?: boolean;
}): Promise<QuarantineReport> {
  const db = supabaseAdmin as any;
  const { scanned, matches } = await scanProhibitedCatalogue();
  const report: QuarantineReport = {
    scanned,
    flagged: matches.length,
    quarantined: 0,
    alreadyQuarantined: 0,
    failures: 0,
    entries: [],
  };

  for (const { row, match } of matches) {
    const entry: QuarantineEntry = {
      productId: row.id,
      shopifyProductId: row.shopify_product_id,
      title: row.title,
      handle: row.handle,
      reason: match.reason ?? "Prohibited category",
      terms: match.terms,
      unpublishedFrom: [],
      statusBefore: row.status,
      statusAfter: row.status,
      error: null,
    };

    if (options?.dryRun) {
      report.entries.push(entry);
      continue;
    }

    try {
      if (row.shopify_product_id) {
        const outcome = await unpublishAndDraft(row.shopify_product_id);
        entry.unpublishedFrom = outcome.channels;
        entry.statusBefore = outcome.statusBefore ?? row.status;
        entry.statusAfter = outcome.statusAfter;
      }

      await db
        .from("shopify_products")
        .update({ status: "draft", available_for_sale: false } as never)
        .eq("id", row.id);

      const { data: record } = await db
        .from("product_intake_records")
        .select("id, state")
        .eq("shopify_product_id", row.shopify_product_id ?? "")
        .maybeSingle();

      if (record) {
        if ((record as any).state === "quarantined") report.alreadyQuarantined += 1;
        await db
          .from("product_intake_records")
          .update({
            state: "quarantined",
            previous_state: (record as any).state,
            reason_code: "prohibited_category",
            reason: entry.reason,
            last_transition_at: new Date().toISOString(),
          } as never)
          .eq("id", (record as any).id);
      } else if (row.shopify_product_id) {
        await db.from("product_intake_records").insert({
          shopify_product_id: row.shopify_product_id,
          product_id: row.id,
          title: row.title,
          handle: row.handle,
          source: "manual",
          state: "quarantined",
          reason_code: "prohibited_category",
          reason: entry.reason,
        } as never);
      }

      report.quarantined += 1;
    } catch (cause) {
      entry.error = cause instanceof Error ? cause.message : "Quarantine failed";
      report.failures += 1;
    }

    report.entries.push(entry);
  }

  return report;
}
