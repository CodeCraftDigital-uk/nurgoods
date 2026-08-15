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

export async function getOnboardingState(
  aiStatus: AiProviderStatus | null,
): Promise<OnboardingState> {
  const [{ data: integrations, error }, productCount, articleCount, placements] =
    await Promise.all([
      supabase.from("integrations").select("provider,status"),
      countRows("shopify_products"),
      countRows("articles"),
      supabase.from("review_placements").select("enabled,widget_reference"),
    ]);
  if (error) throw error;

  const byProvider = new Map((integrations ?? []).map((i) => [i.provider, i.status]));
  const publikoConfigured = (placements.data ?? []).some(
    (p) => p.enabled && Boolean(p.widget_reference),
  );

  const items: ChecklistItem[] = [
    {
      key: "shopify",
      label: "Shopify catalogue sync",
      description:
        "Connect the Shopify Admin API so products and collections can be mirrored read only.",
      complete: byProvider.get("shopify") === "connected" && productCount > 0,
      blockedBy: "Shopify Admin API credentials and store domain.",
      href: "/admin/integrations",
    },
    {
      key: "ai",
      label: "AI provider",
      description:
        "Add server side AI credentials so the editorial workflow can run generation stages.",
      complete: Boolean(aiStatus?.configured),
      blockedBy: "AI provider identifier, model and API key held as server secrets.",
      href: "/admin/integrations",
    },
    {
      key: "publiko",
      label: "Publiko reviews",
      description:
        "Supply the Publiko account and embed details, then enable the widget placements you need.",
      complete: publikoConfigured,
      blockedBy: "Publiko widget references and embed details.",
      href: "/admin/reviews",
    },
    {
      key: "publishing",
      label: "Publishing workflow",
      description:
        "Create a brief, take an article through the workflow and publish it to prove the pipeline.",
      complete: articleCount > 0,
      blockedBy: "At least one approved article in the Journal.",
      href: "/admin/journal",
    },
  ];

  return { items, completed: items.filter((i) => i.complete).length, total: items.length };
}
