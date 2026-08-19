/**
 * Adaptive throughput planning for supplier reconciliation.
 *
 * Supplier facts have a maximum age. Anything older than that age is not safe
 * to sell against, so the reconciliation pass has to revisit the whole
 * supplier backed catalogue inside that window no matter how large the
 * catalogue grows. A fixed batch size cannot do that: 25 products twice an
 * hour covers roughly 3,600 listings in 72 hours and nothing beyond it.
 *
 * These are pure functions with no network or database access so the sizing
 * maths can be proven directly, and so no call site can quietly exceed the
 * configured ceiling.
 */

export interface RefreshTuning {
  /** Maximum age a supplier fact may reach before the listing is held. */
  freshnessTargetHours: number;
  /** Never claim fewer than this in one pass, so small catalogues still move. */
  minBatch: number;
  /** Hard ceiling per pass. Protects the supplier API and the run duration. */
  maxBatch: number;
  /** Extra capacity above the bare requirement, to absorb failures and retries. */
  headroomPct: number;
  /** How many times the reconciliation job is scheduled per hour. */
  runsPerHour: number;
}

export interface RefreshPlan {
  /** Listings that must be revisited every hour to hold the freshness target. */
  requiredPerHour: number;
  /** Listings this pass should claim, after clamping to the configured bounds. */
  batchSize: number;
  /** Listings actually achievable per hour at that batch size. */
  effectivePerHour: number;
  /** Hours for one complete sweep of the supplier backed catalogue. */
  sweepHours: number;
  /** True when a complete sweep finishes inside the freshness target. */
  withinSla: boolean;
  /** Plain explanation for the admin console. */
  note: string;
}

export const DEFAULT_REFRESH_TUNING: RefreshTuning = {
  freshnessTargetHours: 48,
  minBatch: 10,
  maxBatch: 60,
  headroomPct: 0.3,
  runsPerHour: 4,
};

function clampNumber(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Normalises operator supplied tuning into safe, finite bounds. */
export function normaliseTuning(input: Partial<RefreshTuning> | null | undefined): RefreshTuning {
  const source = input ?? {};
  const freshnessTargetHours = clampNumber(
    Number(source.freshnessTargetHours) || DEFAULT_REFRESH_TUNING.freshnessTargetHours,
    6,
    72,
  );
  const minBatch = clampNumber(Number(source.minBatch) || DEFAULT_REFRESH_TUNING.minBatch, 1, 200);
  const maxBatch = clampNumber(
    Number(source.maxBatch) || DEFAULT_REFRESH_TUNING.maxBatch,
    minBatch,
    200,
  );
  const headroomPct = clampNumber(
    Number.isFinite(Number(source.headroomPct))
      ? Number(source.headroomPct)
      : DEFAULT_REFRESH_TUNING.headroomPct,
    0,
    2,
  );
  const runsPerHour = clampNumber(
    Number(source.runsPerHour) || DEFAULT_REFRESH_TUNING.runsPerHour,
    1,
    12,
  );
  return { freshnessTargetHours, minBatch, maxBatch, headroomPct, runsPerHour };
}

/**
 * Sizes the next reconciliation pass from the current supplier backed
 * catalogue size. The batch only ever grows within the configured ceiling, so
 * the pass stays bounded even if the catalogue count is wrong.
 */
export function planRefreshBatch(sellableCount: number, tuning: RefreshTuning): RefreshPlan {
  const count = Math.max(0, Math.floor(sellableCount));
  const t = normaliseTuning(tuning);

  const bareRequirement = count / t.freshnessTargetHours;
  const requiredPerHour = Math.ceil(bareRequirement * (1 + t.headroomPct));
  const rawBatch = Math.ceil(requiredPerHour / t.runsPerHour);
  const batchSize = clampNumber(rawBatch, t.minBatch, t.maxBatch);
  const effectivePerHour = batchSize * t.runsPerHour;
  const sweepHours = count === 0 ? 0 : count / effectivePerHour;
  const withinSla = count === 0 || sweepHours <= t.freshnessTargetHours;

  const note = withinSla
    ? `A complete sweep of ${count} supplier backed listing(s) takes about ${sweepHours.toFixed(1)} hour(s) at ${effectivePerHour} per hour, inside the ${t.freshnessTargetHours} hour freshness target.`
    : `A complete sweep of ${count} supplier backed listing(s) would take about ${sweepHours.toFixed(1)} hour(s) at the ceiling of ${effectivePerHour} per hour, which is beyond the ${t.freshnessTargetHours} hour freshness target. Raise the maximum batch size or the number of runs per hour, or listings will be held for staleness.`;

  return { requiredPerHour, batchSize, effectivePerHour, sweepHours, withinSla, note };
}

/** Projects sweep behaviour at a set of catalogue sizes, for the admin console. */
export function projectSweepTiers(
  tiers: number[],
  tuning: RefreshTuning,
): Array<{ catalogueSize: number; batchSize: number; perHour: number; sweepHours: number; withinSla: boolean }> {
  return tiers.map((size) => {
    const plan = planRefreshBatch(size, tuning);
    return {
      catalogueSize: size,
      batchSize: plan.batchSize,
      perHour: plan.effectivePerHour,
      sweepHours: Number(plan.sweepHours.toFixed(1)),
      withinSla: plan.withinSla,
    };
  });
}

/** Backoff for a supplier read that failed, in minutes, capped and deterministic. */
export function retryDelayMinutes(retryCount: number): number {
  const attempt = Math.max(0, Math.floor(retryCount));
  return Math.min(240, 5 * 2 ** Math.min(attempt, 6));
}
