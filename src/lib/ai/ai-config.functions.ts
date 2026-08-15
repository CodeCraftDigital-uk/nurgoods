import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AiProviderStatus } from "./provider";

/**
 * Reports whether server side AI credentials are present. It returns booleans
 * and non secret identifiers only. Secret values are never sent to the client.
 */
export const getAiProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiProviderStatus> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const providerId = process.env["AI_PROVIDER_ID"]?.trim() || null;
    const apiKey = process.env["AI_PROVIDER_API_KEY"]?.trim() || null;
    const model = process.env["AI_PROVIDER_MODEL"]?.trim() || null;
    const researchKey = process.env["RESEARCH_PROVIDER_API_KEY"]?.trim() || null;
    const researchProviderId = process.env["RESEARCH_PROVIDER_ID"]?.trim() || null;

    const missing: string[] = [];
    if (!providerId) missing.push("AI_PROVIDER_ID");
    if (!apiKey) missing.push("AI_PROVIDER_API_KEY");
    if (!model) missing.push("AI_PROVIDER_MODEL");

    return {
      configured: missing.length === 0,
      providerId,
      model,
      researchConfigured: Boolean(researchKey),
      researchProviderId,
      researchMissing: researchKey ? [] : ["RESEARCH_PROVIDER_API_KEY"],
      missing,
    };
  });
