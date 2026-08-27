import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { getAiProviderStatus } from "@/lib/ai/ai-config.functions";
import { getOnboardingState } from "@/lib/services/onboarding";
import { getCatalogueSummary } from "@/lib/services/catalogue";
import { listArticles } from "@/lib/services/journal";
import { listIntegrations, listIntegrationEvents } from "@/lib/services/operations";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/control/")({
  component: DashboardPage,
});

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-3 font-display text-3xl text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function DashboardPage() {
  const { isAdmin, loading, rolesError, refreshRoles } = useAuth();

  const aiStatusFn = useServerFn(getAiProviderStatus);

  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => aiStatusFn({}),
    enabled: isAdmin,
    retry: false,
  });

  const onboarding = useQuery({
    queryKey: ["onboarding", aiStatus.data?.configured ?? null],
    queryFn: () => getOnboardingState(aiStatus.data ?? null),
    enabled: isAdmin,
  });

  const catalogue = useQuery({
    queryKey: ["catalogue-summary"],
    queryFn: getCatalogueSummary,
    enabled: isAdmin,
  });

  const articles = useQuery({ queryKey: ["articles"], queryFn: listArticles, enabled: isAdmin });
  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: listIntegrations,
    enabled: isAdmin,
  });
  const events = useQuery({
    queryKey: ["integration-events"],
    queryFn: () => listIntegrationEvents(6),
    enabled: isAdmin,
  });

  if (!loading && !isAdmin) {
    // A failed role read is not an authorisation answer, so it gets its own
    // recoverable state rather than telling the owner the role is missing.
    if (rolesError) {
      return (
        <div className="space-y-8">
          <PageHeader
            eyebrow="Dashboard"
            title="Could not confirm your access"
            description="Your session is signed in, but the role check did not complete, so nothing is being hidden on purpose."
          />
          <SectionCard title="What to do">
            <p className="text-sm text-muted-foreground">{rolesError}</p>
            <button
              type="button"
              onClick={() => void refreshRoles()}
              className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Retry access check
            </button>
          </SectionCard>
        </div>
      );
    }

    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Dashboard"
          title="Admin access required"
          description="Your account is signed in but does not hold the admin role, so platform data stays hidden."
        />
        <SectionCard title="Next step">
          <p className="text-sm text-muted-foreground">
            Ask a platform owner to grant the admin role to your account. Roles are stored
            separately from profiles and are checked on every database read.
          </p>
        </SectionCard>
      </div>
    );
  }

  const published = (articles.data ?? []).filter((a) => a.status === "published").length;
  const scheduled = (articles.data ?? []).filter((a) => a.status === "scheduled").length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Platform overview"
        description="Shopify remains the source of truth for products, orders and checkout. This platform adds intelligence, content automation and integration state around it."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Synced products"
          value={String(catalogue.data?.products ?? 0)}
          hint={catalogue.data?.lastSyncedAt ? "Mirrored from Shopify" : "Awaiting first sync"}
        />
        <Metric
          label="Synced collections"
          value={String(catalogue.data?.collections ?? 0)}
          hint="Read only mirror"
        />
        <Metric label="Published articles" value={String(published)} hint="Journal" />
        <Metric
          label="Scheduled articles"
          value={String(scheduled)}
          hint="Queued for publication"
        />
      </div>

      <SectionCard
        title="Onboarding checklist"
        description={
          onboarding.data
            ? `${onboarding.data.completed} of ${onboarding.data.total} steps complete. Nothing is reported as connected unless it truly is.`
            : "Checking connection state."
        }
      >
        <ul className="divide-y divide-border">
          {(onboarding.data?.items ?? []).map((item) => (
            <li key={item.key} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
              <span
                className={cn(
                  "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  item.complete ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {item.complete ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <CircleAlert className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                {!item.complete ? (
                  <p className="mt-1 text-xs text-muted-foreground">Blocked by: {item.blockedBy}</p>
                ) : null}
              </div>
              <Link
                to={item.href as "/control"}
                className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-md border border-input px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                {item.complete ? "Review" : "Set up"}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Integrations" description="Live status from the integrations table.">
          <ul className="space-y-3">
            {(integrations.data ?? []).map((integration) => (
              <li key={integration.id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{integration.label}</span>
                <StatusPill tone={statusTone(integration.status)}>
                  {humanise(integration.status)}
                </StatusPill>
              </li>
            ))}
            {(integrations.data ?? []).length === 0 ? (
              <li className="text-sm text-muted-foreground">No integrations registered yet.</li>
            ) : null}
          </ul>
        </SectionCard>

        <SectionCard title="Recent activity" description="Integration and sync events.">
          {(events.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events recorded. Activity appears once a sync or automation runs.
            </p>
          ) : (
            <ul className="space-y-3">
              {(events.data ?? []).map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-foreground">{humanise(event.event_type)}</p>
                    <p className="text-xs text-muted-foreground">
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
    </div>
  );
}
