import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { listMcpResources } from "@/lib/services/operations";

export const Route = createFileRoute("/_authenticated/admin/mcp")({
  component: McpPage,
});

function McpPage() {
  const resources = useQuery({ queryKey: ["mcp-resources"], queryFn: listMcpResources });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="MCP Readiness"
        title="Planned read only resources"
        description="These resources are documented and backed by real tables so a future MCP server can expose them to ChatGPT and Claude. Nothing is exposed yet, and write or transactional actions stay out of scope until they are requested and permissioned separately."
      />

      <SectionCard
        title="Server status"
        description="No MCP server is running. This page records the intended surface and what still blocks each resource."
      >
        <StatusPill tone="warning">Planned, not exposed</StatusPill>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {(resources.data ?? []).map((resource) => (
          <SectionCard
            key={resource.id}
            title={resource.label}
            actions={<StatusPill tone="neutral">Read only</StatusPill>}
          >
            <p className="text-sm text-muted-foreground">{resource.description}</p>
            <p className="mt-3 font-mono text-xs text-foreground">{resource.resource_key}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Backed by: {resource.backing_tables.join(", ")}
            </p>
            {resource.blocked_reason ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Blocked by: {resource.blocked_reason}
              </p>
            ) : null}
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
