import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ExternalLink, Search, Sparkles, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addArticleSource,
  addInternalLink,
  getArticle,
  listArticleRuns,
  listArticleSources,
  listInternalLinks,
  removeArticleSource,
  setInternalLinkAccepted,
  setSourceVerified,
  updateArticle,
} from "@/lib/services/journal";
import { RUNNABLE_STAGES, WORKFLOW_PIPELINE } from "@/lib/ai/workflow";
import { getAiProviderStatus } from "@/lib/ai/ai-config.functions";
import {
  generateArticleHero,
  runArticleResearch,
  runArticleStage,
} from "@/lib/ai/generation.functions";
import {
  parseFaqs,
  WORKFLOW_STAGE_LABEL,
  WORKFLOW_STATUS_LABEL,
  type FaqItem,
  type SeoTargetType,
  type WorkflowStage,
  type WorkflowStatus,
} from "@/lib/types/platform";

export const Route = createFileRoute("/_authenticated/control/journal/$articleId")({
  component: ArticleEditor,
});

const STATUS_OPTIONS = Object.keys(WORKFLOW_STATUS_LABEL) as WorkflowStatus[];
const STAGE_OPTIONS = Object.keys(WORKFLOW_STAGE_LABEL) as WorkflowStage[];
const TARGET_TYPES: SeoTargetType[] = ["product", "collection", "article", "page"];

interface EditorState {
  title: string;
  slug: string;
  excerpt: string;
  body_markdown: string;
  meta_title: string;
  meta_description: string;
  canonical_url: string;
  schema_type: string;
  author_name: string;
  scheduled_for: string;
  status: WorkflowStatus;
  stage: WorkflowStage;
  faqs: FaqItem[];
}

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ArticleEditor() {
  const { articleId } = Route.useParams();
  const queryClient = useQueryClient();

  const article = useQuery({
    queryKey: ["article", articleId],
    queryFn: () => getArticle(articleId),
  });
  const sources = useQuery({
    queryKey: ["article-sources", articleId],
    queryFn: () => listArticleSources(articleId),
  });
  const links = useQuery({
    queryKey: ["article-links", articleId],
    queryFn: () => listInternalLinks(articleId),
  });

  const [form, setForm] = useState<EditorState | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [researchQuery, setResearchQuery] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [anchor, setAnchor] = useState("");
  const [targetType, setTargetType] = useState<SeoTargetType>("product");
  const [targetReference, setTargetReference] = useState("");

  useEffect(() => {
    if (!article.data || form) return;
    setForm({
      title: article.data.title,
      slug: article.data.slug,
      excerpt: article.data.excerpt ?? "",
      body_markdown: article.data.body_markdown,
      meta_title: article.data.meta_title ?? "",
      meta_description: article.data.meta_description ?? "",
      canonical_url: article.data.canonical_url ?? "",
      schema_type: article.data.schema_type,
      author_name: article.data.author_name ?? "",
      scheduled_for: toLocalInput(article.data.scheduled_for),
      status: article.data.status,
      stage: article.data.stage,
      faqs: parseFaqs(article.data.faqs),
    });
  }, [article.data, form]);

  const aiStatusFn = useServerFn(getAiProviderStatus);
  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => aiStatusFn({}),
    retry: false,
  });

  const runs = useQuery({
    queryKey: ["article-runs", articleId],
    queryFn: () => listArticleRuns(articleId),
  });

  const researchFn = useServerFn(runArticleResearch);
  const research = useMutation({
    mutationFn: () =>
      researchFn({
        data: { articleId, ...(researchQuery.trim() ? { query: researchQuery.trim() } : {}) },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["article-sources", articleId] });
      await queryClient.invalidateQueries({ queryKey: ["article-runs", articleId] });
      toast.success(
        result.added > 0
          ? `Added ${result.added} unverified sources for "${result.query}". Verify each one before use.`
          : `No new sources found for "${result.query}".`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const generateHeroFn = useServerFn(generateArticleHero);
  const generateHero = useMutation({
    mutationFn: () => generateHeroFn({ data: { articleId } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["article", articleId] });
      toast.success(
        result.source === "generated"
          ? "Hero image created and applied."
          : "Hero image set from catalogue photography.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const runStageFn = useServerFn(runArticleStage);
  const runStage = useMutation({
    mutationFn: (stage: WorkflowStage) => runStageFn({ data: { articleId, stage } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["article", articleId] });
      await queryClient.invalidateQueries({ queryKey: ["article-runs", articleId] });
      await queryClient.invalidateQueries({ queryKey: ["article-links", articleId] });
      setForm(null);
      toast.success(
        result.applied.length > 0
          ? `Stage complete. Updated: ${result.applied.join(", ")}.`
          : "Stage complete. Nothing needed changing.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });



  const save = useMutation({
    mutationFn: async (state: EditorState) => {
      const publishing = state.status === "published";
      return updateArticle(articleId, {
        title: state.title,
        slug: state.slug,
        excerpt: state.excerpt || null,
        body_markdown: state.body_markdown,
        meta_title: state.meta_title || null,
        meta_description: state.meta_description || null,
        canonical_url: state.canonical_url || null,
        schema_type: state.schema_type,
        author_name: state.author_name || null,
        scheduled_for: state.scheduled_for ? new Date(state.scheduled_for).toISOString() : null,
        status: state.status,
        stage: state.stage,
        faqs: state.faqs as unknown as never,
        published_at: publishing
          ? (article.data?.published_at ?? new Date().toISOString())
          : null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["article", articleId] });
      await queryClient.invalidateQueries({ queryKey: ["articles"] });
      toast.success("Article saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addSource = useMutation({
    mutationFn: () =>
      addArticleSource({ articleId, url: sourceUrl.trim(), title: sourceTitle.trim() || null }),
    onSuccess: async () => {
      setSourceUrl("");
      setSourceTitle("");
      await queryClient.invalidateQueries({ queryKey: ["article-sources", articleId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleSource = useMutation({
    mutationFn: ({ id, verified }: { id: string; verified: boolean }) =>
      setSourceVerified(id, verified),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["article-sources", articleId] }),
  });

  const deleteSource = useMutation({
    mutationFn: (id: string) => removeArticleSource(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["article-sources", articleId] }),
  });

  const addLink = useMutation({
    mutationFn: () =>
      addInternalLink({
        articleId,
        anchorText: anchor.trim(),
        targetType,
        targetReference: targetReference.trim(),
      }),
    onSuccess: async () => {
      setAnchor("");
      setTargetReference("");
      await queryClient.invalidateQueries({ queryKey: ["article-links", articleId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleLink = useMutation({
    mutationFn: ({ id, accepted }: { id: string; accepted: boolean }) =>
      setInternalLinkAccepted(id, accepted),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["article-links", articleId] }),
  });

  const structuredDataPreview = useMemo(() => {
    if (!form) return "";
    const faqBlock =
      form.faqs.length > 0
        ? {
            "@type": "FAQPage",
            mainEntity: form.faqs.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: { "@type": "Answer", text: faq.answer },
            })),
          }
        : null;
    return JSON.stringify(
      {
        "@context": "https://schema.org",
        "@type": form.schema_type || "BlogPosting",
        headline: form.meta_title || form.title,
        description: form.meta_description || form.excerpt,
        author: form.author_name ? { "@type": "Person", name: form.author_name } : undefined,
        mainEntityOfPage: form.canonical_url || undefined,
        citation: (sources.data ?? []).map((source) => source.url),
        ...(faqBlock ? { hasPart: faqBlock } : {}),
      },
      null,
      2,
    );
  }, [form, sources.data]);

  if (article.isLoading || !form) {
    return <p className="text-sm text-muted-foreground">Loading article.</p>;
  }

  if (!article.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Article not found" description="This article no longer exists." />
        <Button asChild variant="outline">
          <Link to="/admin/journal">Back to Journal</Link>
        </Button>
      </div>
    );
  }

  const unverified = (sources.data ?? []).filter((s) => !s.verified).length;
  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Journal"
        title={form.title || "Untitled article"}
        description={`Workflow stage: ${WORKFLOW_STAGE_LABEL[form.stage]}`}
        actions={
          <>
            <StatusPill tone={statusTone(form.status)}>
              {WORKFLOW_STATUS_LABEL[form.status]}
            </StatusPill>
            <Button variant="outline" asChild>
              <Link to="/admin/journal">Back</Link>
            </Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              {save.isPending ? "Saving" : "Save"}
            </Button>
          </>
        }
      />

      {form.status === "published" && unverified > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
          {unverified} source{unverified === 1 ? "" : "s"} remain unverified. Verify every source
          before this article stays published.
        </div>
      ) : null}

      <Tabs defaultValue="content">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="links">Internal links</TabsTrigger>
          <TabsTrigger value="faqs">FAQs</TabsTrigger>
          <TabsTrigger value="seo">Metadata and schema</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="mt-6 space-y-6">
          <SectionCard title="Article">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={form.title} onChange={(e) => set("title", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" value={form.slug} onChange={(e) => set("slug", e.target.value)} />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="excerpt">Excerpt</Label>
                <Textarea
                  id="excerpt"
                  rows={3}
                  value={form.excerpt}
                  onChange={(e) => set("excerpt", e.target.value)}
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="body">Body (markdown)</Label>
                <Textarea
                  id="body"
                  rows={16}
                  className="font-mono text-xs"
                  value={form.body_markdown}
                  onChange={(e) => set("body_markdown", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="author">Author</Label>
                <Input
                  id="author"
                  value={form.author_name}
                  onChange={(e) => set("author_name", e.target.value)}
                />
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="sources" className="mt-6 space-y-6">
          <SectionCard
            title="Sources and citations"
            description="Every factual claim needs a stored source. Sources are visible to readers on published articles."
          >
            <form
              className="grid gap-3 sm:grid-cols-[2fr_2fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                if (!sourceUrl.trim()) return;
                addSource.mutate();
              }}
            >
              <Input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://example.com/reference"
                inputMode="url"
              />
              <Input
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                placeholder="Source title"
              />
              <Button type="submit" disabled={addSource.isPending}>
                Add source
              </Button>
            </form>

            <ul className="mt-5 divide-y divide-border">
              {(sources.data ?? []).map((source) => (
                <li key={source.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{source.title ?? source.url}</p>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {source.url}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={source.verified ? "secondary" : "outline"}
                      size="sm"
                      onClick={() =>
                        toggleSource.mutate({ id: source.id, verified: !source.verified })
                      }
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      {source.verified ? "Verified" : "Mark verified"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove source"
                      onClick={() => deleteSource.mutate(source.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {(sources.data ?? []).length === 0 ? (
                <li className="py-4 text-sm text-muted-foreground">
                  No sources stored. Research must run before drafting anything time sensitive.
                </li>
              ) : null}
            </ul>
          </SectionCard>
        </TabsContent>

        <TabsContent value="links" className="mt-6 space-y-6">
          <SectionCard
            title="Internal link suggestions"
            description="Suggested links to products, collections and other articles. Accept the ones that genuinely help the reader."
          >
            <form
              className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                if (!anchor.trim() || !targetReference.trim()) return;
                addLink.mutate();
              }}
            >
              <Input
                value={anchor}
                onChange={(e) => setAnchor(e.target.value)}
                placeholder="Anchor text"
              />
              <Select value={targetType} onValueChange={(v) => setTargetType(v as SeoTargetType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {humanise(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={targetReference}
                onChange={(e) => setTargetReference(e.target.value)}
                placeholder="Handle, slug or path"
              />
              <Button type="submit" disabled={addLink.isPending}>
                Add
              </Button>
            </form>

            <ul className="mt-5 divide-y divide-border">
              {(links.data ?? []).map((link) => (
                <li key={link.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{link.anchor_text}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {humanise(link.target_type)} · {link.target_reference}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={link.accepted ? "secondary" : "outline"}
                    onClick={() => toggleLink.mutate({ id: link.id, accepted: !link.accepted })}
                  >
                    {link.accepted ? "Accepted" : "Accept"}
                  </Button>
                </li>
              ))}
              {(links.data ?? []).length === 0 ? (
                <li className="py-4 text-sm text-muted-foreground">
                  No suggestions yet. The internal links stage produces these from the article body
                  and the synced catalogue.
                </li>
              ) : null}
            </ul>
          </SectionCard>
        </TabsContent>

        <TabsContent value="faqs" className="mt-6 space-y-6">
          <SectionCard
            title="FAQs"
            description="Short answerable questions used for readers, FAQ structured data and answer engines."
          >
            <div className="space-y-4">
              {form.faqs.map((faq, index) => (
                <div key={index} className="rounded-lg border border-border p-4">
                  <Input
                    value={faq.question}
                    placeholder="Question"
                    onChange={(e) => {
                      const next = [...form.faqs];
                      next[index] = { ...faq, question: e.target.value };
                      set("faqs", next);
                    }}
                  />
                  <Textarea
                    className="mt-3"
                    rows={3}
                    value={faq.answer}
                    placeholder="Answer"
                    onChange={(e) => {
                      const next = [...form.faqs];
                      next[index] = { ...faq, answer: e.target.value };
                      set("faqs", next);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => set("faqs", form.faqs.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => set("faqs", [...form.faqs, { question: "", answer: "" }])}
              >
                Add question
              </Button>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="seo" className="mt-6 space-y-6">
          <SectionCard title="Metadata">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="metaTitle">Meta title</Label>
                <Input
                  id="metaTitle"
                  value={form.meta_title}
                  onChange={(e) => set("meta_title", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{form.meta_title.length} characters</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="canonical">Canonical URL</Label>
                <Input
                  id="canonical"
                  value={form.canonical_url}
                  onChange={(e) => set("canonical_url", e.target.value)}
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="metaDescription">Meta description</Label>
                <Textarea
                  id="metaDescription"
                  rows={3}
                  value={form.meta_description}
                  onChange={(e) => set("meta_description", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {form.meta_description.length} characters
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="schemaType">Schema type</Label>
                <Input
                  id="schemaType"
                  value={form.schema_type}
                  onChange={(e) => set("schema_type", e.target.value)}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Structured data preview"
            description="Generated from the fields above and the stored sources. Nothing is emitted publicly yet."
          >
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-relaxed text-foreground">
              {structuredDataPreview}
            </pre>
          </SectionCard>
        </TabsContent>

        <TabsContent value="workflow" className="mt-6 space-y-6">
          <SectionCard title="Status and scheduling">
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => set("status", v as WorkflowStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {WORKFLOW_STATUS_LABEL[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Stage</Label>
                <Select value={form.stage} onValueChange={(v) => set("stage", v as WorkflowStage)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_OPTIONS.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        {WORKFLOW_STAGE_LABEL[stage]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduledFor">Scheduled for</Label>
                <Input
                  id="scheduledFor"
                  type="datetime-local"
                  value={form.scheduled_for}
                  onChange={(e) => set("scheduled_for", e.target.value)}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Live research"
            description="Searches the configured research provider and stores every result as an unverified source record. Nothing is written into the article body and nothing is approved. A person opens each source, checks it and marks it verified in the Sources tab."
          >
            {aiStatus.data?.researchConfigured ? (
              <p className="text-xs text-muted-foreground">
                Research provider {aiStatus.data.researchProviderId ?? "tavily"} is configured.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Live web research is the one editorial capability the managed platform does not
                provide, so it stays optional and switched off. To enable it, add{" "}
                {(aiStatus.data?.researchMissing ?? ["RESEARCH_PROVIDER_API_KEY"]).join(", ")} as a
                server secret, and RESEARCH_PROVIDER_ID if you are not using the default provider.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="researchQuery">Search query</Label>
                <Input
                  id="researchQuery"
                  value={researchQuery}
                  placeholder="Leave empty to use the brief target query or the article title"
                  onChange={(e) => setResearchQuery(e.target.value)}
                  disabled={!aiStatus.data?.researchConfigured}
                />
              </div>
              <Button
                variant="outline"
                disabled={!aiStatus.data?.researchConfigured || research.isPending}
                onClick={() => research.mutate()}
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                {research.isPending ? "Researching" : "Run research"}
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Results arrive unverified. Claims may only rely on a source after a person verifies
              it.
            </p>
          </SectionCard>

          <SectionCard
            title="Assisted generation"

            description="Runs one stage at a time against the brief, the article body and the stored sources. Every run is recorded with provider, model and outcome. Research, verification, approval and scheduling stay with a person."
          >
            {aiStatus.data?.configured ? (
              <p className="text-xs text-muted-foreground">
                Managed AI is active, running {aiStatus.data.model}. No model keys are required.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Managed AI is temporarily unavailable. Generation will resume automatically, and
                nothing is published in the meantime.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {RUNNABLE_STAGES.map((stage) => (
                <Button
                  key={stage}
                  size="sm"
                  variant="outline"
                  disabled={!aiStatus.data?.configured || runStage.isPending}
                  onClick={() => runStage.mutate(stage)}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {WORKFLOW_STAGE_LABEL[stage]}
                </Button>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-border p-4">
              <p className="text-sm text-foreground">Hero and social preview image</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Produces a branded editorial image for the article page, the Journal index and link
                previews. If image generation is unavailable it falls back to genuine catalogue
                photography from a linked product or collection.
              </p>
              {article.data?.hero_image_url ? (
                <img
                  src={article.data.hero_image_url}
                  alt={article.data.hero_image_alt ?? ""}
                  className="mt-3 h-32 w-full rounded-md object-cover"
                />
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No hero image set yet.</p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={generateHero.isPending}
                onClick={() => generateHero.mutate()}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {article.data?.hero_image_url ? "Replace hero image" : "Create hero image"}
              </Button>
            </div>


            <div className="mt-6 border-t border-border pt-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Recent runs
              </p>
              {(runs.data ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No runs recorded yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {(runs.data ?? []).map((run) => (
                    <li key={run.id} className="flex items-start justify-between gap-3 py-3">
                      <div>
                        <p className="text-sm text-foreground">
                          {WORKFLOW_STAGE_LABEL[run.stage]}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {run.provider ?? "No provider"} {run.model ? `· ${run.model}` : ""} ·{" "}
                          {new Date(run.created_at).toLocaleString()}
                          {run.error_message ? ` · ${run.error_message}` : ""}
                        </p>
                      </div>
                      <StatusPill tone={statusTone(run.status)}>{humanise(run.status)}</StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Pipeline">
            <ol className="space-y-3">
              {WORKFLOW_PIPELINE.map((stage) => (
                <li
                  key={stage.stage}
                  className={
                    stage.stage === form.stage
                      ? "rounded-lg border border-primary/40 bg-accent/50 p-4"
                      : "rounded-lg border border-border p-4"
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{stage.label}</p>
                    {stage.requiresLiveResearch ? (
                      <StatusPill tone="pending">Live research</StatusPill>
                    ) : null}
                    {stage.requiresHumanApproval ? (
                      <StatusPill tone="warning">Human approval</StatusPill>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {stage.summary}
                  </p>
                </li>
              ))}
            </ol>
          </SectionCard>

        </TabsContent>
      </Tabs>
    </div>
  );
}
