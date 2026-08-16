/**
 * Supplier adapter.
 *
 * Talks to the supplier developer endpoint over HTTPS with a bearer token that
 * only ever exists server side. Action names are discovered at runtime rather
 * than guessed, so an operation the connected account does not expose fails
 * safe instead of sending an invented payload.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CapabilityRole, RateLimitSnapshot } from "./types";
import { CAPABILITY_ROLES, CAPABILITY_ROLE_LABEL } from "./types";

export const ZENDROP_ENDPOINT = "https://app.zendrop.com/mcp/v1";
export const ZENDROP_VAULT_SECRET = "zendrop_api_token";

/** Published supplier limits. Kept deliberately under the ceiling. */
const READ_LIMIT = 110;
const WRITE_LIMIT = 25;
const WINDOW_MS = 60_000;

type AdminClient = SupabaseClient<any, "public", any>;

export async function zendropAdminClient(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

/* --------------------------------- token --------------------------------- */

export function fingerprintToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 8) return "****";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/** Reads the stored token. Never returned to the browser or logged. */
export async function readZendropToken(): Promise<string | null> {
  const envToken = process.env["ZENDROP_API_TOKEN"]?.trim();
  if (envToken) return envToken;
  try {
    const supabase = await zendropAdminClient();
    const { data } = await supabase.rpc("get_integration_secret", {
      _name: ZENDROP_VAULT_SECRET,
    });
    return typeof data === "string" && data.trim() ? data.trim() : null;
  } catch {
    return null;
  }
}

/* ------------------------------ rate limiting ----------------------------- */

interface Bucket {
  stamps: number[];
}

const buckets: Record<"read" | "write", Bucket> = {
  read: { stamps: [] },
  write: { stamps: [] },
};

function prune(kind: "read" | "write") {
  const cutoff = Date.now() - WINDOW_MS;
  buckets[kind].stamps = buckets[kind].stamps.filter((s) => s > cutoff);
}

export function rateLimitSnapshot(): RateLimitSnapshot {
  prune("read");
  prune("write");
  return {
    readsRemaining: Math.max(0, READ_LIMIT - buckets.read.stamps.length),
    writesRemaining: Math.max(0, WRITE_LIMIT - buckets.write.stamps.length),
    readLimit: READ_LIMIT,
    writeLimit: WRITE_LIMIT,
    windowSeconds: WINDOW_MS / 1000,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function reserve(kind: "read" | "write"): Promise<void> {
  const limit = kind === "read" ? READ_LIMIT : WRITE_LIMIT;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    prune(kind);
    if (buckets[kind].stamps.length < limit) {
      buckets[kind].stamps.push(Date.now());
      return;
    }
    const oldest = buckets[kind].stamps[0] ?? Date.now();
    await sleep(Math.max(250, oldest + WINDOW_MS - Date.now()));
  }
  throw new Error("The supplier rate limit is saturated. Try again shortly.");
}

/* --------------------------------- errors --------------------------------- */

export class ZendropError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status = 0, retryable = false) {
    super(message);
    this.name = "ZendropError";
    this.status = status;
    this.retryable = retryable;
  }
}

export class CapabilityUnavailableError extends Error {
  constructor(role: CapabilityRole) {
    super(
      `The connected supplier account does not expose an operation for "${CAPABILITY_ROLE_LABEL[role]}". This step stays disabled until it does.`,
    );
    this.name = "CapabilityUnavailableError";
  }
}

/* ------------------------------- transport -------------------------------- */

let requestId = 0;

interface RpcResult {
  result?: any;
  error?: { code?: number; message?: string };
}

async function rpc(
  method: string,
  params: Record<string, unknown>,
  kind: "read" | "write",
): Promise<any> {
  const token = await readZendropToken();
  if (!token) throw new ZendropError("The supplier account is not connected", 401, false);

  await reserve(kind);

  const maxAttempts = 4;
  let lastError: ZendropError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(ZENDROP_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: (requestId += 1),
          method,
          params,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        throw new ZendropError(
          "The supplier rejected the stored token. Check that it is current and has the required scopes.",
          response.status,
          false,
        );
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "2");
        throw new ZendropError(
          "The supplier rate limit was reached",
          429,
          true,
        ) as ZendropError & { retryAfter?: number },
          (lastError = new ZendropError("The supplier rate limit was reached", 429, true)),
          await sleep(Math.min(30_000, (Number.isFinite(retryAfter) ? retryAfter : 2) * 1000));
        continue;
      }
      if (response.status >= 500) {
        lastError = new ZendropError(`The supplier returned ${response.status}`, response.status, true);
        await sleep(Math.min(8_000, 2 ** attempt * 300));
        continue;
      }
      if (!response.ok) {
        throw new ZendropError(`The supplier returned ${response.status}`, response.status, false);
      }

      const text = await response.text();
      const payload = parseRpcBody(text);
      if (payload?.error) {
        throw new ZendropError(payload.error.message ?? "The supplier declined the request", 400, false);
      }
      return payload?.result ?? null;
    } catch (cause) {
      clearTimeout(timer);
      if (cause instanceof ZendropError && !cause.retryable) throw cause;
      lastError =
        cause instanceof ZendropError
          ? cause
          : new ZendropError(
              cause instanceof Error && cause.name === "AbortError"
                ? "The supplier did not respond in time"
                : "The supplier could not be reached",
              0,
              true,
            );
      if (attempt === maxAttempts) break;
      await sleep(Math.min(8_000, 2 ** attempt * 300));
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new ZendropError("The supplier request failed", 0, false);
}

/** Handles both plain JSON and event stream framed responses. */
function parseRpcBody(text: string): RpcResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as RpcResult;
    } catch {
      return null;
    }
  }
  for (const line of trimmed.split("\n")) {
    const value = line.trim();
    if (!value.startsWith("data:")) continue;
    const body = value.slice(5).trim();
    if (!body || body === "[DONE]") continue;
    try {
      return JSON.parse(body) as RpcResult;
    } catch {
      // Keep scanning the stream.
    }
  }
  return null;
}

/* ----------------------------- capabilities ------------------------------- */

export interface DiscoveredAction {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  kind: "read" | "write" | "unknown";
}

const ROLE_PATTERNS: Record<CapabilityRole, RegExp[]> = {
  catalogue_search: [/catalog.*(search|list|browse|products)/i, /(search|list|browse).*catalog/i],
  catalogue_product: [/catalog.*(get|product|detail)/i, /get.*catalog.*product/i],
  my_products_list: [/my[_-]?products.*(list|get|search)/i, /(list|get).*my[_-]?products/i],
  my_products_import: [
    /my[_-]?products.*(import|add|create|publish)/i,
    /(import|add|create|publish).*(product)/i,
  ],
  stores_list: [/stores?.*(list|get)/i, /(list|get).*stores?/i],
};

const WRITE_ROLES: CapabilityRole[] = ["my_products_import"];

function classify(name: string): "read" | "write" | "unknown" {
  if (/(import|add|create|publish|update|delete|remove|set)/i.test(name)) return "write";
  if (/(list|get|search|read|browse|fetch)/i.test(name)) return "read";
  return "unknown";
}

/** Lists the operations the connected account actually exposes. */
export async function discoverActions(): Promise<DiscoveredAction[]> {
  const result = await rpc("tools/list", {}, "read");
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.map((tool: any) => ({
    name: String(tool?.name ?? ""),
    description: String(tool?.description ?? ""),
    inputSchema: (tool?.inputSchema ?? tool?.input_schema ?? {}) as Record<string, unknown>,
    kind: classify(String(tool?.name ?? "")),
  }));
}

export function mapRoles(actions: DiscoveredAction[]): Record<CapabilityRole, DiscoveredAction | null> {
  const map = {} as Record<CapabilityRole, DiscoveredAction | null>;
  for (const role of CAPABILITY_ROLES) {
    const patterns = ROLE_PATTERNS[role];
    const isWrite = WRITE_ROLES.includes(role);
    const match =
      actions.find(
        (action) =>
          patterns.some((pattern) => pattern.test(action.name)) &&
          (isWrite ? action.kind === "write" : action.kind !== "write"),
      ) ?? null;
    map[role] = match;
  }
  return map;
}

/** Persists discovery so the admin surface can report capability honestly. */
export async function persistCapabilities(actions: DiscoveredAction[]): Promise<void> {
  if (actions.length === 0) return;
  const supabase = await zendropAdminClient();
  const now = new Date().toISOString();
  await supabase.from("zendrop_capabilities").upsert(
    actions.map((action) => ({
      action_name: action.name,
      kind: action.kind,
      available: true,
      description: action.description.slice(0, 500),
      input_schema: action.inputSchema,
      last_checked_at: now,
    })) as never,
    { onConflict: "action_name" },
  );
}

export async function loadCapabilityMap(): Promise<Record<CapabilityRole, DiscoveredAction | null>> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("zendrop_capabilities")
    .select("action_name, kind, description, input_schema")
    .eq("available", true);
  const actions: DiscoveredAction[] = ((data ?? []) as any[]).map((row) => ({
    name: row.action_name as string,
    description: (row.description ?? "") as string,
    inputSchema: (row.input_schema ?? {}) as Record<string, unknown>,
    kind: (row.kind ?? "unknown") as DiscoveredAction["kind"],
  }));
  return mapRoles(actions);
}

/* -------------------------------- calling --------------------------------- */

/** Calls a discovered action. Never invents a name or a payload. */
export async function callAction(
  action: DiscoveredAction,
  args: Record<string, unknown>,
): Promise<any> {
  const result = await rpc(
    "tools/call",
    { name: action.name, arguments: args },
    action.kind === "write" ? "write" : "read",
  );
  return unwrapContent(result);
}

/** Supplier responses may be wrapped in a content envelope. */
export function unwrapContent(result: any): any {
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent;
  const content = result.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === "text" && typeof part.text === "string") {
        const trimmed = part.text.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            return JSON.parse(trimmed);
          } catch {
            return trimmed;
          }
        }
        return trimmed;
      }
      if (part?.type === "json" && part.json !== undefined) return part.json;
    }
  }
  return result;
}

/** Authentication probe that performs no writes. */
export async function probeConnection(): Promise<{
  actions: DiscoveredAction[];
  roles: Record<CapabilityRole, DiscoveredAction | null>;
}> {
  const actions = await discoverActions();
  return { actions, roles: mapRoles(actions) };
}
