import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminDashboard,
});

const MODULES = [
  {
    key: "shopify",
    title: "Shopify Admin",
    description: "Read-only sync layer. Shopify stays the source of truth for catalogue and orders.",
  },
  {
    key: "zendrop",
    title: "Zendrop Fulfilment",
    description: "Fulfilment status mirroring and supplier signal ingestion.",
  },
  {
    key: "ai",
    title: "AI Content Automation",
    description: "Generation and enrichment pipelines writing into structured content.",
  },
  {
    key: "publiko",
    title: "Publiko Reviews",
    description: "Review ingestion and aggregation for intelligence surfaces.",
  },
  {
    key: "mcp",
    title: "MCP Connector",
    description: "Resource and tool surface for ChatGPT and Claude clients.",
  },
] as const;

function AdminDashboard() {
  const { user, isAdmin, signOut } = useAuth();

  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integrations")
        .select("provider, label, status, last_synced_at");
      if (error) throw error;
      return data;
    },
  });

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">NUR GOODS</p>
            <h1 className="text-lg font-semibold text-foreground">Platform console</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        {!isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Limited access</CardTitle>
              <CardDescription>
                This account has no admin role yet, so integration and content records stay hidden.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Integration modules
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {MODULES.map((module) => {
              const record = integrations.data?.find((i) => i.provider === module.key);
              return (
                <Card key={module.key}>
                  <CardHeader className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base">{module.title}</CardTitle>
                      <Badge variant={record?.status === "connected" ? "default" : "secondary"}>
                        {record?.status ?? "not configured"}
                      </Badge>
                    </div>
                    <CardDescription>{module.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {record?.last_synced_at
                      ? `Last sync ${new Date(record.last_synced_at).toLocaleString()}`
                      : "Awaiting build instructions"}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Foundation status
          </h2>
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
              <p>Database, authentication, roles and audit logging are in place.</p>
              <p>No storefront, branding or business data has been created.</p>
              <Link to="/" className="inline-block text-sm text-foreground underline-offset-4 hover:underline">
                Back to overview
              </Link>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
