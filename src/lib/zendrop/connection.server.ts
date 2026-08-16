/**
 * Supplier connection state.
 *
 * The token itself lives in the encrypted vault and is never returned to the
 * browser. Only a masked fingerprint, the expiry date and the discovered
 * capabilities are surfaced.
 */
import {
  CAPABILITY_ROLES,
  CAPABILITY_ROLE_LABEL,
  type CapabilityReport,
  type CapabilityRole,
  type ZendropConnectionStatus,
} from "./types";
import {
  ZENDROP_VAULT_SECRET,
  fingerprintToken,
  loadCapabilityMap,
  persistCapabilities,
  probeConnection,
  readZendropToken,
  zendropAdminClient,
} from "./client.server";

const KEYS = {
  fingerprint: "token_fingerprint",
  expiresOn: "token_expires_on",
  scopes: "scopes",
  connectionState: "connection_state",
  lastTestedAt: "last_tested_at",
  lastError: "last_error",
  storeLabel: "store_label",
  testPassedAt: "one_product_test_passed_at",
  massImport: "mass_import_unlocked",
} as const;

const WRITE_ROLE: CapabilityRole = "my_products_import";

async function integrationId(): Promise<string | null> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("integrations")
    .select("id")
    .eq("provider", "zendrop")
    .maybeSingle();
  if ((data as any)?.id) return (data as any).id as string;
  const { data: created } = await supabase
    .from("integrations")
    .upsert(
      { provider: "zendrop", label: "Zendrop", status: "not_connected" } as never,
      { onConflict: "provider" },
    )
    .select("id")
    .maybeSingle();
  return (created as any)?.id ?? null;
}

async function readSettings(): Promise<Map<string, string | null>> {
  const supabase = await zendropAdminClient();
  const id = await integrationId();
  const map = new Map<string, string | null>();
  if (!id) return map;
  const { data } = await supabase
    .from("integration_settings")
    .select("key, value")
    .eq("integration_id", id);
  for (const row of (data ?? []) as any[]) map.set(row.key, row.value ?? null);
  return map;
}

async function writeSetting(key: string, label: string, value: string | null): Promise<void> {
  const supabase = await zendropAdminClient();
  const id = await integrationId();
  if (!id) return;
  await supabase.from("integration_settings").upsert(
    {
      integration_id: id,
      key,
      label,
      value,
      is_secret_reference: false,
      secret_name: null,
    } as never,
    { onConflict: "integration_id,key" },
  );
}

async function setIntegrationStatus(status: string): Promise<void> {
  const supabase = await zendropAdminClient();
  await supabase.from("integrations").update({ status } as never).eq("provider", "zendrop");
}

async function logEvent(eventType: string, status: string, message: string): Promise<void> {
  const supabase = await zendropAdminClient();
  const id = await integrationId();
  await supabase.from("integration_events").insert({
    integration_id: id,
    event_type: eventType,
    status,
    message,
    payload: {},
  } as never);
}

function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return Math.round((parsed - Date.now()) / 86_400_000);
}

function toReports(
  roles: Record<CapabilityRole, { name: string; kind: string } | null>,
): CapabilityReport[] {
  return CAPABILITY_ROLES.map((role) => {
    const action = roles[role];
    return {
      role,
      label: CAPABILITY_ROLE_LABEL[role],
      actionName: action?.name ?? null,
      available: Boolean(action),
      kind: (action?.kind ?? "unknown") as CapabilityReport["kind"],
    };
  });
}

export async function getZendropStatus(): Promise<ZendropConnectionStatus> {
  const token = await readZendropToken();
  const settings = await readSettings();
  const roles = token
    ? await loadCapabilityMap().catch(
        () => ({}) as Record<CapabilityRole, null>,
      )
    : ({} as Record<CapabilityRole, null>);
  const capabilities = toReports(roles as never);
  const expiresOn = settings.get(KEYS.expiresOn) ?? null;
  const scopesRaw = settings.get(KEYS.scopes) ?? "";
  const testPassedAt = settings.get(KEYS.testPassedAt) ?? null;
  const writeReady = capabilities.find((c) => c.role === WRITE_ROLE)?.available ?? false;

  return {
    configured: Boolean(token),
    connectionState: (settings.get(KEYS.connectionState) as any) ?? (token ? "error" : "not_connected"),
    fingerprint: settings.get(KEYS.fingerprint) ?? null,
    expiresOn,
    expiresInDays: daysUntil(expiresOn),
    scopes: scopesRaw ? scopesRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    storeLabel: settings.get(KEYS.storeLabel) ?? null,
    lastTestedAt: settings.get(KEYS.lastTestedAt) ?? null,
    lastError: settings.get(KEYS.lastError) ?? null,
    capabilities,
    massImportUnlocked: Boolean(testPassedAt) && writeReady,
    testPassedAt,
  };
}

/** Stores the token in the vault and immediately runs a read only probe. */
export async function connectZendrop(input: {
  token: string;
  expiresOn?: string | null;
}): Promise<ZendropConnectionStatus> {
  const token = input.token.trim();
  if (token.length < 16) throw new Error("That does not look like a valid supplier token");

  const supabase = await zendropAdminClient();
  const { error } = await supabase.rpc("set_integration_secret", {
    _name: ZENDROP_VAULT_SECRET,
    _secret: token,
  });
  if (error) throw new Error("The token could not be stored securely");

  await writeSetting(KEYS.fingerprint, "Token fingerprint", fingerprintToken(token));
  if (input.expiresOn) await writeSetting(KEYS.expiresOn, "Token expires on", input.expiresOn);
  await writeSetting(KEYS.lastError, "Last error", null);

  return testZendropConnection();
}

/** Read only verification. Authenticates, discovers capabilities, reads data. */
export async function testZendropConnection(): Promise<ZendropConnectionStatus> {
  const now = new Date().toISOString();
  try {
    const { actions, roles } = await probeConnection();
    await persistCapabilities(actions);

    let storeLabel: string | null = null;
    const storesAction = roles.stores_list;
    if (storesAction) {
      const { callAction } = await import("./client.server");
      const stores = await callAction(storesAction, {}).catch(() => null);
      const list = Array.isArray(stores) ? stores : (stores?.stores ?? stores?.data ?? []);
      const first = Array.isArray(list) ? list[0] : null;
      storeLabel = first?.name ?? first?.domain ?? first?.shop_domain ?? null;
    }

    await writeSetting(KEYS.connectionState, "Connection state", "connected");
    await writeSetting(KEYS.lastTestedAt, "Last tested", now);
    await writeSetting(KEYS.lastError, "Last error", null);
    await writeSetting(KEYS.storeLabel, "Connected store", storeLabel);
    await writeSetting(
      KEYS.scopes,
      "Discovered operations",
      actions.map((action) => action.name).join(","),
    );
    await setIntegrationStatus("connected");
    await logEvent("connection_test", "succeeded", `Discovered ${actions.length} supplier operations`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The supplier test failed";
    await writeSetting(KEYS.connectionState, "Connection state", "error");
    await writeSetting(KEYS.lastTestedAt, "Last tested", now);
    await writeSetting(KEYS.lastError, "Last error", message);
    await setIntegrationStatus("error");
    await logEvent("connection_test", "failed", message);
    throw new Error(message);
  }
  return getZendropStatus();
}

/** Removes the token and locks every write path again. */
export async function disconnectZendrop(): Promise<ZendropConnectionStatus> {
  const supabase = await zendropAdminClient();
  await supabase.rpc("delete_integration_secret", { _name: ZENDROP_VAULT_SECRET });
  await supabase.from("zendrop_capabilities").update({ available: false } as never).neq("action_name", "");
  await writeSetting(KEYS.connectionState, "Connection state", "not_connected");
  await writeSetting(KEYS.fingerprint, "Token fingerprint", null);
  await writeSetting(KEYS.scopes, "Discovered operations", null);
  await writeSetting(KEYS.storeLabel, "Connected store", null);
  await writeSetting(KEYS.testPassedAt, "One product test passed", null);
  await writeSetting(KEYS.massImport, "Mass import unlocked", "false");
  await setIntegrationStatus("not_connected");
  await logEvent("disconnected", "succeeded", "The supplier token was removed");
  return getZendropStatus();
}

export async function markOneProductTestPassed(): Promise<void> {
  await writeSetting(KEYS.testPassedAt, "One product test passed", new Date().toISOString());
  await writeSetting(KEYS.massImport, "Mass import unlocked", "true");
}
