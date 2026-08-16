import { supabase } from "@/integrations/supabase/client";
import type { AiProviderStatus } from "@/lib/ai/provider";

export interface ChecklistItem {
  key: string;
  label: string;
  description: string;
  complete: boolean;
  blockedBy: string;
  href: string;
}

export interface OnboardingState {
  items: ChecklistItem[];
  completed: number;
  total: number;
}

async function countRows(table: "shopify_products" | "articles"): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function countPublishedArticles(): Promise<number> {
  const { count, error } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .not("published_at", "is", null);
  if (error) throw error;
  return count ?? 0;
}

async function countPublishedPolicies(): Promise<number> {
  const { count, error } = await supabase
    .from("legal_documents")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .eq("is_placeholder", false);
  if (error) throw error;
  return count ?? 0;
}

export async function getOnboardingState(
  aiStatus: AiProviderStatus | null,
): Promise<OnboardingState> {
  const [
    { data: integrations, error },
    productCount,
    articleCount,
    publishedArticles,
    publishedPolicies,
    placements,
  ] = await Promise.all([
    supabase.from("integrations").select("provider,status"),
    countRows("shopify_products"),
    countRows("articles"),
    countPublishedArticles(),
    countPublishedPolicies(),
    supabase.from("review_placements").select("enabled,embed_snippet"),
  ]);
  if (error) throw error;

  const byProvider = new Map((integrations ?? []).map((i) => [i.provider, i.status]));
  const publikoConfigured = (placements.data ?? []).some(
    (p) => p.enabled && Boolean(p.embed_snippet),
  );

  const items: ChecklistItem[] = [
    {
      key: "shopify",
      label: "Shopify catalogue sync",
      description:
        "Connect the Shopify Admin API so products and collections can be mirrored read only.",
      complete: byProvider.get("shopify") === "connected" && productCount > 0,
      blockedBy: "Shopify Admin API credentials and store domain.",
      href: "/control/integrations",
    },
    {
      key: "ai",
      label: "Editorial AI",
      description:
        "Managed AI powers every generation stage. No keys or accounts are needed from you.",
      complete: Boolean(aiStatus?.configured),
      blockedBy: "Managed AI availability for this workspace.",
      href: "/control/integrations",
    },
    {
      key: "publiko",
      label: "Publiko reviews",
      description:
        "Paste the embed code Publiko gives you, assign it to a placement, then enable it.",
      complete: publikoConfigured,
      blockedBy: "Publiko embed code for at least one placement.",
      href: "/control/reviews",
    },
    {
      key: "publishing",
      label: "Publishing workflow",
      description:
        articleCount > 0 && publishedArticles === 0
          ? "Articles exist in the workflow. Approve and publish one to make the Journal live."
          : "Create a brief, take an article through the workflow and publish it to prove the pipeline.",
      complete: publishedArticles > 0,
      blockedBy: "At least one approved and published article in the Journal.",
      href: "/control/journal",
    },
    {
      key: "policies",
      label: "Policy pages",
      description:
        "Paste the approved wording for each policy and publish it so the public policy pages appear.",
      complete: publishedPolicies > 0,
      blockedBy: "Owner approved wording for the trust and policy documents.",
      href: "/control/legal",
    },
  ];

  return { items, completed: items.filter((i) => i.complete).length, total: items.length };
}
