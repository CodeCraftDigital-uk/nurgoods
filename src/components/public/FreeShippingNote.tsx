/**
 * Free UK shipping messaging.
 *
 * The claim is deliberately limited to the United Kingdom, which is the only
 * market NUR GOODS ships to. Supplier shipping is carried inside the product
 * price as a cost of goods, so nothing here promises a delivery cost the
 * shopper is not actually charged, and nothing implies free international
 * delivery.
 */
import { Truck } from "lucide-react";

const LONG = "Free UK shipping included in every price. UK delivery only.";

export function FreeShippingBadge() {
  return (
    <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-brand">
      Free UK shipping
    </span>
  );
}

export function FreeShippingLine({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
      <Truck aria-hidden className="h-4 w-4 text-brand" />
      <span>
        <span className="font-semibold text-foreground">Free UK shipping.</span> Included in the
        price shown. We deliver to the United Kingdom only.
      </span>
    </p>
  );
}

export function FreeShippingNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`}>
      {LONG} No delivery charge is added at checkout.
    </p>
  );
}
