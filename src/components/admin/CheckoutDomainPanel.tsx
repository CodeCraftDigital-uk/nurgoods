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

/**
 * Basket and payment host. Product pages build a basket link on this host so
 * ordering stays with the store. If the store's own primary domain is serving
 * this site, a separate checkout host has to be set here and in the store.
 */
export function CheckoutDomainPanel() {
  const queryClient = useQueryClient();
  const readFn = useServerFn(getCheckoutDomainFn);
  const saveFn = useServerFn(setCheckoutDomainFn);

  const setting = useQuery({
    queryKey: ["checkout-domain"],
    queryFn: () => readFn({}),
    retry: false,
  });

  const [value, setValue] = useState("");
  useEffect(() => {
    if (!setting.data) return;
    setValue((current) => current || (setting.data.checkoutDomain ?? ""));
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
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const effective = setting.data?.checkoutDomain ?? setting.data?.shopDomain ?? null;
  const ready = setting.data?.ready ?? false;

  return (
    <SectionCard
      title="Checkout domain"
      description="Product pages send shoppers to a basket on this host. Payment, delivery and order tracking stay with the store."
      actions={
        <StatusPill tone={ready ? "positive" : effective ? "warning" : "neutral"}>
          {ready ? "Working" : effective ? "Not answering" : "Not set"}
        </StatusPill>
      }
    >
      <p className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Your store forwards its own domain to whichever domain is set as primary in the store admin.
        If that primary domain is the same address serving this site, basket links will not resolve.
        In that case set a dedicated checkout host, for example shop.nurgoods.com, add it to the
        store as a domain and enter it here.
      </p>

      {effective && !ready ? (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed text-foreground">
          Basket links on {effective} are not answering as the store, so Buy now is disabled on
          product pages instead of sending shoppers to a dead end. Add a dedicated checkout host in
          the store admin, set it as the primary domain there and enter it above.
        </p>
      ) : null}

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
            placeholder={setting.data?.shopDomain ?? "your-store.myshopify.com"}
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 min-h-11"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Leave empty to use the paired store domain
            {setting.data?.shopDomain ? ` (${setting.data.shopDomain})` : ""}.
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
