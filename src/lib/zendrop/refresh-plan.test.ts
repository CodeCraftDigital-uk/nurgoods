import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFRESH_TUNING,
  normaliseTuning,
  planRefreshBatch,
  projectSweepTiers,
  retryDelayMinutes,
} from "./refresh-plan";

describe("planRefreshBatch", () => {
  it("keeps a small catalogue on the minimum batch", () => {
    const plan = planRefreshBatch(161, DEFAULT_REFRESH_TUNING);
    expect(plan.batchSize).toBe(DEFAULT_REFRESH_TUNING.minBatch);
    expect(plan.withinSla).toBe(true);
    expect(plan.sweepHours).toBeLessThan(DEFAULT_REFRESH_TUNING.freshnessTargetHours);
  });

  it("grows the batch as the catalogue grows", () => {
    const small = planRefreshBatch(1_000, DEFAULT_REFRESH_TUNING);
    const large = planRefreshBatch(10_000, DEFAULT_REFRESH_TUNING);
    expect(large.batchSize).toBeGreaterThan(small.batchSize);
  });

  it("never exceeds the configured ceiling", () => {
    const plan = planRefreshBatch(500_000, DEFAULT_REFRESH_TUNING);
    expect(plan.batchSize).toBe(DEFAULT_REFRESH_TUNING.maxBatch);
  });

  it("flags the freshness target as unreachable instead of silently missing it", () => {
    const plan = planRefreshBatch(50_000, DEFAULT_REFRESH_TUNING);
    expect(plan.withinSla).toBe(false);
    expect(plan.note).toContain("beyond");
  });

  it("holds the target when capacity is raised", () => {
    const plan = planRefreshBatch(50_000, {
      ...DEFAULT_REFRESH_TUNING,
      maxBatch: 200,
      runsPerHour: 12,
    });
    expect(plan.withinSla).toBe(true);
  });

  it("reports a zero sweep for an empty catalogue", () => {
    const plan = planRefreshBatch(0, DEFAULT_REFRESH_TUNING);
    expect(plan.sweepHours).toBe(0);
    expect(plan.withinSla).toBe(true);
  });
});

describe("normaliseTuning", () => {
  it("clamps nonsense into safe bounds", () => {
    const tuning = normaliseTuning({
      freshnessTargetHours: 9999,
      minBatch: 0,
      maxBatch: -5,
      headroomPct: 99,
      runsPerHour: 10_000,
    });
    expect(tuning.freshnessTargetHours).toBe(72);
    expect(tuning.maxBatch).toBeGreaterThanOrEqual(tuning.minBatch);
    expect(tuning.headroomPct).toBeLessThanOrEqual(2);
    expect(tuning.runsPerHour).toBeLessThanOrEqual(12);
  });
});

describe("projectSweepTiers", () => {
  it("projects every requested catalogue size", () => {
    const tiers = projectSweepTiers([161, 1_000, 10_000, 50_000], DEFAULT_REFRESH_TUNING);
    expect(tiers.map((tier) => tier.catalogueSize)).toEqual([161, 1_000, 10_000, 50_000]);
    expect(tiers[0]!.withinSla).toBe(true);
  });
});

describe("retryDelayMinutes", () => {
  it("backs off and then caps", () => {
    expect(retryDelayMinutes(0)).toBe(5);
    expect(retryDelayMinutes(1)).toBe(10);
    expect(retryDelayMinutes(3)).toBe(40);
    expect(retryDelayMinutes(50)).toBe(240);
  });
});
