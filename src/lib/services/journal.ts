import { supabase } from "@/integrations/supabase/client";
import type {
  AiGenerationRun,
  Article,
  ArticleBrief,
  ArticleInternalLink,
  ArticleSource,
  ArticleUpdate,
} from "@/lib/types/platform";

export async function listArticles(): Promise<Article[]> {
  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getArticle(id: string): Promise<Article | null> {
  const { data, error } = await supabase.from("articles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createArticle(input: {
  title: string;
  slug: string;
  briefId?: string | null;
}): Promise<Article> {
  const { data, error } = await supabase
    .from("articles")
    .insert({ title: input.title, slug: input.slug, brief_id: input.briefId ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateArticle(id: string, patch: ArticleUpdate): Promise<Article> {
  const { data, error } = await supabase
    .from("articles")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteArticle(id: string): Promise<void> {
  const { error } = await supabase.from("articles").delete().eq("id", id);
  if (error) throw error;
}

export async function listArticleSources(articleId: string): Promise<ArticleSource[]> {
  const { data, error } = await supabase
    .from("article_sources")
    .select("*")
    .eq("article_id", articleId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addArticleSource(input: {
  articleId: string;
  url: string;
  title?: string | null;
  publisher?: string | null;
}): Promise<ArticleSource> {
  const { data, error } = await supabase
    .from("article_sources")
    .insert({
      article_id: input.articleId,
      url: input.url,
      title: input.title ?? null,
      publisher: input.publisher ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setSourceVerified(id: string, verified: boolean): Promise<void> {
  const { error } = await supabase.from("article_sources").update({ verified }).eq("id", id);
  if (error) throw error;
}

export async function removeArticleSource(id: string): Promise<void> {
  const { error } = await supabase.from("article_sources").delete().eq("id", id);
  if (error) throw error;
}

export async function listInternalLinks(articleId: string): Promise<ArticleInternalLink[]> {
  const { data, error } = await supabase
    .from("article_internal_links")
    .select("*")
    .eq("article_id", articleId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addInternalLink(input: {
  articleId: string;
  anchorText: string;
  targetType: ArticleInternalLink["target_type"];
  targetReference: string;
  rationale?: string | null;
}): Promise<ArticleInternalLink> {
  const { data, error } = await supabase
    .from("article_internal_links")
    .insert({
      article_id: input.articleId,
      anchor_text: input.anchorText,
      target_type: input.targetType,
      target_reference: input.targetReference,
      rationale: input.rationale ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setInternalLinkAccepted(id: string, accepted: boolean): Promise<void> {
  const { error } = await supabase
    .from("article_internal_links")
    .update({ accepted })
    .eq("id", id);
  if (error) throw error;
}

export async function listBriefs(): Promise<ArticleBrief[]> {
  const { data, error } = await supabase
    .from("article_briefs")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createBrief(input: {
  title: string;
  targetQuery?: string | null;
  searchIntent?: string | null;
  requiresLiveResearch?: boolean;
}): Promise<ArticleBrief> {
  const { data, error } = await supabase
    .from("article_briefs")
    .insert({
      title: input.title,
      target_query: input.targetQuery ?? null,
      search_intent: input.searchIntent ?? null,
      requires_live_research: input.requiresLiveResearch ?? false,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listArticleRuns(articleId: string): Promise<AiGenerationRun[]> {
  const { data, error } = await supabase
    .from("ai_generation_runs")
    .select("*")
    .eq("entity_type", "article")
    .eq("entity_id", articleId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data;
}
