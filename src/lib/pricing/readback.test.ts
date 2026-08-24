import { describe, expect, it } from "vitest";
import { verifyReadbackParity } from "./readback";

const observed = (
  entries: Array<[string, { price: number | null; compareAt: number | null }]>,
) => new Map(entries);

describe("write/read parity after a price write", () => {
  it("confirms a write only when the store shows the intended .99 price", () => {
    const problems = verifyReadbackParity(
      [
        { id: "gid://shopify/ProductVariant/1", price: "67.99" },
        { id: "gid://shopify/ProductVariant/2", price: "12.99" },
      ],
      observed([
        ["gid://shopify/ProductVariant/1", { price: 67.99, compareAt: null }],
        ["gid://shopify/ProductVariant/2", { price: 12.99, compareAt: null }],
      ]),
    );
    expect(problems.size).toBe(0);
  });

  it("fails a variant the store did not return at all", () => {
    const problems = verifyReadbackParity(
      [{ id: "v1", price: "67.99" }],
      observed([]),
    );
    expect(problems.get("v1")).toMatch(/did not return/i);
  });

  it("fails when the store kept a different price", () => {
    const problems = verifyReadbackParity(
      [{ id: "v1", price: "67.99" }],
      observed([["v1", { price: 1.99, compareAt: null }]]),
    );
    expect(problems.get("v1")).toContain("1.99");
    expect(problems.get("v1")).toContain("67.99");
  });

  it("fails when the store holds no price for the variant", () => {
    const problems = verifyReadbackParity(
      [{ id: "v1", price: "67.99" }],
      observed([["v1", { price: null, compareAt: null }]]),
    );
    expect(problems.get("v1")).toMatch(/no price/i);
  });

  it("fails a stored price that does not end in .99", () => {
    const problems = verifyReadbackParity(
      [{ id: "v1", price: "67.50" }],
      observed([["v1", { price: 67.5, compareAt: null }]]),
    );
    expect(problems.get("v1")).toMatch(/does not end in \.99/);
  });

  it("fails when an unverified compare-at price survived the write", () => {
    const problems = verifyReadbackParity(
      [{ id: "v1", price: "67.99" }],
      observed([["v1", { price: 67.99, compareAt: 99.99 }]]),
    );
    expect(problems.get("v1")).toMatch(/compare-at/i);
  });

  it("treats sub-penny store rounding as the same price", () => {
    const problems = verifyReadbackParity(
      [{ id: "v1", price: "67.99" }],
      observed([["v1", { price: 67.9901, compareAt: null }]]),
    );
    expect(problems.size).toBe(0);
  });

  it("reports only the variants that failed, not the whole batch", () => {
    const problems = verifyReadbackParity(
      [
        { id: "ok", price: "67.99" },
        { id: "bad", price: "67.99" },
      ],
      observed([
        ["ok", { price: 67.99, compareAt: null }],
        ["bad", { price: 1.99, compareAt: null }],
      ]),
    );
    expect([...problems.keys()]).toEqual(["bad"]);
  });
});
