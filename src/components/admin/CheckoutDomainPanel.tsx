import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { getCheckoutDomainFn, setCheckoutDomainFn } from "@/lib/services/shopify-sync.functions";
import { getStorefrontApiStatusFn } from "@/lib/services/shopify-storefront.functions";

const INTENDED_CHECKOUT_HOST = "shop.nurgoods.com";

function Gate({ done, label, detail }: { done: boolean; label: string; detail?: string | undefined }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-muted text-muted-foreground"
        }`}
      >
        {done ? "✓" : ""}
      </span>
      <span className="text-sm">
        <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </li>
  );
}

/**
 * Basket and payment host. The public site owns nurgoods.com, so the store has
 * to serve its basket and payment pages on a separate host. This panel records
 * that host and reports whether the store genuinely answers there yet.
 */
export function CheckoutDomainPanel() {
  const queryClient = useQueryClient();
  const readFn = useServerFn(getCheckoutDomainFn);
  const saveFn = useServerFn(setCheckoutDomainFn);
  const statusFn = useServerFn(getStorefrontApiStatusFn);

  const setting = useQuery({
    queryKey: ["checkout-domain"],
    queryFn: () => readFn({}),
    retry: false,
  });

  const storefront = useQuery({
    queryKey: ["storefront-api-status"],
    queryFn: () => statusFn({}),
    retry: false,
  });

  const [value, setValue] = useState("");
  useEffect(() => {
    if (!setting.data) return;
    setValue((current) => current || (setting.data.checkoutDomain ?? INTENDED_CHECKOUT_HOST));
  }, [setting.data]);

  const save = useMutation({
    mutationFn: () => saveFn({ data: { checkoutDomain: value.trim() } }),
    onSuccess: (result) => {
      toast.success(
        result.checkoutDomain
          ? `Basket links will use ${result.checkoutDomain}`
          : "Basket links will use the paired store domain",
      );
      void queryClient.invalidateQueries({ queryKey: ["checkout-domain"] });
      void queryClient.invalidateQueries({ queryKey: ["storefront-api-status"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const effective = setting.data?.checkoutDomain ?? setting.data?.shopDomain ?? null;
  const readiness = storefront.data?.readiness;
  const probe = storefront.data?.checkoutHostProbe ?? null;
  const buyNowReady = readiness?.buyNowReady ?? false;

  return (
    <SectionCard
      title="Checkout domain and Buy now readiness"
      description="The public storefront is served on nurgoods.com by this platform, so the store must serve its basket and payment pages on a separate host. Purchases always use the checkout link issued by the store."
      actions={
        <StatusPill tone={buyNowReady ? "positive" : effective ? "warning" : "neutral"}>
          {buyNowReady ? "Buy now live" : effective ? "Waiting on store" : "Not set"}
        </StatusPill>
      }
    >
      <ul className="mb-4 space-y-2 rounded-lg border border-border bg-muted/40 p-3">
        <Gate
          done={readiness?.storefrontConnected ?? false}
          label="Storefront API connected"
          detail={storefront.data?.shopName ? `Paired with ${storefront.data.shopName}` : undefined}
        />
        <Gate
          done={readiness?.checkoutHostConfigured ?? false}
          label="Checkout host configured"
          detail={storefront.data?.checkoutHostOverride ?? "No dedicated host recorded"}
        />
        <Gate
          done={readiness?.checkoutHostServesStore ?? false}
          label="Checkout host answers as the store"
          detail={
            probe
              ? probe.servesStore
                ? `${probe.host} answers as the store`
                : probe.redirectsToSite
                  ? `${probe.host} still forwards to ${probe.finalHost ?? "this site"}`
                  : `${probe.host} is not answering as the store yet`
              : undefined
          }
        />
        <Gate
          done={buyNowReady}
          label="Ready for live Buy now"
          detail={
            buyNowReady
              ? "Shoppers are sent to the store issued checkout link"
              : "Buy now stays disabled until every check above passes"
          }
        />
      </ul>

      <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">What has to change in the store admin</p>
        <p className="mt-1">
          Set {INTENDED_CHECKOUT_HOST} as the primary domain in the store, so the store stops
          forwarding it to nurgoods.com. Shopify does not expose an Admin API mutation for changing
          the primary online store domain or its redirect behaviour, domains are read only through
          the API, so this one step has to be done in the store admin. Nothing here needs a code
          change afterwards. The platform re checks the host and enables Buy now on its own.
        </p>
      </div>

      <form
        className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <Label htmlFor="checkout-domain">Basket and payment host</Label>
          <Input
            id="checkout-domain"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={INTENDED_CHECKOUT_HOST}
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 min-h-11"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            This host is used to correct any checkout link the store issues on nurgoods.com, and
            only once it answers as the store.
          </p>
        </div>
        <Button type="submit" disabled={save.isPending} className="min-h-11">
          {save.isPending ? "Saving" : "Save"}
        </Button>
      </form>

      <p className="mt-4 text-sm text-muted-foreground">
        Currently in use: <span className="text-foreground">{effective ?? "Not set"}</span>
      </p>
    </SectionCard>
  );
}
