import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WorkflowStage } from "@/lib/types/platform";
import type { StageRunResult } from "./runtime.server";

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
