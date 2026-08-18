/**
 * Admin console data for the sales channel architecture.
 *
 * Read only. It resolves the desired channel state live from the store and
 * reads the most recent audit run so an operator can see drift without
 * touching anything.
 */
import { zendropAdminClient } from "./client.server";
import { readChannelChecklist } from "./publication-audit.server";
import type { PublicationConsoleView } from "./publication.functions";

export async function assertPublicationAdmin(context: {
  supabase: any;
  userId: string;
}): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

export async function loadPublicationConsole(): Promise<PublicationConsoleView> {
  const checklist = await readChannelChecklist();
  const supabase = await zendropAdminClient();

  const { data: runs } = await (supabase as any)
    .from("publication_audit_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);
  const run = (runs ?? [])[0] ?? null;

  let items: PublicationConsoleView["lastItems"] = [];
  if (run?.id) {
    const { data: rows } = await (supabase as any)
      .from("publication_audit_items")
      .select("*")
      .eq("run_id", run.id)
      .order("drifted", { ascending: false })
      .limit(300);
    items = (rows ?? []).map((row: any) => ({
      shopifyProductId: String(row.shopify_product_id),
      title: row.product_title ?? null,
      currentChannels: row.current_channels ?? [],
      desiredChannels: row.desired_channels ?? [],
      drifted: Boolean(row.drifted),
      changed: Boolean(row.changed),
      message: row.message ?? null,
    }));
  }

  return {
    checklist,
    lastRun: run
      ? {
          id: String(run.id),
          mode: String(run.mode),
          status: String(run.status),
          inspected: Number(run.products_inspected ?? 0),
          drifted: Number(run.products_drifted ?? 0),
          changed: Number(run.products_changed ?? 0),
          createdAt: String(run.created_at),
          note: run.note ?? null,
        }
      : null,
    lastItems: items,
  };
}
