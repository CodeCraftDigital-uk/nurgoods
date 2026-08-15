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
import { ShopifyConnectionPanel } from "@/components/admin/ShopifyConnectionPanel";

export const Route = createFileRoute("/_authenticated/admin/integrations")({
  component: IntegrationsPage,
});

const REQUIREMENTS: Record<string, string[]> = {
  shopify: [
    "Store domain, entered in the store connection panel above",
    "Client ID from the app created in your Shopify developer organisation",
    "Client secret, stored encrypted after it is submitted",
    "Admin API version, defaults to 2026-07",
    "App scopes read_products and read_inventory, released and installed on the store",
  ],
  zendrop: ["Confirmation of the Zendrop to Shopify link", "Any supplier feed reference"],
  ai: [
    "Managed AI, included with the platform",
    "No owner supplied model keys or accounts",
    "Optional live web research key (RESEARCH_PROVIDER_API_KEY) only if you want live research",
  ],

  publiko: [
    "Embed code copied from the Publiko dashboard",
    "A placement chosen for each widget",
    "No API key or developer integration needed",
  ],
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

      <ShopifyConnectionPanel />

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
                <div className="mt-4 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {aiStatus.data?.configured
                      ? `Managed AI is active, running ${aiStatus.data.model}. No owner supplied model keys are required.`
                      : "Managed AI is temporarily unavailable for this workspace. No action is needed from you."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {aiStatus.data?.researchConfigured
                      ? `Live research enabled through ${aiStatus.data.researchProviderId ?? "tavily"}.`
                      : "Live web research is the one capability the managed platform does not provide, so it stays optional and switched off. Add RESEARCH_PROVIDER_API_KEY, and RESEARCH_PROVIDER_ID if you are not using the default provider, only if you want it."}
                  </p>
                </div>
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
