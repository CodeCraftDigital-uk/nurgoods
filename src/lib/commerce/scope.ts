/**
 * Fulfilment scope guard.
 *
 * The supplier fulfilment action takes an array of order ids. Sent without a
 * valid array it targets every unfulfilled order in the store, so one dispatch
 * could commit and charge for many. Every call therefore builds its scope here
 * and fails closed when a single specific order id is not available.
 */
export function fulfilmentScope(orderId: unknown): [number] {
  const parsed = typeof orderId === "string" ? Number(orderId.trim()) : typeof orderId === "number" ? orderId : NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      "Refusing to call supplier fulfilment without a single valid supplier order id, because an unscoped call would commit every unfulfilled order in the store.",
    );
  }
  return [parsed];
}
