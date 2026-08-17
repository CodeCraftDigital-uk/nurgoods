/**
 * Pure helpers for turning basket lines into a single store cart payload.
 *
 * These are deliberately free of any server or network dependency so the
 * checkout mapping rules can be tested directly.
 */

export const MAX_CHECKOUT_LINE_QUANTITY = 10;

export interface CheckoutLineInput {
  variantId: string;
  quantity: number;
}

export interface CartLinePayload {
  merchandiseId: string;
  quantity: number;
}

/** Turns a numeric variant identifier or a global id into a valid variant gid. */
export function variantGid(value: string): string | null {
  const trimmed = (value ?? "").trim();
  if (/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(trimmed)) return trimmed;
  const numeric = trimmed.match(/(\d+)\s*$/)?.[1];
  return numeric ? `gid://shopify/ProductVariant/${numeric}` : null;
}

/** The numeric identifier a shopper facing basket line uses. */
export function variantNumericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

/**
 * Merges duplicate variants into one cart line, clamps quantities and keeps
 * the exact store variant identifiers. Unusable identifiers are reported
 * rather than silently dropped.
 */
export function buildCartLines(lines: CheckoutLineInput[]): {
  lines: CartLinePayload[];
  invalid: string[];
} {
  const merged = new Map<string, number>();
  const invalid: string[] = [];
  for (const line of lines ?? []) {
    const gid = variantGid(line?.variantId ?? "");
    if (!gid) {
      if (line?.variantId) invalid.push(String(line.variantId));
      continue;
    }
    const quantity = Math.max(1, Math.trunc(Number(line.quantity)) || 1);
    merged.set(gid, (merged.get(gid) ?? 0) + quantity);
  }
  return {
    lines: [...merged.entries()].map(([merchandiseId, quantity]) => ({
      merchandiseId,
      quantity: Math.min(quantity, MAX_CHECKOUT_LINE_QUANTITY),
    })),
    invalid,
  };
}

/**
 * Reads the variant identifiers the store refused from its cart errors, so a
 * single bad line can be dropped instead of failing the whole basket.
 */
export function parseRejectedMerchandise(
  userErrors: Array<{ message?: string | null; field?: string[] | null }> | null | undefined,
): string[] {
  const found = new Set<string>();
  for (const error of userErrors ?? []) {
    const message = error?.message ?? "";
    for (const match of message.matchAll(/gid:\/\/shopify\/ProductVariant\/(\d+)/g)) {
      found.add(match[0]);
    }
  }
  return [...found];
}
