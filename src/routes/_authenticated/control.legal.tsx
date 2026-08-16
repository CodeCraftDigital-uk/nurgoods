import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { listLegalDocuments, updateLegalDocument } from "@/lib/services/operations";
import { LegalSourcesPanel } from "@/components/admin/LegalSourcesPanel";

export const Route = createFileRoute("/_authenticated/control/legal")({
  component: LegalPage,
});

function LegalPage() {
  const queryClient = useQueryClient();
  const documents = useQuery({ queryKey: ["legal-documents"], queryFn: listLegalDocuments });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");

  const selected = (documents.data ?? []).find((doc) => doc.id === selectedId) ?? null;

  const save = useMutation({
    mutationFn: () =>
      updateLegalDocument(selectedId!, {
        body_markdown: body,
        summary: summary.trim() || null,
        is_placeholder: body.trim().length === 0,
        last_reviewed_at: new Date().toISOString(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["legal-documents"] });
      toast.success("Document saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setStatus = useMutation({
    mutationFn: (status: "draft" | "published") =>
      updateLegalDocument(selectedId!, {
        status,
        is_placeholder: body.trim().length === 0,
        last_reviewed_at: new Date().toISOString(),
      }),
    onSuccess: async (_data, status) => {
      await queryClient.invalidateQueries({ queryKey: ["legal-documents"] });
      await queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success(status === "published" ? "Document published" : "Document unpublished");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canPublish = Boolean(selected) && body.trim().length > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Legal and Trust"
        title="Policy documents"
        description="Legal wording is imported from the store and the store stays authoritative. Locally authored records below cover anything the store does not hold. Nothing is written for you, and no registrations or legal facts are invented."
      />

      <LegalSourcesPanel />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <SectionCard title="Documents">
          <ul className="divide-y divide-border">
            {(documents.data ?? []).map((doc) => (
              <li key={doc.id}>
                <button
                  onClick={() => {
                    setSelectedId(doc.id);
                    setBody(doc.body_markdown);
                    setSummary(doc.summary ?? "");
                  }}
                  className={
                    doc.id === selectedId
                      ? "flex min-h-11 w-full items-center justify-between gap-2 rounded-md bg-accent px-2 py-2 text-left"
                      : "flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
                  }
                >
                  <span className="text-sm text-foreground">{doc.title}</span>
                  <StatusPill tone={doc.is_placeholder ? "warning" : statusTone(doc.status)}>
                    {doc.is_placeholder ? "Placeholder" : humanise(doc.status)}
                  </StatusPill>
                </button>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title={selected ? selected.title : "Select a document"}
          description={
            selected
              ? `Path: /${selected.slug}. Paste the owner approved wording only.`
              : "Choose a document from the list to edit its content."
          }
          actions={
            selected ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                  className="min-h-11"
                >
                  {save.isPending ? "Saving" : "Save draft"}
                </Button>
                {selected.status === "published" ? (
                  <Button
                    variant="outline"
                    onClick={() => setStatus.mutate("draft")}
                    disabled={setStatus.isPending}
                    className="min-h-11"
                  >
                    Unpublish
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      save.mutate(undefined, { onSuccess: () => setStatus.mutate("published") });
                    }}
                    disabled={!canPublish || save.isPending || setStatus.isPending}
                    className="min-h-11"
                  >
                    Publish
                  </Button>
                )}
              </div>
            ) : undefined
          }
        >
          {selected ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="legalSummary">Summary shown on the public policy list</Label>
                <Input
                  id="legalSummary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="One short line describing this document"
                />
              </div>
              <Label htmlFor="legalBody">Document content (markdown)</Label>
              <Textarea
                id="legalBody"
                rows={18}
                className="font-mono text-xs"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Awaiting owner supplied text."
              />
              <p className="text-xs text-muted-foreground">
                Content stays a placeholder while this field is empty, so nothing incorrect can be
                presented as a policy. Publishing makes the document visible at /
                {selected.slug ? `legal/${selected.slug}` : "legal"} and adds it to the sitemap.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No document selected.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
