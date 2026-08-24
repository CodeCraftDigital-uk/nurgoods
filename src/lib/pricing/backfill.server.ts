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

/**
 * Which part of the catalogue the walk covers.
 *
 * "draft" is the safe default for the repair: a draft cannot be bought, so a
 * price written onto one has no customer exposure at all.
 */
export type BackfillScope = "draft" | "all";

export interface BackfillPass {
  mode: BackfillMode;
  scope: BackfillScope;
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
  scope: BackfillScope;
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
    scope: (state?.scope as BackfillScope) ?? "draft",
    cursor,
    running: Boolean(cursor) && !state?.completed_at,
    totals: {
      seen: Number(state?.variants_seen ?? 0),
      priced: Number(state?.variants_priced ?? 0),
      held: Number(state?.variants_held ?? 0),
    },
    startedAt: state?.created_at ?? null,
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
      completed_at: null,
      scope: "draft",
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "id" },
  );
}

/** Everything the walk needs from the outside world, so it can be tested. */
export interface BackfillDeps {
  readState(): Promise<{
    cursor?: string | null;
    variants_seen?: number | null;
    variants_priced?: number | null;
    variants_held?: number | null;
  } | null>;
  writeState(state: {
    cursor: string;
    variants_seen: number;
    variants_priced: number;
    variants_held: number;
    completed_at: string | null;
    scope: BackfillScope;
  }): Promise<void>;
  /** Product ids after the cursor, ascending, at most `limit` of them. */
  listProducts(cursor: string, limit: number, scope: BackfillScope): Promise<string[]>;
  reprice(ids: string[], dryRun: boolean): Promise<{
    products: number;
    variants: number;
    inSync: number;
    repriced: number;
    held: number;
    failed: number;
    examples: string[];
  }>;
}

export interface BackfillPassOptions {
  mode?: BackfillMode;
  scope?: BackfillScope;
  products?: number;
}

/**
 * Runs one bounded page of the backfill against injected dependencies.
 *
 * The checkpoint is written from the ids actually returned, so stopping the
 * walk at any point and starting it again resumes on the next unseen product
 * and never repeats a page. Product status and channel publication are not
 * touched in either mode.
 */
export async function runBackfillPassWith(
  deps: BackfillDeps,
  options: BackfillPassOptions = {},
): Promise<BackfillPass> {
  const mode: BackfillMode = options.mode === "apply" ? "apply" : "preview";
  const scope: BackfillScope = options.scope === "all" ? "all" : "draft";
  const limit = Math.max(1, Math.min(options.products ?? 20, MAX_PRODUCTS_PER_PASS));

  const state = await deps.readState();
  const cursor = state?.cursor ? String(state.cursor) : "";

  const ids = await deps.listProducts(cursor, limit, scope);
  const finished = ids.length < limit;
  const nextCursor = ids.length > 0 ? (ids[ids.length - 1] ?? null) : null;

  const reprice =
    ids.length > 0
      ? await deps.reprice(ids, mode === "preview")
      : {
          products: 0,
          variants: 0,
          inSync: 0,
          repriced: 0,
          held: 0,
          failed: 0,
          examples: [] as string[],
        };

  const totals = {
    seen: Number(state?.variants_seen ?? 0) + reprice.variants,
    priced: Number(state?.variants_priced ?? 0) + reprice.repriced + reprice.inSync,
    held: Number(state?.variants_held ?? 0) + reprice.held,
  };

  await deps.writeState({
    // The cursor is kept when the walk finishes so a later pass does not
    // silently reprice the whole catalogue again. Reset clears it.
    cursor: (finished ? (nextCursor ?? cursor) : nextCursor) ?? "",
    variants_seen: totals.seen,
    variants_priced: totals.priced,
    variants_held: totals.held,
    completed_at: finished ? new Date().toISOString() : null,
    scope,
  });

  const verb = mode === "preview" ? "would be corrected" : "corrected";
  return {
    mode,
    scope,
    formulaVersion: PRICING_FORMULA_VERSION,
    products: reprice.products,
    variants: reprice.variants,
    alreadyCorrect: reprice.inSync,
    corrected: reprice.repriced,
    held: reprice.held,
    failed: reprice.failed,
    finishedFullPass: finished,
    cursor: finished ? null : nextCursor,
    totals,
    examples: reprice.examples.slice(0, 5),
    message:
      `${mode === "preview" ? "Preview" : "Apply"} (${scope === "draft" ? "drafts only" : "whole catalogue"}): ` +
      `${reprice.variants} variant(s) across ${reprice.products} product(s), ${reprice.inSync} already correct, ` +
      `${reprice.repriced} ${verb}, ${reprice.held} held for unverified landed cost, ${reprice.failed} failed. ` +
      (finished ? "The walk has reached the end of the catalogue." : "More pages remain.") +
      " No product status or channel was changed.",
  };
}

/** The real adapter: the local store mirror plus the pricing authority. */
async function liveBackfillDeps(): Promise<BackfillDeps> {
  const supabase = await zendropAdminClient();
  return {
    readState: () => readState(supabase),
    async writeState(next) {
      await supabase.from("pricing_backfill_state").upsert(
        { id: CHECKPOINT_ID, ...next, updated_at: new Date().toISOString() } as never,
        { onConflict: "id" },
      );
    },
    async listProducts(cursor, limit, scope) {
      // Drafts are included on purpose: a product must be correctly priced
      // before anyone decides whether to sell it, and pricing it does not
      // sell it.
      let query = supabase
        .from("shopify_products")
        .select("shopify_product_id")
        .gt("shopify_product_id", cursor)
        .order("shopify_product_id", { ascending: true })
        .limit(limit);
      if (scope === "draft") query = query.ilike("status", "draft");
      const { data } = await query;
      return ((data ?? []) as any[]).map((row) => String(row.shopify_product_id));
    },
    reprice: (ids, dryRun) => repriceProducts({ shopifyProductIds: ids, dryRun }),
  };
}

/**
 * Runs one bounded page of the backfill.
 *
 * In preview mode the checkpoint still advances, so a preview walk can be run
 * end to end to size the work before anything is written. Call
 * resetPricingBackfill() between a preview walk and an apply walk.
 */
export async function runPricingBackfillPass(
  options: BackfillPassOptions = {},
): Promise<BackfillPass> {
  return runBackfillPassWith(await liveBackfillDeps(), options);
}

/**
 * Convenience wrapper for an operator: run pages until the walk completes or
 * the pass budget runs out. Still bounded, still resumable.
 */
export async function runPricingBackfill(options: {
  mode?: BackfillMode;
  scope?: BackfillScope;
  products?: number;
  maxPasses?: number;
} = {}): Promise<{ passes: BackfillPass[]; finished: boolean; parity: unknown }> {
  const maxPasses = Math.max(1, Math.min(options.maxPasses ?? 5, 50));
  const passes: BackfillPass[] = [];
  let finished = false;
  for (let index = 0; index < maxPasses && !finished; index += 1) {
    const pass = await runPricingBackfillPass({
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.scope ? { scope: options.scope } : {}),
      ...(options.products ? { products: options.products } : {}),
    });
    passes.push(pass);
    finished = pass.finishedFullPass;
  }
  return { passes, finished, parity: await verifyPriceParity() };
}
