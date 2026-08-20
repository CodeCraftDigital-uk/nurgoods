import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ChannelChecklist, PublicationAuditRun } from "./publication-audit.server";

export interface PublicationConsoleView {
  checklist: ChannelChecklist;
  lastRun: {
    id: string;
    mode: string;
    status: string;
    inspected: number;
    drifted: number;
    changed: number;
    createdAt: string;
    note: string | null;
  } | null;
  lastItems: Array<{
    shopifyProductId: string;
    title: string | null;
    currentChannels: string[];
    desiredChannels: string[];
    drifted: boolean;
    changed: boolean;
    message: string | null;
    /** The store's reason for refusing Shop, when it refused. Not drift. */
    shopException: string | null;
  }>;
}

export const getPublicationConsole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PublicationConsoleView> => {
    const { assertPublicationAdmin, loadPublicationConsole } = await import(
      "./publication-console.server"
    );
    await assertPublicationAdmin(context as never);
    return loadPublicationConsole();
  });

/**
 * Bounded read only check that sampled sellable products are live on all three
 * selling surfaces at the NUR GOODS price. Nothing is changed.
 */
export const verifySurfaceParityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { assertPublicationAdmin } = await import("./publication-console.server");
    await assertPublicationAdmin(context as never);
    const { verifySurfaceParity } = await import("./publication-audit.server");
    return verifySurfaceParity({ limit: data.limit ?? 25 });
  });

export const runPublicationAuditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { limit?: number; shopifyProductId?: string } | undefined) => input ?? {},
  )
  .handler(async ({ data, context }): Promise<PublicationAuditRun> => {
    const { assertPublicationAdmin } = await import("./publication-console.server");
    await assertPublicationAdmin(context as never);
    const { runPublicationAudit } = await import("./publication-audit.server");
    return runPublicationAudit({
      dryRun: true,
      limit: data.limit,
      shopifyProductId: data.shopifyProductId,
      actorId: (context as any).userId ?? null,
    });
  });

export const migratePublicationsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { confirm: string; limit?: number; shopifyProductId?: string }) => {
    if (input?.confirm !== "HEADLESS PLUS SHOP") {
      throw new Error("Type HEADLESS PLUS SHOP to confirm a live channel migration.");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<PublicationAuditRun> => {
    const { assertPublicationAdmin } = await import("./publication-console.server");
    await assertPublicationAdmin(context as never);
    const { runPublicationAudit } = await import("./publication-audit.server");
    return runPublicationAudit({
      dryRun: false,
      limit: data.limit ?? 10,
      shopifyProductId: data.shopifyProductId,
      actorId: (context as any).userId ?? null,
    });
  });
