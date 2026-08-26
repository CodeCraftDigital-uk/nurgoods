/** Draft and unpublish active products excluded by existing safety controls. */
import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { intakeCredentials, shopifyGraphql } from "@/lib/services/shopify.server";
import { reconcileLiveCatalogue } from "@/lib/pricing/catalogue-reconcile.server";
import { holdProductOffSalesChannels } from "@/lib/zendrop/store-publication.server";

const DRAFT = `mutation($id: ID!) {
  productUpdate(product: { id: $id, status: DRAFT }) {
    product { id status }
    userErrors { message }
  }
}`;

const { data, error } = await db
  .from("shopify_products")
  .select("id, shopify_product_id, title")
  .eq("status", "active");
if (error) throw error;

const candidates: Array<{ id: string; shopify_product_id: string; title: string }> = [];
for (const product of (data ?? []) as any[]) {
  const [{ data: duplicate }, { data: intake }] = await Promise.all([
    db.from("duplicate_group_members").select("id").eq("product_id", product.id).eq("suppressed", true).limit(1),
    db.from("product_intake_records").select("id").eq("product_id", product.id).in("state", ["quarantined", "rejected", "failed"]).limit(1),
  ]);
  if ((duplicate ?? []).length > 0 || (intake ?? []).length > 0) candidates.push(product);
}

const credentials = await intakeCredentials();
const result = { candidates: candidates.length, drafted: 0, unpublished: 0, failed: 0 };
const failures: string[] = [];
for (const product of candidates) {
  try {
    const held = await holdProductOffSalesChannels(product.shopify_product_id);
    result.unpublished += held.removed.length > 0 || held.alreadyUnpublished ? 1 : 0;
    const response: any = await shopifyGraphql(credentials, DRAFT, { id: product.shopify_product_id });
    const errors = response?.productUpdate?.userErrors ?? [];
    if (errors.length > 0 || response?.productUpdate?.product?.status !== "DRAFT") {
      throw new Error(errors.map((entry: any) => entry.message).join(" ") || "Draft status was not confirmed");
    }
    result.drafted += 1;
  } catch (cause) {
    result.failed += 1;
    failures.push(`${product.title}: ${cause instanceof Error ? cause.message : "withdrawal failed"}`);
  }
}

console.log("WITHDRAW", JSON.stringify(result));
console.log("FAILURES", JSON.stringify(failures));
console.log("RECONCILE", JSON.stringify(await reconcileLiveCatalogue()));