import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  connectStorefrontApi,
  disconnectStorefrontFn,
  getStorefrontApiStatusFn,
  testStorefrontApiFn,
} from "@/lib/services/shopify-storefront.functions";

const DEFAULT_API_VERSION = "2026-07";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Never" : parsed.toLocaleString();
}

/**
 * Headless checkout pairing. The private Storefront token is posted once and
 * stored in the encrypted vault. It is never sent back to this page.
 */
export function StorefrontApiPanel() {
  const queryClient = useQueryClient();
  const statusFn = useServerFn(getStorefrontApiStatusFn);
  const saveFn = useServerFn(connectStorefrontApi);
  const testFn = useServerFn(testStorefrontApiFn);
  const removeFn = useServerFn(disconnectStorefrontFn);

  const status = useQuery({
    queryKey: ["storefront-api-status"],
    queryFn: () => statusFn({}),
    retry: false,
  });

  const [domain, setDomain] = useState("");
  const [apiVersion, setApiVersion] = useState(DEFAULT_API_VERSION);
  const [privateToken, setPrivateToken] = useState("");
  const [publicToken, setPublicToken] = useState("");
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    const data = status.data;
    if (!data) return;
    setDomain((current) => current || data.domain || data.suggestedDomain || "");
    setApiVersion((current) =>
      current === DEFAULT_API_VERSION ? (data.apiVersion ?? DEFAULT_API_VERSION) : current,
    );
    setPublicToken((current) => current || (data.publicToken ?? ""));
  }, [status.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["storefront-api-status"] });
    void queryClient.invalidateQueries({ queryKey: ["integration-settings"] });
    void queryClient.invalidateQueries({ queryKey: ["integration-events"] });
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          domain,
          apiVersion,
          ...(privateToken.trim() ? { privateToken: privateToken.trim() } : {}),
          publicToken: publicToken.trim(),
        },
      }),
    onSuccess: (result) => {
      setPrivateToken("");
      setReplacing(false);
      toast.success(`Headless checkout verified with ${result.shopName}`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () => testFn({}),
    onSuccess: (result) => toast.success(`Storefront connection working with ${result.shopName}`),
    onError: (error: Error) => toast.error(error.message),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: () => removeFn({}),
    onSuccess: () => {
      setPrivateToken("");
      setReplacing(false);
      toast.success("Storefront credentials removed");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = status.data;
  const busy = save.isPending || test.isPending || remove.isPending;
  const hasToken = Boolean(data?.hasPrivateToken);
  const state = save.isPending || test.isPending ? "testing" : (data?.connectionState ?? "not_connected");

  const tone: "positive" | "danger" | "pending" | "neutral" =
    state === "testing" ? "pending" : state === "connected" ? "positive" : state === "error" ? "danger" : "neutral";
  const label =
    state === "testing"
      ? "Testing"
      : state === "connected"
        ? "Connected"
        : state === "error"
          ? "Error"
          : hasToken
            ? "Not verified"
            : "Not connected";

  return (
    <SectionCard
      title="Storefront API and headless checkout"
      description="Separate from the catalogue sync connection. This pairing lets a shopper move from a NUR GOODS product page straight into a real store checkout."
      actions={<StatusPill tone={tone}>{label}</StatusPill>}
    >
      <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">What to do in Shopify</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Add or open the Headless channel, or the custom app already used for this store.</li>
          <li>
            Enable the Storefront API with unauthenticated_read_product_listings,
            unauthenticated_read_product_inventory and unauthenticated_write_checkouts.
          </li>
          <li>Copy the private Storefront API access token.</li>
          <li>Paste it below, save, then use Test Storefront connection.</li>
        </ol>
        <p className="mt-2">
          Paste the token only into the field below. It is encrypted at rest and never displayed
          again.
        </p>
      </div>

      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <Label htmlFor="storefront-domain">Storefront domain</Label>
          <Input
            id="storefront-domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="your-store.myshopify.com"
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 min-h-11"
            required
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Use the .myshopify.com domain, even when a custom domain is live.
          </p>
        </div>

        <div>
          <Label htmlFor="storefront-version">Storefront API version</Label>
          <Input
            id="storefront-version"
            value={apiVersion}
            onChange={(event) => setApiVersion(event.target.value)}
            placeholder={DEFAULT_API_VERSION}
            className="mt-1.5 min-h-11"
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="storefront-private-token">Private Storefront API token</Label>
          {hasToken && !replacing ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">Configured and stored securely.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)}>
                Replace credentials
              </Button>
            </div>
          ) : (
            <Input
              id="storefront-private-token"
              type="password"
              value={privateToken}
              onChange={(event) => setPrivateToken(event.target.value)}
              autoComplete="new-password"
              className="mt-1.5 min-h-11"
              required={!hasToken}
            />
          )}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="storefront-public-token">Public Storefront token, optional</Label>
          <Input
            id="storefront-public-token"
            value={publicToken}
            onChange={(event) => setPublicToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 min-h-11"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Not needed for checkout. Only useful later for browser safe storefront reads.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy} className="min-h-11">
            {save.isPending ? "Testing" : hasToken ? "Save and verify" : "Connect storefront"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy || !hasToken}
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Testing" : "Test Storefront connection"}
          </Button>
          {hasToken ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" className="min-h-11" disabled={busy}>
                  Disconnect
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect headless checkout?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The stored Storefront token and settings are deleted. Product pages fall back to
                    the existing basket link behaviour. You can reconnect at any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep connected</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove.mutate()}>Disconnect</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </form>

      <dl className="mt-6 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Store</dt>
          <dd className="mt-1 text-foreground">{data?.shopName ?? data?.domain ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Token</dt>
          <dd className="mt-1 text-foreground">{hasToken ? "Configured" : "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Last successful validation
          </dt>
          <dd className="mt-1 text-foreground">
            {data?.connectionState === "connected" ? formatDate(data?.lastTestedAt) : "Never"}
          </dd>
        </div>
      </dl>

      {data?.lastError && state === "error" ? (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {data.lastError}
        </p>
      ) : null}
    </SectionCard>
  );
}
