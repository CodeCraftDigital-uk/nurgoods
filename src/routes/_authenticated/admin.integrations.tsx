import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import {
  listIntegrationEvents,
  listIntegrationSettings,
  listIntegrations,
} from "@/lib/services/operations";
import { getAiProviderStatus } from "@/lib/ai/ai-config.functions";
import { AI_SECRET_NAMES } from "@/lib/ai/provider";

export const Route = createFileRoute("/_authenticated/admin/integrations")({
  component: IntegrationsPage,
});

const REQUIREMENTS: Record<string, string[]> = {
  shopify: [
    "Shop domain (SHOPIFY_SHOP_DOMAIN)",
    "Admin API access token (SHOPIFY_ADMIN_API_TOKEN)",
    "Optional Admin API version (SHOPIFY_API_VERSION)",
    "Read scopes for products, collections and inventory",
  ],
  zendrop: ["Confirmation of the Zendrop to Shopify link", "Any supplier feed reference"],
  ai: [
    `Provider identifier (${AI_SECRET_NAMES.providerId})`,
    `Model (${AI_SECRET_NAMES.model})`,
    `API key (${AI_SECRET_NAMES.apiKey})`,
    `Optional research key (${AI_SECRET_NAMES.researchApiKey})`,
  ],
  publiko: ["Account reference", "Widget identifiers", "Embed details"],
  mcp: ["Confirmed resource scope", "Authentication decision for connecting clients"],
};

function IntegrationsPage() {
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: listIntegrations });
  const settings = useQuery({
    queryKey: ["integration-settings"],
    queryFn: listIntegrationSettings,
  });
  const events = useQuery({
    queryKey: ["integration-events"],
    queryFn: () => listIntegrationEvents(15),
  });
  const aiStatusFn = useServerFn(getAiProviderStatus);
  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => aiStatusFn({}),
    retry: false,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Integrations"
        title="Connection state"
        description="Nothing is reported as connected unless credentials are present and a sync has succeeded. Secrets are stored server side only and never rendered here."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {(integrations.data ?? []).map((integration) => {
          const requirements = REQUIREMENTS[integration.provider] ?? [];
          const scoped = (settings.data ?? []).filter(
            (s) => s.integration_id === integration.id,
          );
          return (
            <SectionCard
              key={integration.id}
              title={integration.label}
              actions={
                <StatusPill tone={statusTone(integration.status)}>
                  {humanise(integration.status)}
                </StatusPill>
              }
            >
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Required before connection
              </p>
              <ul className="mt-2 space-y-1.5">
                {requirements.map((item) => (
                  <li key={item} className="text-sm text-muted-foreground">
                    {item}
                  </li>
                ))}
                {requirements.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No requirements recorded.</li>
                ) : null}
              </ul>
              {scoped.length > 0 ? (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Stored configuration
                  </p>
                  <ul className="mt-2 space-y-1">
                    {scoped.map((setting) => (
                      <li key={setting.id} className="text-sm text-foreground">
                        {setting.label}:{" "}
                        <span className="text-muted-foreground">
                          {setting.is_secret_reference
                            ? `Server secret ${setting.secret_name ?? ""}`.trim()
                            : (setting.value ?? "Not set")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {integration.provider === "ai" ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  {aiStatus.data?.configured
                    ? `Server credentials detected for ${aiStatus.data.providerId}.`
                    : `Missing server secrets: ${(aiStatus.data?.missing ?? Object.values(AI_SECRET_NAMES)).join(", ")}`}
                </p>
              ) : null}
            </SectionCard>
          );
        })}
      </div>

      <SectionCard title="Event log" description="Sync and integration events, newest first.">
        {(events.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {(events.data ?? []).map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-sm text-foreground">{humanise(event.event_type)}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.message ?? "No message"} ·{" "}
                    {new Date(event.created_at).toLocaleString()}
                  </p>
                </div>
                <StatusPill tone={statusTone(event.status)}>{humanise(event.status)}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
