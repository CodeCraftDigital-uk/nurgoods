import { supabase } from "@/integrations/supabase/client";
import type { SeoEntity, SeoQuestion, SeoRecord } from "@/lib/types/platform";

export async function listSeoRecords(): Promise<SeoRecord[]> {
  const { data, error } = await supabase
    .from("seo_records")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createSeoRecord(input: {
  targetType: SeoRecord["target_type"];
  targetReference: string;
  targetLabel?: string | null;
  targetQuery?: string | null;
  searchIntent?: string | null;
}): Promise<SeoRecord> {
  const { data, error } = await supabase
    .from("seo_records")
    .insert({
      target_type: input.targetType,
      target_reference: input.targetReference,
      target_label: input.targetLabel ?? null,
      target_query: input.targetQuery ?? null,
      search_intent: input.searchIntent ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateSeoRecord(
  id: string,
  patch: Partial<SeoRecord>,
): Promise<SeoRecord> {
  const { data, error } = await supabase
    .from("seo_records")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listSeoEntities(): Promise<SeoEntity[]> {
  const { data, error } = await supabase
    .from("seo_entities")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createSeoEntity(input: {
  name: string;
  entityType?: string | null;
  description?: string | null;
}): Promise<SeoEntity> {
  const { data, error } = await supabase
    .from("seo_entities")
    .insert({
      name: input.name,
      entity_type: input.entityType ?? null,
      description: input.description ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listSeoQuestions(recordId: string): Promise<SeoQuestion[]> {
  const { data, error } = await supabase
    .from("seo_questions")
    .select("*")
    .eq("seo_record_id", recordId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addSeoQuestion(input: {
  recordId: string;
  question: string;
  answer?: string | null;
}): Promise<SeoQuestion> {
  const { data, error } = await supabase
    .from("seo_questions")
    .insert({
      seo_record_id: input.recordId,
      question: input.question,
      answer: input.answer ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
