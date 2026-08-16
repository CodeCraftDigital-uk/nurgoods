import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PUBLIC_HOST } from "@/lib/hosts";
import type { IntakeCounters, IntakePolicy, IntakeRecord, IntakeState } from "./types";

/** Public callback Shopify posts product events to. */
export function intakeCallbackUrl(): string {
  const base = (process.env["PUBLIC_SITE_URL"] ?? `https://${PUBLIC_HOST}`).replace(/\/+$/, "");
  return `${base}/api/public/hooks/shopify-intake`;
}


/** Admin-only control plane for the automated product intake system. */

async function assertAdmin(context: { supabase: any; userId: string }): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

export interface IntakeWebhookState {
  supported: boolean;
  registered: string[];
  missing: string[];
  callbackUrl: string;
  error: string | null;
}

export interface IntakeOverview {
  counters: IntakeCounters;
  policy: IntakePolicy;
  records: IntakeRecord[];
  webhook: IntakeWebhookState;
}


export const getIntakeOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { state?: string; search?: string }) => input ?? {})
  .handler(async ({ data, context }): Promise<IntakeOverview> => {
    await assertAdmin(context as never);
    const { getIntakePolicy, intakeCounters } = await import("./intake.server");

    let builder = context.supabase
      .from("product_intake_records")
      .select(
        "id, shopify_product_id, product_id, title, handle, source, state, reason_code, reason, attempts, validation, detected_at, last_transition_at, approved_at, published_at",
      )
      .order("last_transition_at", { ascending: false })
      .limit(60);
    if (data.state && data.state !== "all") builder = builder.eq("state", data.state);
    if (data.search) {
      const term = data.search.replace(/[%,()]/g, " ").trim();
      if (term) builder = builder.or(`title.ilike.%${term}%,shopify_product_id.ilike.%${term}%,handle.ilike.%${term}%`);
    }

    const [{ data: rows }, counters, policy] = await Promise.all([
      builder,
      intakeCounters(context.supabase as never),
      getIntakePolicy(context.supabase as never),
    ]);

    const { getWebhookSubscriptionState } = await import("@/lib/services/shopify.server");
    const webhook = await getWebhookSubscriptionState(intakeCallbackUrl());

    return {
      counters,
      policy,
      records: (rows ?? []) as unknown as IntakeRecord[],
      webhook,
    };

  });

export const updateIntakePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { key: string; value: boolean }) => {
    if (!input?.key) throw new Error("A setting is required");
    return { key: input.key, value: Boolean(input.value) };
  })
  .handler(async ({ data, context }): Promise<IntakePolicy> => {
    await assertAdmin(context as never);
    const { DEFAULT_INTAKE_POLICY } = await import("./types");
    if (!(data.key in DEFAULT_INTAKE_POLICY)) throw new Error("That setting does not exist");

    const { error } = await context.supabase
      .from("product_intake_policy")
      .update({ [data.key]: data.value } as never)
      .eq("id", "default");
    if (error) throw new Error(error.message);

    const { getIntakePolicy } = await import("./intake.server");
    return getIntakePolicy(context.supabase as never);
  });

export const retryIntakeRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { intakeId: string }) => {
    if (!input?.intakeId) throw new Error("A record is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context as never);
    const { retryIntake } = await import("./intake.server");
    await retryIntake(context.supabase as never, data.intakeId);
    return { ok: true };
  });

export const registerIntakeWebhookSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntakeWebhookState> => {
    await assertAdmin(context as never);
    const { registerIntakeWebhooks } = await import("@/lib/services/shopify.server");
    return registerIntakeWebhooks(intakeCallbackUrl());

  });

export const getIntakeHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { intakeId: string }) => {
    if (!input?.intakeId) throw new Error("A record is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { data: rows } = await context.supabase
      .from("product_intake_events")
      .select("id, from_state, to_state, reason_code, message, created_at")
      .eq("intake_id", data.intakeId)
      .order("created_at", { ascending: false })
      .limit(40);
    return ((rows ?? []) as Array<{
      id: string;
      from_state: IntakeState | null;
      to_state: IntakeState;
      reason_code: string | null;
      message: string | null;
      created_at: string;
    }>);
  });
