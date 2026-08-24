/**
 * Shipping refresh cycle planning.
 *
 * The first implementation selected links ordered by the last successful quote
 * timestamp with nulls first. Links whose supplier has no quote available stay
 * null forever, so they sorted to the front of every pass and the same two
 * hundred rows were attempted again and again while later links were never
 * reached.
 *
 * A refresh is now a numbered cycle. Every attempt, successful or not, stamps
 * the link with the cycle it was attempted in, so selection is simply "links
 * not yet attempted in this cycle". Unavailable suppliers can no longer starve
 * the rest of the catalogue, and a cycle finishes exactly once per link.
 */

export interface CycleLink {
  id: string;
  shipping_attempt_cycle?: number | null;
}

export interface CyclePlan {
  /** Cycle currently being worked through. */
  cycle: number;
  /** True when the previous cycle finished and a new one has just started. */
  started: boolean;
}

/**
 * Decides which cycle a refresh pass belongs to.
 *
 * A pass joins the cycle already in progress while any link is still
 * outstanding, and opens the next one only when the catalogue is fully
 * covered.
 */
export function planCycle(input: {
  storedCycle: number | null | undefined;
  outstanding: number;
  reset?: boolean;
}): CyclePlan {
  const stored = Number.isFinite(Number(input.storedCycle)) ? Number(input.storedCycle) : 0;
  if (input.reset) return { cycle: stored + 1, started: true };
  if (stored <= 0) return { cycle: 1, started: true };
  if (input.outstanding > 0) return { cycle: stored, started: false };
  return { cycle: stored + 1, started: true };
}

/**
 * Selects the next batch for a cycle.
 *
 * Ordering is by identifier so the walk is stable and repeatable, and the
 * filter is the cycle stamp rather than quote availability.
 */
export function selectCycleBatch(input: {
  links: CycleLink[];
  cycle: number;
  limit: number;
}): CycleLink[] {
  return input.links
    .filter((link) => Number(link.shipping_attempt_cycle ?? 0) < input.cycle)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, input.limit));
}

/** Links still outstanding in a cycle. */
export function outstandingForCycle(links: CycleLink[], cycle: number): number {
  return links.filter((link) => Number(link.shipping_attempt_cycle ?? 0) < cycle).length;
}
