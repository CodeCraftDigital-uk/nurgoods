import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AiProviderStatus } from "./provider";

/**
 * Reports editorial AI availability. Generation runs on the platform managed
 * AI service, so no owner supplied model credentials are involved. Only
 * booleans and non secret identifiers are returned.
 */
export const getAiProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiProviderStatus> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { EDITORIAL_MODEL, isManagedAiAvailable } = await import("./gateway.server");
    const managedAvailable = isManagedAiAvailable();

    const researchKey = process.env["RESEARCH_PROVIDER_API_KEY"]?.trim() || null;
    const researchProviderId = process.env["RESEARCH_PROVIDER_ID"]?.trim() || null;

    return {
      configured: managedAvailable,
      managed: true,
      providerId: "Managed AI",
      model: managedAvailable ? EDITORIAL_MODEL : null,
      researchConfigured: Boolean(researchKey),
      researchProviderId,
      researchMissing: researchKey ? [] : ["RESEARCH_PROVIDER_API_KEY"],
      missing: managedAvailable ? [] : ["Managed AI service"],
    };
  });
