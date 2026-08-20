/**
 * Storefront projection maintenance.
 *
 * Customer facing pages read `storefront_snapshot` only. This job rebuilds
 * that projection from the local mirror and records the verified checkout
 * state, so no page render ever contacts the store, the supplier or a model.
 *
 * The rebuild is a single transactional database function: it either replaces
 * the projection completely or leaves the previous one in place, so a half
 * built catalogue can never reach a customer.
 */
import type { JobRunResult } from "./runner.server";

const REFRESH_ATTEMPTS = 3;

interface RefreshMeta {
  refreshed_at: string | null;
  product_count: number;
  version: number | null;
}

/** Rebuilds the projection, retrying briefly when the data API is wedged. */
export async function refreshStorefrontSnapshot(
  supabase: any,
  jobKey = "storefront_snapshot_refresh",
): Promise<JobRunResult> {
  let lastError: string | null = null;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.rpc("refresh_storefront_snapshot");
    if (!error) {
      const { data } = await supabase
        .from("storefront_snapshot_meta")
        .select("refreshed_at, product_count, version")
        .maybeSingle();
      const meta = (data ?? {}) as Partial<RefreshMeta>;
      const checkout = await refreshCheckoutStateSafely();
      return {
        jobKey,
        status: "succeeded",
        message: `The storefront read model was rebuilt with ${meta.product_count ?? 0} listings.`,
        details: {
          products: meta.product_count ?? 0,
          version: meta.version ?? 0,
          duration_ms: Date.now() - startedAt,
          attempts: attempt,
          checkout_ready: checkout ? String(checkout) : "unchanged",
        },
      };
    }
    lastError = error.message ?? "The rebuild did not complete.";
    // A wedged schema cache clears within a second or two; a short backoff
    // recovers without any customer visible failure because the previous
    // projection is still being served.
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }

  return {
    jobKey,
    status: "failed",
    message: `The storefront read model could not be rebuilt: ${lastError ?? "unknown reason"}`,
    details: { duration_ms: Date.now() - startedAt, attempts: REFRESH_ATTEMPTS },
  };
}

/** Re-probes the checkout host away from the request path. Never throws. */
async function refreshCheckoutStateSafely(): Promise<boolean | null> {
  try {
    const { refreshCheckoutState } = await import("@/lib/public-api/storefront.server");
    const state = await refreshCheckoutState();
    return state.checkout_ready;
  } catch {
    return null;
  }
}
