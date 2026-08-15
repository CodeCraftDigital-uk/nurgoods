import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SeoCoverageResult, SeoPlanResult } from "./seo.server";

/** Mirrors real Journal and catalogue rows into SEO coverage records. */
export const syncSeoCoverageRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeoCoverageResult> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { syncSeoCoverage } = await import("./seo.server");
    return syncSeoCoverage(context.supabase);
  });

/** Drafts query, intent, metadata and answerable questions for one record. */
export const runSeoRecordPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { recordId: string }) => {
    if (!input?.recordId) throw new Error("A record is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<SeoPlanResult> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { runSeoPlan } = await import("./seo.server");
    return runSeoPlan(context.supabase, { recordId: data.recordId, userId: context.userId });
  });
