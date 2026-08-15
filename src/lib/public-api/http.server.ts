/**
 * Shared response, validation and abuse control helpers for the public
 * connector endpoints. Uses only platform native capabilities. No external
 * service is involved.
 */
import {
  PAGE_LIMITS,
  PUBLIC_API_VERSION,
  SEARCH_LIMITS,
  type PublicErrorCode,
  type PublicMeta,
} from "./contract";

function meta(): PublicMeta {
  return {
    version: PUBLIC_API_VERSION,
    generated_at: new Date().toISOString(),
    source: "nurgoods-platform",
  };
}

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "x-api-version": PUBLIC_API_VERSION,
  // Read only surface, safe for assistants and agents to call cross origin.
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  // Discovery crawlers may index the contract but never the raw records.
  "x-robots-tag": "noindex",
};

export function jsonOk(
  data: Record<string, unknown>,
  init?: { cacheSeconds?: number; headers?: Record<string, string> },
): Response {
  const cacheSeconds = init?.cacheSeconds ?? 300;
  return new Response(JSON.stringify({ ...data, meta: meta() }, null, 2), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "cache-control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
      ...(init?.headers ?? {}),
    },
  });
}

const STATUS_BY_CODE: Record<PublicErrorCode, number> = {
  invalid_request: 400,
  not_found: 404,
  rate_limited: 429,
  unavailable: 503,
  internal_error: 500,
};

export function jsonError(
  code: PublicErrorCode,
  message: string,
  details?: Record<string, string>,
  headers?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify(
      { error: { code, message, ...(details ? { details } : {}) }, meta: meta() },
      null,
      2,
    ),
    {
      status: STATUS_BY_CODE[code],
      headers: { ...BASE_HEADERS, "cache-control": "no-store", ...(headers ?? {}) },
    },
  );
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

/** Never leaks the underlying message. Callers get a stable, generic failure. */
export function handleFailure(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("not configured")) {
    return jsonError("unavailable", "This resource is temporarily unavailable.");
  }
  return jsonError("internal_error", "The request could not be completed.");
}

/* ------------------------------- validation ------------------------------- */

export interface ParsedQuery {
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  extras: URLSearchParams;
}

export function parseQuery(
  request: Request,
): { ok: true; value: ParsedQuery } | { ok: false; response: Response } {
  const params = new URL(request.url).searchParams;

  const rawQ = params.get("q")?.trim();
  if (rawQ && rawQ.length < SEARCH_LIMITS.minQueryLength) {
    return {
      ok: false,
      response: jsonError("invalid_request", "Search terms need at least two characters.", {
        q: "too_short",
      }),
    };
  }
  if (rawQ && rawQ.length > SEARCH_LIMITS.maxQueryLength) {
    return {
      ok: false,
      response: jsonError("invalid_request", "Search terms are limited to 120 characters.", {
        q: "too_long",
      }),
    };
  }

  const numeric = (name: string): number | undefined | null => {
    const raw = params.get(name);
    if (raw === null || raw === "") return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  };

  const limit = numeric("limit");
  const offset = numeric("offset");
  if (limit === null || offset === null) {
    return {
      ok: false,
      response: jsonError("invalid_request", "Pagination values must be positive numbers.", {
        limit: `1 to ${PAGE_LIMITS.max}`,
      }),
    };
  }

  return {
    ok: true,
    value: { q: rawQ || undefined, limit: limit ?? undefined, offset: offset ?? undefined, extras: params },
  };
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,120}$/i;

export function validSlug(value: string | undefined): value is string {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

/* ------------------------------ rate limiting ------------------------------ */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
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

/**
 * Best effort per caller throttle. Server instances are stateless and may be
 * recycled, so this is a courtesy limit that keeps casual abuse and runaway
 * agent loops off the database rather than a hard security control. The real
 * boundary is row level security plus the read only contract.
 */
export function rateLimit(request: Request): Response | null {
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
    return jsonError(
      "rate_limited",
      "Too many requests. Please slow down and try again shortly.",
      undefined,
      { "retry-after": String(retry) },
    );
  }
  return null;
}

/** Wraps a handler with preflight, throttling and uniform failure handling. */
export function publicHandler(
  handler: (request: Request) => Promise<Response>,
): (ctx: { request: Request }) => Promise<Response> {
  return async ({ request }) => {
    if (request.method === "OPTIONS") return preflight();
    const limited = rateLimit(request);
    if (limited) return limited;
    try {
      return await handler(request);
    } catch (error) {
      return handleFailure(error);
    }
  };
}
