import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { listArticles, listBriefs } from "@/lib/services/journal";
import { WORKFLOW_PIPELINE } from "@/lib/ai/workflow";

export const Route = createFileRoute("/_authenticated/admin/journal/")({
  component: JournalIndex,
});

function JournalIndex() {
  const articles = useQuery({ queryKey: ["articles"], queryFn: listArticles });
  const briefs = useQuery({ queryKey: ["briefs"], queryFn: listBriefs });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Journal"
        title="Editorial workspace"
        description="Briefs, drafts, sources and scheduling for the NUR GOODS Journal. Nothing is published automatically and no placeholder articles have been created."
        actions={
          <Button asChild>
            <Link to="/admin/journal/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New article
            </Link>
          </Button>
        }
      />

      <SectionCard title="Articles" description="Draft, in review, scheduled, published, archived.">
        {(articles.data ?? []).length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No articles yet"
            description="Create the first article to see the editorial workflow, source citations, metadata and structured data preview in one place."
            action={
              <Button asChild>
                <Link to="/admin/journal/new">Create an article</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {(articles.data ?? []).map((article) => (
              <li key={article.id}>
                <Link
                  to="/admin/journal/$articleId"
                  params={{ articleId: article.id }}
                  className="flex min-h-14 flex-col gap-2 py-4 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{article.title}</p>
                    <p className="truncate text-xs text-muted-foreground">/{article.slug}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone="neutral">{humanise(article.stage)}</StatusPill>
                    <StatusPill tone={statusTone(article.status)}>
                      {humanise(article.status)}
                    </StatusPill>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Briefs"
        description="Topic and brief records produced by discovery, or created by hand."
      >
        {(briefs.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No briefs yet. Topic discovery creates briefs from the catalogue and your chosen topics.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {(briefs.data ?? []).map((brief) => (
              <li key={brief.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{brief.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {brief.target_query ?? "No target query set"}
                  </p>
                </div>
                <StatusPill tone={statusTone(brief.status)}>{humanise(brief.status)}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Workflow stages"
        description="Every article moves through this pipeline. Research and source verification always run before publication."
      >
        <ol className="grid gap-3 sm:grid-cols-2">
          {WORKFLOW_PIPELINE.map((stage, index) => (
            <li key={stage.stage} className="rounded-lg border border-border p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Stage {index + 1}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">{stage.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{stage.summary}</p>
            </li>
          ))}
        </ol>
      </SectionCard>
    </div>
  );
}
