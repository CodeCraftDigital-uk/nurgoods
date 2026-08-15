import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createArticle } from "@/lib/services/journal";
import { slugify } from "@/lib/types/platform";

export const Route = createFileRoute("/_authenticated/admin/journal/new")({
  component: NewArticlePage,
});

function NewArticlePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");

  const mutation = useMutation({
    mutationFn: () => createArticle({ title: title.trim(), slug: slug || slugify(title) }),
    onSuccess: async (article) => {
      await queryClient.invalidateQueries({ queryKey: ["articles"] });
      toast.success("Article created as a draft");
      void navigate({ to: "/admin/journal/$articleId", params: { articleId: article.id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const derivedSlug = slug || slugify(title);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Journal"
        title="New article"
        description="Create the record first, then work through research, drafting, verification and metadata in the editor."
        actions={
          <Button variant="outline" asChild>
            <Link to="/admin/journal">Back to Journal</Link>
          </Button>
        }
      />

      <SectionCard>
        <form
          className="max-w-xl space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) {
              toast.error("Add a working title first");
              return;
            }
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="title">Working title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Working title"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              placeholder={derivedSlug || "auto-generated-from-title"}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Published path: /journal/{derivedSlug || "your-slug"}
            </p>
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating" : "Create draft"}
          </Button>
        </form>
      </SectionCard>
    </div>
  );
}
