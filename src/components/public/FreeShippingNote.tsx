/**
 * Free shipping messaging.
 *
 * The claim is scoped to the markets NUR GOODS actually serves, the United
 * Kingdom and the United States. Supplier shipping is carried inside the
 * product price as a cost of goods, so nothing here promises a delivery cost
 * the shopper is not actually charged, and nothing implies free worldwide
 * delivery. Wording is derived from the supported market list rather than
 * written by hand, so copy and configuration cannot drift apart.
 */
import { Truck } from "lucide-react";
import {
  freeShippingBadgeLabel,
  freeShippingHeadline,
  freeShippingStatement,
  type MarketCode,
} from "@/lib/pricing/markets";

/**
 * Public surfaces render before any settings round trip, so the shipping
 * footprint is a build time constant. It must be changed here and in the
 * pricing settings together.
 */
export const PUBLIC_FREE_SHIPPING_MARKETS: MarketCode[] = ["GB", "US"];

export function FreeShippingBadge() {
  return (
    <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-brand">
      {freeShippingBadgeLabel(PUBLIC_FREE_SHIPPING_MARKETS)}
    </span>
  );
}

export function FreeShippingLine({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
      <Truck aria-hidden className="h-4 w-4 text-brand" />
      <span>
        <span className="font-semibold text-foreground">
          {freeShippingHeadline(PUBLIC_FREE_SHIPPING_MARKETS)}
        </span>{" "}
        Included in the price shown. We deliver to the United Kingdom and the United States only.
      </span>
    </p>
  );
}

export function FreeShippingNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`}>
      {freeShippingStatement(PUBLIC_FREE_SHIPPING_MARKETS)} No delivery charge is added at checkout.
    </p>
  );
}
