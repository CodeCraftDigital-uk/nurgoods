import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { JobRunResult } from "./runner.server";

/** Runs one automation job on demand and records the outcome on the job row. */
export const runAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { jobKey: string }) => {
    if (!input?.jobKey) throw new Error("A job is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<JobRunResult> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { runAutomationJob } = await import("./runner.server");
    return runAutomationJob(
      { supabase: context.supabase, userId: context.userId },
      data.jobKey,
    );
  });

export interface AutomationReadiness {
  shopify: boolean;
  managedAi: boolean;
  research: boolean;
}

/** Reports which capabilities the jobs depend on are genuinely available. */
export const getAutomationReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomationReadiness> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { readShopifyCredentials } = await import("@/lib/services/shopify.server");
    const { isManagedAiAvailable } = await import("@/lib/ai/gateway.server");

    return {
      shopify: readShopifyCredentials().missing.length === 0,
      managedAi: isManagedAiAvailable(),
      research: Boolean(process.env["RESEARCH_PROVIDER_API_KEY"]?.trim()),
    };
  });
