import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { EmptyState } from "@/components/admin/EmptyState";
import { getConnectorReadiness } from "@/lib/public-api/readiness.functions";

export const Route = createFileRoute("/_authenticated/control/mcp")({
  component: McpPage,
});

function McpPage() {
  const readinessFn = useServerFn(getConnectorReadiness);
  const readiness = useQuery({
    queryKey: ["connector-readiness"],
    queryFn: () => readinessFn({}),
    retry: false,
  });

  const data = readiness.data;
  const readyCount = (data?.resources ?? []).filter((r) => r.ready).length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Connector readiness"
        title="Public read only knowledge surface"
        description="The connector exposes published NUR GOODS knowledge only. Products and categories come from the store sync, Journal articles and policies only appear once a person has published them, and there is no write, order, customer or account access on this surface."
      />

      {readiness.isLoading ? (
        <SectionCard title="Loading">
          <p className="text-sm text-muted-foreground">Checking what is genuinely ready.</p>
        </SectionCard>
      ) : readiness.isError ? (
        <SectionCard title="Status unavailable">
          <p className="text-sm text-muted-foreground">
            Readiness could not be read just now. Refresh the page to try again.
          </p>
        </SectionCard>
      ) : null}

      {data ? (
        <>
          <SectionCard
            title="Endpoints"
            description="Both surfaces read the same published data through the same contract."
            actions={
              <StatusPill tone={readyCount > 0 ? "positive" : "warning"}>
                {readyCount} of {data.resources.length} live
              </StatusPill>
            }
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Connector endpoint
                </dt>
                <dd className="mt-1 break-all font-mono text-sm text-foreground">
                  {data.connectorPath}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Public API
                </dt>
                <dd className="mt-1 break-all font-mono text-sm text-foreground">
                  {data.apiBasePath} (version {data.version})
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-muted-foreground">
              The endpoints are built and serving. Registration with ChatGPT or Claude has not been
              requested or approved, so nothing is connected on their side yet.
            </p>
          </SectionCard>

          <SectionCard title="Published data behind the connector">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: "Products", value: data.counts.products },
                { label: "Categories", value: data.counts.collections },
                { label: "Articles", value: data.counts.articles },
                { label: "Policies", value: data.counts.policies },
                { label: "Answers", value: data.counts.answers },
              ].map((tile) => (
                <div key={tile.label} className="rounded-lg border border-border p-3">
                  <p className="text-2xl font-semibold text-foreground">{tile.value}</p>
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {tile.label}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Last catalogue sync:{" "}
              {data.counts.lastStoreSyncAt
                ? new Date(data.counts.lastStoreSyncAt).toLocaleString()
                : "never"}
            </p>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            {data.resources.map((resource) => (
              <SectionCard
                key={resource.key}
                title={resource.label}
                actions={
                  <StatusPill tone={resource.ready ? "positive" : "warning"}>
                    {resource.ready ? "Live" : "Waiting on data"}
                  </StatusPill>
                }
              >
                <p className="text-sm text-muted-foreground">{resource.description}</p>
                <p className="mt-3 break-all font-mono text-xs text-foreground">
                  {resource.key} · {resource.httpPath}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Reads: {resource.backingTables.join(", ")}
                </p>
                {resource.blockedReason ? (
                  <p className="mt-2 text-xs text-muted-foreground">{resource.blockedReason}</p>
                ) : null}
              </SectionCard>
            ))}
          </div>

          <SectionCard
            title="Before requesting ChatGPT or Claude access"
            description="Each item is a genuine prerequisite, not a formality."
          >
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                Connect the store so product and category tools return real records rather than
                empty results.
              </li>
              <li>Publish at least one Journal article and the core UK policy documents.</li>
              <li>Approve the answerable questions that assistants are allowed to quote.</li>
              <li>Publish the site so the connector endpoint has a stable public address.</li>
            </ul>
          </SectionCard>
        </>
      ) : readiness.isLoading || readiness.isError ? null : (
        <EmptyState title="Nothing to report" description="No connector resources are defined." />
      )}
    </div>
  );
}
