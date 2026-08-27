/**
 * Stamps three surface publication evidence on the mirror.
 *
 * The storefront projection only publishes a product it can prove is live on
 * the Online Store, the Shop channel and the headless store. This walk reads
 * that state back from the store, product by product, and records the proof
 * (or removes a stale one). Read only against the store.
 *
 *   bun scripts/ops/verify-channels.ts [batchSize]
 */
const batchSize = Number(process.argv[2] ?? "40") || 40;

const { zendropAdminClient } = await import("@/lib/zendrop/client.server");
const { readStorePublications, loadPublicationPolicy } = await import(
  "@/lib/zendrop/store-publication.server"
);

const supabase = await zendropAdminClient();
const policy = await loadPublicationPolicy();

const { data } = await supabase
  .from("shopify_products")
  .select("id, shopify_product_id, title")
  .eq("status", "active")
  .order("shopify_product_id", { ascending: true });

const rows = (data ?? []) as Array<{ id: string; shopify_product_id: string; title: string | null }>;
console.log(`Checking ${rows.length} active mirror products in batches of ${batchSize}.`);

let verified = 0;
let drifted = 0;
let failed = 0;

for (let index = 0; index < rows.length; index += batchSize) {
  const slice = rows.slice(index, index + batchSize);
  for (const row of slice) {
    try {
      const report = await readStorePublications(row.shopify_product_id, policy);
      const ok = report.status?.toLowerCase() === "active" && report.compliance.compliant;
      await supabase
        .from("shopify_products")
        .update({ channels_verified_at: ok ? new Date().toISOString() : null } as never)
        .eq("id", row.id);
      if (ok) verified += 1;
      else drifted += 1;
    } catch (cause) {
      failed += 1;
      console.log(`FAILED ${row.shopify_product_id}: ${cause instanceof Error ? cause.message : cause}`);
    }
  }
  console.log(`  ${Math.min(index + batchSize, rows.length)}/${rows.length} checked`);
}

console.log(JSON.stringify({ verified, drifted, failed }, null, 2));

const { refreshStorefrontSnapshot } = await import("@/lib/automation/snapshot.server");
console.log(
  JSON.stringify(await refreshStorefrontSnapshot(supabase, "channel_verification_sweep"), null, 2),
);
