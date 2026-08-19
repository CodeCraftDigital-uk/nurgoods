import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fulfilmentScope } from "./scope";

describe("fulfilment scope guard", () => {
  it("scopes a numeric supplier order id to a single element array", () => {
    expect(fulfilmentScope(44692714)).toEqual([44692714]);
    expect(fulfilmentScope(" 44692714 ")).toEqual([44692714]);
  });

  it("fails closed rather than sending an unscoped call", () => {
    for (const bad of [null, undefined, "", "  ", "abc", 0, -1, 1.5, Number.NaN]) {
      expect(() => fulfilmentScope(bad)).toThrow(/without a single valid supplier order id/);
    }
  });
});

describe("supplier fulfilment client contract", () => {
  const source = readFileSync(new URL("./supplier.server.ts", import.meta.url), "utf8");

  it("never sends a singular order_id to a fulfilment or cost action", () => {
    const fulfilmentCalls = source
      .split("callAction(")
      .slice(1)
      .filter((chunk) => /^roles\.order_fulfil(ment_cost)?\b/.test(chunk.trim()));
    expect(fulfilmentCalls.length).toBeGreaterThanOrEqual(4);
    for (const call of fulfilmentCalls) {
      const args = call.slice(0, call.indexOf("})") + 2);
      expect(args).not.toMatch(/\border_id\s*:/);
      expect(args).toMatch(/order_ids:\s*fulfilmentScope\(orderId\)/);
    }
  });

  it("looks the operation up only by operation_id", () => {
    const operation = source.slice(source.indexOf("roles.order_fulfilment_operation, {"));
    const args = operation.slice(0, operation.indexOf("})") + 2);
    expect(args).toMatch(/operation_id:\s*operationId/);
    expect(args).not.toMatch(/store_id/);
    expect(args).not.toMatch(/\border_id/);
  });
});
