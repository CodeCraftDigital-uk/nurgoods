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
  connectShopify,
  disconnectShopifyFn,
  getShopifyStatus,
  runShopifyCatalogueSync,
  testShopifyConnectionFn,
} from "@/lib/services/shopify-sync.functions";

const DEFAULT_API_VERSION = "2026-07";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Never" : parsed.toLocaleString();
}

/**
 * Store pairing panel. The access token is posted once and stored in the
 * encrypted vault. It is never sent back to this page.
 */
export function ShopifyConnectionPanel() {
  const queryClient = useQueryClient();
  const statusFn = useServerFn(getShopifyStatus);
  const connectFn = useServerFn(connectShopify);
  const testFn = useServerFn(testShopifyConnectionFn);
  const syncFn = useServerFn(runShopifyCatalogueSync);
  const removeFn = useServerFn(disconnectShopifyFn);

  const status = useQuery({
    queryKey: ["shopify-status"],
    queryFn: () => statusFn({}),
    retry: false,
  });

  const [shopDomain, setShopDomain] = useState("");
  const [apiVersion, setApiVersion] = useState(DEFAULT_API_VERSION);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    if (!status.data) return;
    setShopDomain((current) => current || (status.data.shopDomain ?? ""));
    setClientId((current) => current || (status.data.clientId ?? ""));
    setApiVersion((current) =>
      current === DEFAULT_API_VERSION ? (status.data.apiVersion ?? DEFAULT_API_VERSION) : current,
    );
  }, [status.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["shopify-status"] });
    void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    void queryClient.invalidateQueries({ queryKey: ["integration-events"] });
    void queryClient.invalidateQueries({ queryKey: ["integration-settings"] });
  };

  const connect = useMutation({
    mutationFn: () =>
      connectFn({
        data: {
          shopDomain,
          apiVersion,
          ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
          ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        },
      }),
    onSuccess: (result) => {
      setClientSecret("");
      setReplacing(false);
      toast.success(`Connected to ${result.shopName}`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });


  const test = useMutation({
    mutationFn: () => testFn({}),
    onSuccess: (result) => {
      toast.success(`Connection verified with ${result.shopName}`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sync = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: (result) => {
      toast.success(
        `Mirrored ${result.products} products, ${result.variants} variants and ${result.collections} collections`,
      );
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["catalogue"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => removeFn({}),
    onSuccess: () => {
      setClientSecret("");
      setReplacing(false);
      toast.success("Store credentials removed");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const busy = connect.isPending || test.isPending || sync.isPending || remove.isPending;
  const data = status.data;
  const hasToken = Boolean(data?.hasStoredToken);
  const state = test.isPending || connect.isPending ? "testing" : (data?.connectionState ?? "not_connected");

  const tone: "positive" | "danger" | "pending" | "neutral" =
    state === "testing"
      ? "pending"
      : state === "connected"
        ? "positive"
        : state === "error"
          ? "danger"
          : "neutral";
  const label =
    state === "testing"
      ? "Testing"
      : state === "connected"
        ? "Connected"
        : state === "error"
          ? "Error"
          : "Not connected";

  return (
    <SectionCard
      title="Store connection"
      description="Pair the platform with your store using an Admin API access token. The token is encrypted at rest and never displayed again."
      actions={<StatusPill tone={tone}>{label}</StatusPill>}
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          connect.mutate();
        }}
      >
        <div className="sm:col-span-2">
          <Label htmlFor="shop-domain">Shop domain</Label>
          <Input
            id="shop-domain"
            value={shopDomain}
            onChange={(event) => setShopDomain(event.target.value)}
            placeholder="your-store.myshopify.com"
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 min-h-11"
            required
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Use the .myshopify.com domain where possible.
          </p>
        </div>

        <div>
          <Label htmlFor="api-version">Admin API version</Label>
          <Input
            id="api-version"
            value={apiVersion}
            onChange={(event) => setApiVersion(event.target.value)}
            placeholder={DEFAULT_API_VERSION}
            className="mt-1.5 min-h-11"
          />
        </div>

        <div>
          <Label htmlFor="admin-token">Admin API access token</Label>
          {hasToken && !replacing ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">A secure token is stored.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)}>
                Replace token
              </Button>
            </div>
          ) : (
            <Input
              id="admin-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="shpat_..."
              autoComplete="new-password"
              className="mt-1.5 min-h-11"
              required={!hasToken}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy} className="min-h-11">
            {connect.isPending ? "Testing" : hasToken ? "Save and verify" : "Connect store"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy || !data?.configured}
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Testing" : "Test connection"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy || !data?.configured}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? "Syncing" : "Sync catalogue"}
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
                  <AlertDialogTitle>Disconnect the store?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The stored access token and connection settings are deleted. Catalogue data
                    already mirrored stays until the next sync. You can reconnect at any time.
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
          <dd className="mt-1 text-foreground">{data?.shopName ?? data?.shopDomain ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Last tested</dt>
          <dd className="mt-1 text-foreground">{formatDate(data?.lastTestedAt ?? null)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Last successful sync
          </dt>
          <dd className="mt-1 text-foreground">{formatDate(data?.lastSyncedAt ?? null)}</dd>
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
