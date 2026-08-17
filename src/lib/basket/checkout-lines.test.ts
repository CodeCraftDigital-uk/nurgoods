import { describe, expect, it } from "vitest";
import {
  buildCartLines,
  parseRejectedMerchandise,
  variantGid,
  variantNumericId,
} from "./checkout-lines";

const gid = (id: string) => `gid://shopify/ProductVariant/${id}`;

describe("checkout line mapping", () => {
  it("keeps a single valid line intact", () => {
    expect(buildCartLines([{ variantId: "62968630739274", quantity: 1 }])).toEqual({
      lines: [{ merchandiseId: gid("62968630739274"), quantity: 1 }],
      invalid: [],
    });
  });

  it("sends two different variants in one cart", () => {
    const result = buildCartLines([
      { variantId: "62968630739274", quantity: 1 },
      { variantId: "62968630772042", quantity: 2 },
    ]);
    expect(result.lines).toEqual([
      { merchandiseId: gid("62968630739274"), quantity: 1 },
      { merchandiseId: gid("62968630772042"), quantity: 2 },
    ]);
  });

  it("sends three or more lines in one cart", () => {
    const result = buildCartLines([
      { variantId: "1", quantity: 1 },
      { variantId: gid("2"), quantity: 3 },
      { variantId: "3", quantity: 2 },
    ]);
    expect(result.lines).toHaveLength(3);
    expect(result.lines.map((line) => line.merchandiseId)).toEqual([gid("1"), gid("2"), gid("3")]);
  });

  it("merges a duplicated variant and clamps the quantity", () => {
    const result = buildCartLines([
      { variantId: "7", quantity: 4 },
      { variantId: gid("7"), quantity: 9 },
    ]);
    expect(result.lines).toEqual([{ merchandiseId: gid("7"), quantity: 10 }]);
  });

  it("reports an unusable identifier instead of sending it", () => {
    const result = buildCartLines([
      { variantId: "abc", quantity: 1 },
      { variantId: "9", quantity: 1 },
    ]);
    expect(result.invalid).toEqual(["abc"]);
    expect(result.lines).toEqual([{ merchandiseId: gid("9"), quantity: 1 }]);
  });

  it("reads the refused variants out of store cart errors", () => {
    const refused = parseRejectedMerchandise([
      { message: `The merchandise with id ${gid("62968638964042")} does not exist.` },
      { message: `The merchandise with id ${gid("62968607179082")} does not exist.` },
      { message: "Quantity is too high" },
    ]);
    expect(refused).toEqual([gid("62968638964042"), gid("62968607179082")]);
    expect(parseRejectedMerchandise([])).toEqual([]);
    expect(parseRejectedMerchandise(undefined)).toEqual([]);
  });

  it("drops only the refused line and keeps the valid ones", () => {
    const built = buildCartLines([
      { variantId: "62968630739274", quantity: 1 },
      { variantId: "62968638964042", quantity: 1 },
    ]);
    const refused = parseRejectedMerchandise([
      { message: `The merchandise with id ${gid("62968638964042")} does not exist.` },
    ]);
    const remaining = built.lines.filter((line) => !refused.includes(line.merchandiseId));
    expect(remaining).toEqual([{ merchandiseId: gid("62968630739274"), quantity: 1 }]);
    expect(refused.map(variantNumericId)).toEqual(["62968638964042"]);
  });

  it("normalises identifiers and rejects nonsense", () => {
    expect(variantGid(" 123 ")).toBe(gid("123"));
    expect(variantGid(gid("123"))).toBe(gid("123"));
    expect(variantGid("")).toBeNull();
  });
});
