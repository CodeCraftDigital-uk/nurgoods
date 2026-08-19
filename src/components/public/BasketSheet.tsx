import { Link } from "@tanstack/react-router";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FreeShippingNote } from "@/components/public/FreeShippingNote";
import { useBasket } from "@/lib/basket/BasketProvider";
import { MAX_LINE_QUANTITY } from "@/lib/basket/model";
import { formatMoney, lineTotalDisplay, variantPriceDisplay } from "@/lib/pricing/display";

/** Header button showing how many items are in the basket. */
export function BasketButton() {
  const { count, setOpen } = useBasket();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={count > 0 ? `Basket, ${count} items` : "Basket, empty"}
      className="relative inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-[0.82rem] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:text-sm"
    >
      <ShoppingBag className="size-4" aria-hidden />
      <span className="hidden sm:inline">Basket</span>
      {count > 0 ? (
        <span
          aria-hidden
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-[0.68rem] font-bold text-gold-foreground"
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** Reviewable basket. Quantities and removals happen here before checkout. */
export function BasketSheet() {
  const { lines, open, setOpen, setQuantity, remove, subtotal, currency, checkout, busy, count } =
    useBasket();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-[92vw] max-w-md flex-col p-0">
        <SheetHeader className="border-b border-border/70 px-5 py-4 text-left">
          <SheetTitle className="font-display text-lg">
            Your basket{count > 0 ? ` (${count})` : ""}
          </SheetTitle>
        </SheetHeader>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <ShoppingBag className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Your basket is empty.</p>
            <Link
              to="/store"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
            >
              Browse the range
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border/70 overflow-y-auto px-5">
              {lines.map((line) => {
                const unit = variantPriceDisplay(
                  { price: line.price, compare_at_price: line.compareAtPrice, currency: line.currency },
                  line.currency,
                );
                const total = lineTotalDisplay(
                  { price: line.price, currency: line.currency },
                  line.quantity,
                  line.currency,
                );
                return (
                  <li key={line.variantId} className="flex gap-3 py-4">
                    {line.imageUrl ? (
                      <img
                        src={line.imageUrl}
                        alt={line.productTitle ?? "Basket item"}
                        width={72}
                        height={72}
                        loading="lazy"
                        className="size-18 shrink-0 rounded-xl border border-border/70 object-cover"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/shop/$handle"
                        params={{ handle: line.productHandle }}
                        onClick={() => setOpen(false)}
                        className="line-clamp-2 text-sm font-semibold text-foreground hover:text-brand"
                      >
                        {line.productTitle}
                      </Link>
                      {line.options.length > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {line.options.map((option) => `${option.name}: ${option.value}`).join(" / ")}
                        </p>
                      ) : null}
                      {unit.primary ? (
                        <p className="mt-1 text-xs text-muted-foreground">{unit.primary} each</p>
                      ) : null}

                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="inline-flex items-center rounded-lg border border-input">
                          <button
                            type="button"
                            onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                            aria-label={`Reduce quantity of ${line.productTitle}`}
                            className="inline-flex size-9 items-center justify-center text-foreground hover:bg-accent"
                          >
                            <Minus className="size-3.5" aria-hidden />
                          </button>
                          <span className="min-w-8 text-center text-sm" aria-live="polite">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            disabled={line.quantity >= MAX_LINE_QUANTITY}
                            onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                            aria-label={`Increase quantity of ${line.productTitle}`}
                            className="inline-flex size-9 items-center justify-center text-foreground hover:bg-accent disabled:opacity-40"
                          >
                            <Plus className="size-3.5" aria-hidden />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          {total.primary ? (
                            <span className="text-sm font-semibold text-foreground">
                              {total.primary}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => remove(line.variantId)}
                            aria-label={`Remove ${line.productTitle}`}
                            className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-border/70 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Subtotal</span>
                <span className="font-display text-xl font-bold text-foreground">
                  {formatMoney(subtotal, currency)}
                </span>
              </div>
              <FreeShippingNote className="mt-1" />
              <p className="mt-1 text-xs text-muted-foreground">
                Any taxes are confirmed at secure store checkout.
              </p>
              <button
                type="button"
                onClick={() => void checkout()}
                disabled={busy}
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70"
              >
                {busy ? "Opening checkout" : "Checkout securely"}
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
