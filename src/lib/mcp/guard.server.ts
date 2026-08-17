/**
 * Abuse controls for the public connector endpoint.
 *
 * The connector serves the same catalogue information an anonymous visitor can
 * already read on the public shop, so it is intentionally unauthenticated: the
 * data carries no personal, commercial or operational sensitivity, and adding a
 * sign in step would only stop assistants from reading a public shop window.
 * The protections that matter here are therefore volume and payload limits plus
 * row level security on every read, not identity.
 */

/** Paths owned by the connector surface. */
export function isConnectorPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/mcp/") || pathname.startsWith("/.mcp");
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const MAX_BODY_BYTES = 256 * 1024;

const buckets = new Map<string, { count: number; resetAt: number }>();

function callerKey(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function jsonRpcError(status: number, code: number, message: string, headers?: Record<string, string>) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(headers ?? {}),
    },
  });
}

/**
 * Returns a response when the request must be rejected before it reaches the
 * connector, otherwise null. Best effort per caller throttling: instances are
 * stateless and may be recycled, so this keeps runaway agent loops and casual
 * abuse off the database rather than acting as an identity control.
 */
export function connectorGuard(request: Request): Response | null {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonRpcError(413, -32600, "Request body is too large.");
  }

  const key = callerKey(request);
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size > 5_000) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    // Structured, non identifying record so sustained abuse is visible in logs.
    console.warn(
      JSON.stringify({
        event: "connector_rate_limited",
        path: new URL(request.url).pathname,
        window_seconds: WINDOW_MS / 1000,
        limit: MAX_REQUESTS,
      }),
    );
    return jsonRpcError(429, -32029, "Too many requests. Please slow down and try again shortly.", {
      "retry-after": String(retry),
    });
  }
  return null;
}
