import { describe, expect, it } from "vitest";
import {
  MAX_LINE_QUANTITY,
  addLine,
  parseBasket,
  reconcileBasket,
  removeLine,
  serialiseBasket,
  setLineQuantity,
  subtotal,
  toCheckoutLines,
  totalQuantity,
  type AddLineInput,
  type BasketState,
} from "./model";

const desk: AddLineInput = {
  variantId: "62968630739274",
  productHandle: "wooden-desk-organizer-set",
  productTitle: "Wooden Desk Organizer Set",
  options: [{ name: "Style", value: "Walnut" }],
  variantTitle: "Walnut",
  price: 45.58,
  compareAtPrice: null,
  currency: "GBP",
  imageUrl: null,
};

const second: AddLineInput = {
  ...desk,
  variantId: "62968630772042",
  productHandle: "linen-storage-basket",
  productTitle: "Linen Storage Basket",
  options: [{ name: "Size", value: "Large" }],
  variantTitle: "Large",
  price: 34.69,
};

function basketWith(...inputs: AddLineInput[]): BasketState {
  let state: BasketState = { lines: [] };
  for (const input of inputs) state = addLine(state, input).state;
  return state;
}

describe("basket model", () => {
  it("keeps the exact store variant id and option labels", () => {
    const state = basketWith(desk);
    expect(state.lines[0]!.variantId).toBe("62968630739274");
    expect(state.lines[0]!.options).toEqual([{ name: "Style", value: "Walnut" }]);
  });

  it("holds multiple products and variants as separate lines", () => {
    const state = basketWith(desk, second, { ...desk, variantId: "999", price: 10 });
    expect(state.lines).toHaveLength(3);
    expect(state.lines.map((line) => line.variantId)).toEqual([
      "62968630739274",
      "62968630772042",
      "999",
    ]);
  });

  it("merges the same variant instead of duplicating it", () => {
    const state = basketWith(desk, { ...desk, quantity: 2 });
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]!.quantity).toBe(3);
  });

  it("refuses an unavailable variant", () => {
    const result = addLine({ lines: [] }, { ...desk, availableForSale: false });
    expect(result.ok).toBe(false);
    expect(result.state.lines).toHaveLength(0);
  });

  it("refuses a line with no variant id", () => {
    expect(addLine({ lines: [] }, { ...desk, variantId: "  " }).ok).toBe(false);
  });

  it("clamps quantities and supports removal", () => {
    let state = basketWith(desk);
    state = setLineQuantity(state, desk.variantId, 99);
    expect(state.lines[0]!.quantity).toBe(MAX_LINE_QUANTITY);
    state = setLineQuantity(state, desk.variantId, 0);
    expect(state.lines).toHaveLength(0);
    expect(removeLine(basketWith(desk), desk.variantId).lines).toHaveLength(0);
  });

  it("totals quantity and subtotal across lines", () => {
    const state = setLineQuantity(basketWith(desk, second), desk.variantId, 2);
    expect(totalQuantity(state)).toBe(3);
    expect(subtotal(state)).toBeCloseTo(45.58 * 2 + 34.69, 2);
  });

  it("maps every line into one checkout line list", () => {
    const state = setLineQuantity(basketWith(desk, second), second.variantId, 4);
    expect(toCheckoutLines(state)).toEqual([
      { variantId: "62968630739274", quantity: 1 },
      { variantId: "62968630772042", quantity: 4 },
    ]);
  });

  it("drops stale lines and takes fresh prices from the store", () => {
    const state = basketWith(desk, second);
    const result = reconcileBasket(state, [
      {
        variantId: desk.variantId,
        available: true,
        price: 49.99,
        compareAtPrice: 59.99,
        currency: "GBP",
      },
      {
        variantId: second.variantId,
        available: false,
        price: 34.69,
        compareAtPrice: null,
        currency: "GBP",
      },
    ]);
    expect(result.removed.map((line) => line.variantId)).toEqual([second.variantId]);
    expect(result.state.lines).toHaveLength(1);
    expect(result.state.lines[0]!.price).toBe(49.99);
    expect(result.repriced).toHaveLength(1);
  });

  it("drops lines the store no longer knows about", () => {
    const result = reconcileBasket(basketWith(desk), []);
    expect(result.state.lines).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
  });

  it("round trips through persistence and rejects corrupt data", () => {
    const state = basketWith(desk, second);
    expect(parseBasket(serialiseBasket(state)).lines).toEqual(state.lines);
    expect(parseBasket("not json").lines).toHaveLength(0);
    expect(parseBasket(null).lines).toHaveLength(0);
    expect(parseBasket(JSON.stringify({ lines: [{ variantId: "" }] })).lines).toHaveLength(0);
  });
});
