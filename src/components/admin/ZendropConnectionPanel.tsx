import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  connectZendropFn,
  disconnectZendropFn,
  getZendropConnection,
  testZendropFn,
} from "@/lib/zendrop/zendrop.functions";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Never" : parsed.toLocaleString();
}

/**
 * Supplier pairing. The token is posted once, stored in the encrypted vault
 * and never sent back to this page. Only a masked fingerprint is shown.
 */
export function ZendropConnectionPanel() {
  const queryClient = useQueryClient();
  const statusFn = useServerFn(getZendropConnection);
  const connectFn = useServerFn(connectZendropFn);
  const testFn = useServerFn(testZendropFn);
  const removeFn = useServerFn(disconnectZendropFn);

  const [token, setToken] = useState("");
  const [expiresOn, setExpiresOn] = useState("2029-12-31");

  const status = useQuery({
    queryKey: ["zendrop-status"],
    queryFn: () => statusFn({}),
    retry: false,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["zendrop-status"] });
    void queryClient.invalidateQueries({ queryKey: ["sourcing-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  const connect = useMutation({
    mutationFn: () => connectFn({ data: { token, expiresOn } }),
    onSuccess: () => {
      setToken("");
      toast.success("Supplier account connected.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () => testFn({}),
    onSuccess: (result) =>
      toast.success(
        `Verified. ${result.capabilities.filter((c) => c.available).length} of ${result.capabilities.length} required operations available.`,
      ),
    onError: (error: Error) => toast.error(error.message),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: () => removeFn({}),
    onSuccess: () => {
      toast.success("Supplier token removed.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = status.data;
  const connected = data?.connectionState === "connected";

  return (
    <SectionCard
      title="Supplier connection"
      description="The long lived supplier token is stored server side in the encrypted vault. It is never rendered, logged or returned to the browser."
      actions={
        <StatusPill tone={connected ? "positive" : data?.configured ? "danger" : "neutral"}>
          {connected ? "Connected" : data?.configured ? "Error" : "Disconnected"}
        </StatusPill>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="zendrop-token">Supplier API token</Label>
          <Input
            id="zendrop-token"
            type="password"
            autoComplete="off"
            placeholder={data?.fingerprint ? `Stored as ${data.fingerprint}` : "Paste the token"}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="zendrop-expiry">Token expires on</Label>
          <Input
            id="zendrop-expiry"
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => connect.mutate()}
          disabled={!token.trim() || connect.isPending}
        >
          {connect.isPending ? "Storing" : data?.configured ? "Replace token" : "Connect"}
        </Button>
        <Button
          variant="outline"
          onClick={() => test.mutate()}
          disabled={!data?.configured || test.isPending}
        >
          {test.isPending ? "Testing" : "Test connection"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => remove.mutate()}
          disabled={!data?.configured || remove.isPending}
        >
          Disconnect
        </Button>
      </div>

      <dl className="mt-5 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Fingerprint</dt>
          <dd className="text-foreground">{data?.fingerprint ?? "Not stored"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Expiry</dt>
          <dd className="text-foreground">
            {data?.expiresOn ?? "Not recorded"}
            {typeof data?.expiresInDays === "number" ? ` (${data.expiresInDays} days)` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Last tested</dt>
          <dd className="text-foreground">{formatDate(data?.lastTestedAt ?? null)}</dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Discovered capabilities
        </p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {(data?.capabilities ?? []).map((capability) => (
            <li key={capability.role} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-foreground">{capability.label}</span>
              <StatusPill tone={capability.available ? "positive" : "warning"}>
                {capability.available ? (capability.actionName ?? "Available") : "Unavailable"}
              </StatusPill>
            </li>
          ))}
        </ul>
        {data?.lastError ? (
          <p className="mt-3 text-sm text-destructive">{data.lastError}</p>
        ) : null}
      </div>
    </SectionCard>
  );
}
