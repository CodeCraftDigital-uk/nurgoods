/**
 * Post activation catalogue reconciliation.
 *
 * Runs existing jobs only. It never sources new products and never touches
 * orders or fulfilment.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAutomationJob } from "@/lib/automation/runner.server";

const ctx = { supabase: supabaseAdmin as never, userId: null };

const sequence: string[] = [
  "shopify_catalogue_sync",
  "supplier_link_recovery",
  "sellability_hold_sweep",
  "price_authority_sync",
  "price_authority_sync",
  "price_authority_sync",
  "storefront_snapshot_refresh",
];

for (const jobKey of sequence) {
  const started = Date.now();
  try {
    const result = await runAutomationJob(ctx, jobKey);
    console.log(
      JSON.stringify({ jobKey, ms: Date.now() - started, status: result.status, message: result.message, details: result.details }),
    );
  } catch (cause) {
    console.log(
      JSON.stringify({ jobKey, ms: Date.now() - started, status: "threw", message: cause instanceof Error ? cause.message : String(cause) }),
    );
  }
}
