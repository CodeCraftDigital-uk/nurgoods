/**
 * Resumable catalogue pricing backfill.
 *
 * The repair has to be able to walk the entire catalogue, including drafts,
 * correcting every price onto the canonical landed cost formula. That is a
 * long job, so it runs in bounded pages against a stored checkpoint and can be
 * stopped and restarted at any point without losing its place or repeating
 * work it has already completed.
 *
 * Two modes, and the distinction is deliberate:
 *
 *   preview  reads and calculates only. Nothing is written to the store and
 *            nothing is written to the local mirror. Safe to run at any time.
 *   apply    writes corrected prices to the store and verifies them by reading
 *            them back.
 *
 * Neither mode may put stock on sale. Product status is never changed here and
 * no channel is ever published to. A product that is a draft stays a draft with
 * a correct price on it, which is exactly what the repair needs.
 */
import { zendropAdminClient } from "../zendrop/client.server";
import { PRICING_FORMULA_VERSION, repriceProducts, verifyPriceParity } from "./authority.server";

const CHECKPOINT_ID = "canonical-price-backfill";

/** Upper bound on one call, so a worker or a request can never run away. */
const MAX_PRODUCTS_PER_PASS = 40;

export type BackfillMode = "preview" | "apply";

export interface BackfillPass {
  mode: BackfillMode;
  formulaVersion: string;
  /** Products looked at in this pass. */
  products: number;
  variants: number;
  alreadyCorrect: number;
  corrected: number;
  held: number;
  failed: number;
  /** True once the walk has reached the end of the catalogue. */
  finishedFullPass: boolean;
  /** Where the next pass will resume from. Null once the walk is complete. */
  cursor: string | null;
  /** Running totals for the whole walk, not just this pass. */
  totals: { seen: number; priced: number; held: number };
  examples: string[];
  message: string;
}

export interface BackfillProgress {
  formulaVersion: string;
  cursor: string | null;
  running: boolean;
  totals: { seen: number; priced: number; held: number };
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

async function readState(supabase: any): Promise<any | null> {
  const { data } = await supabase
    .from("pricing_backfill_state")
    .select("*")
    .eq("id", CHECKPOINT_ID)
    .maybeSingle();
  return (data as any) ?? null;
}

/** Read only view of how far the walk has got. */
export async function pricingBackfillProgress(): Promise<BackfillProgress> {
  const supabase = await zendropAdminClient();
  const state = await readState(supabase);
  const cursor = state?.cursor ? String(state.cursor) : null;
  return {
    formulaVersion: PRICING_FORMULA_VERSION,
    cursor,
    running: Boolean(cursor) && !state?.completed_at,
    totals: {
      seen: Number(state?.variants_seen ?? 0),
      priced: Number(state?.variants_priced ?? 0),
      held: Number(state?.variants_held ?? 0),
    },
    startedAt: state?.started_at ?? null,
    updatedAt: state?.updated_at ?? null,
    completedAt: state?.completed_at ?? null,
  };
}

/** Clears the checkpoint so the next pass starts from the top again. */
export async function resetPricingBackfill(): Promise<void> {
  const supabase = await zendropAdminClient();
  await supabase.from("pricing_backfill_state").upsert(
    {
      id: CHECKPOINT_ID,
      cursor: "",
      variants_seen: 0,
      variants_priced: 0,
      variants_held: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "id" },
  );
}

/**
 * Runs one bounded page of the backfill.
 *
 * In preview mode the checkpoint still advances, so a preview walk can be run
 * end to end to size the work before anything is written. Call
 * resetPricingBackfill() between a preview walk and an apply walk.
 */
export async function runPricingBackfillPass(options: {
  mode?: BackfillMode;
  products?: number;
} = {}): Promise<BackfillPass> {
  const mode: BackfillMode = options.mode === "apply" ? "apply" : "preview";
  const limit = Math.max(1, Math.min(options.products ?? 20, MAX_PRODUCTS_PER_PASS));
  const supabase = await zendropAdminClient();

  const state = await readState(supabase);
  const cursor = state?.cursor ? String(state.cursor) : "";
  const startedAt = state?.started_at ?? new Date().toISOString();

  // Drafts are included on purpose: a product must be correctly priced before
  // anyone decides whether to sell it, and pricing it does not sell it.
  const { data } = await supabase
    .from("shopify_products")
    .select("shopify_product_id")
    .gt("shopify_product_id", cursor)
    .order("shopify_product_id", { ascending: true })
    .limit(limit);
  const ids = ((data ?? []) as any[]).map((row) => String(row.shopify_product_id));
  const finished = ids.length < limit;
  const nextCursor = finished ? null : (ids[ids.length - 1] ?? null);

  const reprice =
    ids.length > 0
      ? await repriceProducts({ shopifyProductIds: ids, dryRun: mode === "preview" })
      : {
          products: 0,
          variants: 0,
          inSync: 0,
          repriced: 0,
          held: 0,
          failed: 0,
          compareAtCleared: 0,
          examples: [] as string[],
          message: "There was nothing left to price.",
        };

  const totals = {
    seen: Number(state?.variants_seen ?? 0) + reprice.variants,
    priced: Number(state?.variants_priced ?? 0) + reprice.repriced + reprice.inSync,
    held: Number(state?.variants_held ?? 0) + reprice.held,
  };

  await supabase.from("pricing_backfill_state").upsert(
    {
      id: CHECKPOINT_ID,
      cursor: nextCursor ?? "",
      variants_seen: totals.seen,
      variants_priced: totals.priced,
      variants_held: totals.held,
      started_at: startedAt,
      completed_at: finished ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "id" },
  );

  const verb = mode === "preview" ? "would be corrected" : "corrected";
  return {
    mode,
    formulaVersion: PRICING_FORMULA_VERSION,
    products: reprice.products,
    variants: reprice.variants,
    alreadyCorrect: reprice.inSync,
    corrected: reprice.repriced,
    held: reprice.held,
    failed: reprice.failed,
    finishedFullPass: finished,
    cursor: nextCursor,
    totals,
    examples: reprice.examples.slice(0, 5),
    message:
      `${mode === "preview" ? "Preview" : "Apply"}: ${reprice.variants} variant(s) across ` +
      `${reprice.products} product(s), ${reprice.inSync} already correct, ${reprice.repriced} ${verb}, ` +
      `${reprice.held} held for unverified landed cost, ${reprice.failed} failed. ` +
      (finished ? "The walk has reached the end of the catalogue." : "More pages remain.") +
      " No product status or channel was changed.",
  };
}

/**
 * Convenience wrapper for an operator: run pages until the walk completes or
 * the pass budget runs out. Still bounded, still resumable.
 */
export async function runPricingBackfill(options: {
  mode?: BackfillMode;
  products?: number;
  maxPasses?: number;
} = {}): Promise<{ passes: BackfillPass[]; finished: boolean; parity: unknown }> {
  const maxPasses = Math.max(1, Math.min(options.maxPasses ?? 5, 50));
  const passes: BackfillPass[] = [];
  let finished = false;
  for (let index = 0; index < maxPasses && !finished; index += 1) {
    const pass = await runPricingBackfillPass({
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.products ? { products: options.products } : {}),
    });
    passes.push(pass);
    finished = pass.finishedFullPass;
  }
  return { passes, finished, parity: await verifyPriceParity() };
}
