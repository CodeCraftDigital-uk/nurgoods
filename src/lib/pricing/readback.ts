/**
 * Write/read parity for retail price writes.
 *
 * A price mutation that returns without a user error is not evidence that the
 * store now holds the price we intended. Every write is read back and checked
 * here: the store must show the intended price to the penny, that price must
 * end .99, and no unverified compare-at may be left behind. Anything else is a
 * failed push, never a success.
 *
 * Pure, no network, so the rule can be tested without a store.
 */

/** A penny. Prices equal within this are the same price. */
export const PENCE = 0.005;

export type IntendedPriceWrite = {
  /** Store variant id the price was written to. */
  id: string;
  /** The price we asked the store to hold, as written in the mutation. */
  price: string;
};

export type ObservedVariantPrice = {
  price: number | null;
  compareAt: number | null;
};

/**
 * Compares what we asked for with what the store came back with.
 *
 * @returns a problem description per variant id that failed parity. An empty
 *          map means every write is confirmed present in the store.
 */
export function verifyReadbackParity(
  intended: IntendedPriceWrite[],
  observed: Map<string, ObservedVariantPrice>,
): Map<string, string> {
  const problems = new Map<string, string>();
  for (const change of intended) {
    const target = Number(change.price);
    const actual = observed.get(change.id);
    if (!actual) {
      problems.set(change.id, "The store did not return this variant after the update");
    } else if (actual.price === null || Math.abs(actual.price - target) >= PENCE) {
      problems.set(
        change.id,
        `The store shows ${actual.price ?? "no price"} after writing ${target.toFixed(2)}`,
      );
    } else if (Math.round(actual.price * 100) % 100 !== 99) {
      problems.set(change.id, `${actual.price.toFixed(2)} does not end in .99`);
    } else if (actual.compareAt !== null) {
      problems.set(change.id, "An unverified compare-at price is still set");
    }
  }
  return problems;
}
