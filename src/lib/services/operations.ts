import { supabase } from "@/integrations/supabase/client";
import type {
  AiGenerationRun,
  AutomationJob,
  Integration,
  IntegrationEvent,
  IntegrationSetting,
  LegalDocument,
  McpResource,
  PromptVersion,
  ReviewPlacement,
} from "@/lib/types/platform";

/* ----------------------------- integrations ----------------------------- */

export async function listIntegrations(): Promise<Integration[]> {
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .order("label", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listIntegrationSettings(): Promise<IntegrationSetting[]> {
  const { data, error } = await supabase
    .from("integration_settings")
    .select("*")
    .order("key", { ascending: true });
  if (error) throw error;
  return data;
}

export async function upsertIntegrationSetting(input: {
  integrationId: string;
  key: string;
  label: string;
  value: string | null;
  isSecretReference?: boolean;
  secretName?: string | null;
  helpText?: string | null;
}): Promise<IntegrationSetting> {
  const { data, error } = await supabase
    .from("integration_settings")
    .upsert(
      {
        integration_id: input.integrationId,
        key: input.key,
        label: input.label,
        value: input.isSecretReference ? null : input.value,
        is_secret_reference: input.isSecretReference ?? false,
        secret_name: input.secretName ?? null,
        help_text: input.helpText ?? null,
      },
      { onConflict: "integration_id,key" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listIntegrationEvents(limit = 25): Promise<IntegrationEvent[]> {
  const { data, error } = await supabase
    .from("integration_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/* -------------------------------- reviews -------------------------------- */

export async function listReviewPlacements(): Promise<ReviewPlacement[]> {
  const { data, error } = await supabase
    .from("review_placements")
    .select("*")
    .order("surface", { ascending: true });
  if (error) throw error;
  return data;
}

export async function updateReviewPlacement(
  id: string,
  patch: Partial<ReviewPlacement>,
): Promise<ReviewPlacement> {
  const { data, error } = await supabase
    .from("review_placements")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/* ------------------------------ automations ------------------------------ */

export async function listAutomationJobs(): Promise<AutomationJob[]> {
  const { data, error } = await supabase
    .from("automation_jobs")
    .select("*")
    .order("label", { ascending: true });
  if (error) throw error;
  return data;
}

export async function setAutomationEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from("automation_jobs").update({ enabled }).eq("id", id);
  if (error) throw error;
}

export async function listAiRuns(limit = 25): Promise<AiGenerationRun[]> {
  const { data, error } = await supabase
    .from("ai_generation_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function listPromptVersions(): Promise<PromptVersion[]> {
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("*")
    .order("key", { ascending: true });
  if (error) throw error;
  return data;
}

/* --------------------------------- legal --------------------------------- */

export async function listLegalDocuments(): Promise<LegalDocument[]> {
  const { data, error } = await supabase
    .from("legal_documents")
    .select("*")
    .order("title", { ascending: true });
  if (error) throw error;
  return data;
}

export async function updateLegalDocument(
  id: string,
  patch: Partial<LegalDocument>,
): Promise<LegalDocument> {
  const { data, error } = await supabase
    .from("legal_documents")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/* ---------------------------------- mcp ---------------------------------- */

export async function listMcpResources(): Promise<McpResource[]> {
  const { data, error } = await supabase
    .from("mcp_resources")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}
