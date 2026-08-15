import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WorkflowStage } from "@/lib/types/platform";
import type { StageRunResult } from "./runtime.server";
import type { ResearchRunResult } from "./research.server";
import type { HeroImageResult } from "./hero-image.server";

/** Runs one editorial workflow stage for an article and records the run. */
export const runArticleStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { articleId: string; stage: WorkflowStage }) => {
    if (!input?.articleId) throw new Error("An article is required");
    if (!input?.stage) throw new Error("A stage is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<StageRunResult> => {
    const { runStage } = await import("./runtime.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    return runStage(context.supabase, {
      articleId: data.articleId,
      stage: data.stage,
      userId: context.userId,
    });
  });

/** Runs live research for an article and stores unverified source records. */
export const runArticleResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { articleId: string; query?: string; freshnessDays?: number }) => {
    if (!input?.articleId) throw new Error("An article is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<ResearchRunResult> => {
    const { runResearch } = await import("./research.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    return runResearch(context.supabase, {
      articleId: data.articleId,
      userId: context.userId,
      ...(data.query ? { query: data.query } : {}),
      ...(data.freshnessDays ? { freshnessDays: data.freshnessDays } : {}),
    });
  });

/** Produces a hero and social preview image for an article. */
export const generateArticleHero = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { articleId: string }) => {
    if (!input?.articleId) throw new Error("An article is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<HeroImageResult> => {
    const { generateArticleHeroImage } = await import("./hero-image.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    return generateArticleHeroImage(context.supabase, {
      articleId: data.articleId,
      userId: context.userId,
    });
  });
