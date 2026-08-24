import { describe, expect, it } from "vitest";
import { outstandingForCycle, planCycle, selectCycleBatch, type CycleLink } from "./shipping-cycle";

function catalogue(count: number): CycleLink[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `link-${String(index).padStart(4, "0")}`,
    shipping_attempt_cycle: 0,
  }));
}

/** Simulates a full refresh, stamping every attempted link like the server does. */
function runCycle(links: CycleLink[], limit: number) {
  const attempts: string[] = [];
  let stored = 0;
  let passes = 0;
  let cycle = 0;
  while (passes < 100) {
    const plan = planCycle({ storedCycle: stored, outstanding: outstandingForCycle(links, stored) });
    // Stop as soon as the walk would roll over into the next cycle.
    if (passes > 0 && plan.started) break;
    passes += 1;
    stored = plan.cycle;
    cycle = plan.cycle;
    const batch = selectCycleBatch({ links, cycle, limit });
    if (batch.length === 0) break;
    for (const link of batch) {
      attempts.push(link.id);
      link.shipping_attempt_cycle = cycle;
    }
  }
  return { attempts, passes, cycle };
}

describe("shipping refresh cycle", () => {
  it("attempts every link exactly once per cycle with no repeats or skips", () => {
    const links = catalogue(534);
    const { attempts } = runCycle(links, 200);
    expect(attempts).toHaveLength(534);
    expect(new Set(attempts).size).toBe(534);
    expect(new Set(attempts)).toEqual(new Set(links.map((link) => link.id)));
  });

  it("does not let links without an available quote starve later links", () => {
    const links = catalogue(534);
    // The first hundred suppliers never return a quote, so their quote
    // timestamp stays null. Under the old null-first ordering they were
    // re-selected on every pass; the cycle stamp makes that impossible.
    const unavailable = new Set(links.slice(0, 100).map((link) => link.id));
    const attempts: string[] = [];
    let stored = 0;
    for (let pass = 0; pass < 10; pass += 1) {
      const plan = planCycle({ storedCycle: stored, outstanding: outstandingForCycle(links, stored) });
      if (pass > 0 && plan.started) break;
      stored = plan.cycle;
      const batch = selectCycleBatch({ links, cycle: plan.cycle, limit: 200 });
      if (batch.length === 0) break;
      for (const link of batch) {
        attempts.push(link.id);
        // Unavailable links persist no quote, but are still stamped.
        link.shipping_attempt_cycle = plan.cycle;
      }
    }
    expect(attempts).toHaveLength(534);
    const repeated = attempts.filter((id) => unavailable.has(id));
    expect(repeated).toHaveLength(100);
    expect(new Set(attempts).size).toBe(534);
  });

  it("opens a new cycle only once the catalogue is fully covered", () => {
    const links = catalogue(50);
    const first = runCycle(links, 20);
    expect(first.cycle).toBe(1);
    const plan = planCycle({ storedCycle: first.cycle, outstanding: outstandingForCycle(links, first.cycle) });
    expect(plan).toEqual({ cycle: 2, started: true });
    expect(selectCycleBatch({ links, cycle: plan.cycle, limit: 20 })).toHaveLength(20);
  });

  it("resets into a fresh cycle on demand", () => {
    expect(planCycle({ storedCycle: 7, outstanding: 300, reset: true })).toEqual({
      cycle: 8,
      started: true,
    });
  });

  it("resumes an interrupted cycle instead of restarting it", () => {
    const links = catalogue(30);
    for (const link of links.slice(0, 12)) link.shipping_attempt_cycle = 3;
    const plan = planCycle({ storedCycle: 3, outstanding: outstandingForCycle(links, 3) });
    expect(plan).toEqual({ cycle: 3, started: false });
    const batch = selectCycleBatch({ links, cycle: 3, limit: 100 });
    expect(batch).toHaveLength(18);
    expect(batch.every((link) => Number(link.shipping_attempt_cycle) < 3)).toBe(true);
  });
});
