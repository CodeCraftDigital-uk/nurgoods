import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  BASKET_STORAGE_KEY,
  EMPTY_BASKET,
  addLine,
  basketCurrency,
  parseBasket,
  reconcileBasket,
  removeLine,
  serialiseBasket,
  setLineQuantity,
  subtotal as subtotalOf,
  toCheckoutLines,
  totalQuantity,
  type AddLineInput,
  type BasketLine,
  type BasketState,
} from "./model";
import { createBasketCheckoutFn, revalidateBasketFn } from "./basket.functions";

interface BasketContextValue {
  lines: BasketLine[];
  count: number;
  subtotal: number;
  currency: string | null;
  open: boolean;
  busy: boolean;
  setOpen: (open: boolean) => void;
  add: (input: AddLineInput) => boolean;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  refresh: () => Promise<void>;
  checkout: () => Promise<void>;
}

const BasketContext = createContext<BasketContextValue | null>(null);

/**
 * Client side basket. It persists across navigation and reload in this
 * browser only, and never holds anything beyond the store variant identifiers
 * and the details needed to review an order before checkout.
 */
export function BasketProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BasketState>(EMPTY_BASKET);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Reading storage after mount keeps the server rendered markup and the first
  // client render identical.
  useEffect(() => {
    try {
      setState(parseBasket(window.localStorage.getItem(BASKET_STORAGE_KEY)));
    } catch {
      setState(EMPTY_BASKET);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(BASKET_STORAGE_KEY, serialiseBasket(state));
    } catch {
      /* storage can be unavailable in private modes */
    }
  }, [state, hydrated]);

  // Another tab editing the basket is reflected here.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === BASKET_STORAGE_KEY) setState(parseBasket(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const refresh = useCallback(async () => {
    const current = stateRef.current;
    if (current.lines.length === 0) return;
    try {
      const result = await revalidateBasketFn({
        data: { variantIds: current.lines.map((line) => line.variantId) },
      });
      const reconciled = reconcileBasket(current, result.facts);
      if (reconciled.removed.length > 0 || reconciled.repriced.length > 0) {
        setState(reconciled.state);
      }
      if (reconciled.removed.length > 0) {
        toast.warning(
          reconciled.removed.length === 1
            ? `${reconciled.removed[0]!.productTitle} is no longer available and was removed.`
            : `${reconciled.removed.length} items are no longer available and were removed.`,
        );
      } else if (reconciled.repriced.length > 0) {
        toast.info("Prices in your basket were updated from the store.");
      }
    } catch {
      /* a failed check leaves the basket untouched */
    }
  }, []);

  const add = useCallback((input: AddLineInput) => {
    const result = addLine(stateRef.current, input);
    if (!result.ok) {
      toast.error(result.reason ?? "That option cannot be added");
      return false;
    }
    setState(result.state);
    setOpen(true);
    return true;
  }, []);

  const checkout = useCallback(async () => {
    setBusy(true);
    try {
      await refresh();
      const lines = toCheckoutLines(stateRef.current);
      if (lines.length === 0) {
        toast.error("Your basket is empty.");
        return;
      }
      const result = await createBasketCheckoutFn({ data: { lines } });
      if (!result?.checkoutUrl) throw new Error("No checkout link");
      // The store may refuse individual lines. Only those are removed, the
      // rest of the basket carries on to checkout.
      const refused = new Set(result.unavailable ?? []);
      if (refused.size > 0) {
        const dropped = stateRef.current.lines.filter((line) => refused.has(line.variantId));
        setState((prev) =>
          dropped.reduce((next, line) => removeLine(next, line.variantId), prev),
        );
        if (dropped.length > 0) {
          toast.warning(
            dropped.length === 1
              ? `${dropped[0]!.productTitle} is no longer available and was removed from your basket.`
              : `${dropped.length} items are no longer available and were removed from your basket.`,
          );
        }
      }
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      const message =
        error instanceof Error && error.message && error.message.length < 160
          ? error.message
          : "Checkout could not be started. Please try again.";
      toast.error(message);
      void refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const value = useMemo<BasketContextValue>(
    () => ({
      lines: state.lines,
      count: totalQuantity(state),
      subtotal: subtotalOf(state),
      currency: basketCurrency(state),
      open,
      busy,
      setOpen: (next: boolean) => {
        setOpen(next);
        if (next) void refresh();
      },
      add,
      setQuantity: (variantId, quantity) =>
        setState((prev) => setLineQuantity(prev, variantId, quantity)),
      remove: (variantId) => setState((prev) => removeLine(prev, variantId)),
      clear: () => setState(EMPTY_BASKET),
      refresh,
      checkout,
    }),
    [state, open, busy, add, refresh, checkout],
  );

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket(): BasketContextValue {
  const context = useContext(BasketContext);
  if (!context) throw new Error("useBasket must be used inside BasketProvider");
  return context;
}
