/**
 * Basket model.
 *
 * Pure, framework free logic so every basket rule can be tested directly.
 * The basket is a shopping aid only: the store remains the system of record
 * for orders and payment, and every line keeps the exact store variant
 * identifier so the cart handed to the store cannot drift from what the
 * shopper chose.
 */

export const MAX_LINE_QUANTITY = 10;
export const MAX_BASKET_LINES = 50;
export const BASKET_STORAGE_KEY = "nurgoods.basket.v1";

export interface BasketLine {
  /** Exact store variant identifier, kept verbatim. */
  variantId: string;
  productHandle: string;
  productTitle: string;
  /** Option labels and values exactly as the store supplies them. */
  options: { name: string; value: string }[];
  variantTitle: string | null;
  price: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  imageUrl: string | null;
  quantity: number;
  addedAt: string;
}

export interface BasketState {
  lines: BasketLine[];
}

export const EMPTY_BASKET: BasketState = { lines: [] };

export function clampQuantity(value: number): number {
  const whole = Math.trunc(Number(value)) || 0;
  if (whole < 1) return 1;
  return Math.min(whole, MAX_LINE_QUANTITY);
}

/** Lines are identified by the exact variant identifier, nothing else. */
export function lineKey(line: Pick<BasketLine, "variantId">): string {
  return line.variantId.trim();
}

export interface AddLineInput extends Omit<BasketLine, "quantity" | "addedAt"> {
  quantity?: number;
  /** Set false when the store reports the variant cannot be ordered. */
  availableForSale?: boolean | null;
}

export interface BasketMutation {
  state: BasketState;
  ok: boolean;
  reason?: string;
}

/** Adds a line, merging quantities when the same variant is already present. */
export function addLine(state: BasketState, input: AddLineInput): BasketMutation {
  const variantId = input.variantId?.trim();
  if (!variantId) return { state, ok: false, reason: "That option cannot be ordered" };
  if (input.availableForSale === false) {
    return { state, ok: false, reason: "That option is currently unavailable" };
  }

  const quantity = clampQuantity(input.quantity ?? 1);
  const existing = state.lines.find((line) => lineKey(line) === variantId);

  if (existing) {
    return {
      ok: true,
      state: {
        lines: state.lines.map((line) =>
          lineKey(line) === variantId
            ? { ...line, quantity: clampQuantity(line.quantity + quantity) }
            : line,
        ),
      },
    };
  }

  if (state.lines.length >= MAX_BASKET_LINES) {
    return { state, ok: false, reason: "The basket is full" };
  }

  const line: BasketLine = {
    variantId,
    productHandle: input.productHandle,
    productTitle: input.productTitle,
    options: input.options ?? [],
    variantTitle: input.variantTitle ?? null,
    price: input.price ?? null,
    compareAtPrice: input.compareAtPrice ?? null,
    currency: input.currency ?? null,
    imageUrl: input.imageUrl ?? null,
    quantity,
    addedAt: new Date().toISOString(),
  };
  return { ok: true, state: { lines: [...state.lines, line] } };
}

export function setLineQuantity(
  state: BasketState,
  variantId: string,
  quantity: number,
): BasketState {
  if (quantity <= 0) return removeLine(state, variantId);
  return {
    lines: state.lines.map((line) =>
      lineKey(line) === variantId ? { ...line, quantity: clampQuantity(quantity) } : line,
    ),
  };
}

export function removeLine(state: BasketState, variantId: string): BasketState {
  return { lines: state.lines.filter((line) => lineKey(line) !== variantId) };
}

export function totalQuantity(state: BasketState): number {
  return state.lines.reduce((sum, line) => sum + clampQuantity(line.quantity), 0);
}

/** Subtotal across every line with a known price, rounded to minor units. */
export function subtotal(state: BasketState): number {
  const total = state.lines.reduce(
    (sum, line) => sum + (typeof line.price === "number" ? line.price * clampQuantity(line.quantity) : 0),
    0,
  );
  return Number(total.toFixed(2));
}

export function basketCurrency(state: BasketState): string | null {
  for (const line of state.lines) if (line.currency) return line.currency;
  return null;
}

export interface CheckoutLine {
  variantId: string;
  quantity: number;
}

/** Maps the basket to the exact line list sent to the store, in basket order. */
export function toCheckoutLines(state: BasketState): CheckoutLine[] {
  return state.lines
    .filter((line) => Boolean(line.variantId?.trim()))
    .map((line) => ({ variantId: line.variantId.trim(), quantity: clampQuantity(line.quantity) }));
}

/** Fresh store facts used to correct a basket before checkout. */
export interface VariantFacts {
  variantId: string;
  available: boolean;
  price: number | null;
  compareAtPrice: number | null;
  currency: string | null;
}

export interface ReconcileResult {
  state: BasketState;
  removed: BasketLine[];
  repriced: { line: BasketLine; previousPrice: number | null }[];
}

/**
 * Applies fresh store facts. Lines the store no longer offers are dropped and
 * reported, and any price change is taken from the store rather than kept.
 */
export function reconcileBasket(state: BasketState, facts: VariantFacts[]): ReconcileResult {
  const byId = new Map(facts.map((fact) => [fact.variantId.trim(), fact]));
  const removed: BasketLine[] = [];
  const repriced: { line: BasketLine; previousPrice: number | null }[] = [];
  const lines: BasketLine[] = [];

  for (const line of state.lines) {
    const fact = byId.get(lineKey(line));
    if (!fact || !fact.available) {
      removed.push(line);
      continue;
    }
    const next: BasketLine = {
      ...line,
      price: fact.price,
      compareAtPrice: fact.compareAtPrice,
      currency: fact.currency ?? line.currency,
    };
    if (line.price !== fact.price) repriced.push({ line: next, previousPrice: line.price });
    lines.push(next);
  }

  return { state: { lines }, removed, repriced };
}

/** Parses persisted basket text, discarding anything that is not a valid line. */
export function parseBasket(raw: string | null): BasketState {
  if (!raw) return EMPTY_BASKET;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const lines = (parsed as BasketState)?.lines;
    if (!Array.isArray(lines)) return EMPTY_BASKET;
    const clean: BasketLine[] = [];
    for (const entry of lines) {
      const line = entry as Partial<BasketLine>;
      if (typeof line?.variantId !== "string" || !line.variantId.trim()) continue;
      if (typeof line.productHandle !== "string" || typeof line.productTitle !== "string") continue;
      clean.push({
        variantId: line.variantId.trim(),
        productHandle: line.productHandle,
        productTitle: line.productTitle,
        options: Array.isArray(line.options)
          ? line.options.filter(
              (option) =>
                option && typeof option.name === "string" && typeof option.value === "string",
            )
          : [],
        variantTitle: typeof line.variantTitle === "string" ? line.variantTitle : null,
        price: typeof line.price === "number" ? line.price : null,
        compareAtPrice: typeof line.compareAtPrice === "number" ? line.compareAtPrice : null,
        currency: typeof line.currency === "string" ? line.currency : null,
        imageUrl: typeof line.imageUrl === "string" ? line.imageUrl : null,
        quantity: clampQuantity(typeof line.quantity === "number" ? line.quantity : 1),
        addedAt: typeof line.addedAt === "string" ? line.addedAt : new Date().toISOString(),
      });
      if (clean.length >= MAX_BASKET_LINES) break;
    }
    return { lines: clean };
  } catch {
    return EMPTY_BASKET;
  }
}

export function serialiseBasket(state: BasketState): string {
  return JSON.stringify({ lines: state.lines });
}
