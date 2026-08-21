/**
 * Shared access-token health checks.
 *
 * A stored session can carry a token whose `iat` sits ahead of the backend
 * clock, usually because the machine that minted it was skewed. The data API
 * then rejects the request with PGRST303 ("JWT not yet valid" / "JWT issued at
 * future"), which previously surfaced as a signed-in account appearing to have
 * lost its admin role. Detecting that locally lets callers refresh once and
 * retry instead of treating the failure as an authorisation answer.
 */
export function readClaims(token: string): { iat?: number; exp?: number } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as { iat?: number; exp?: number };
  } catch {
    return null;
  }
}

export function isUnusableToken(token: string): boolean {
  const claims = readClaims(token);
  if (!claims) return false;
  const now = Math.floor(Date.now() / 1000);
  // Small tolerances mirror the leeway the auth server itself allows.
  if (typeof claims.iat === "number" && claims.iat > now + 5) return true;
  if (typeof claims.exp === "number" && claims.exp < now + 5) return true;
  return false;
}

/** PostgREST codes that mean "the token was rejected", not "access denied". */
export function isTokenRejection(error: { code?: string | null; message?: string | null } | null) {
  if (!error) return false;
  if (error.code === "PGRST303" || error.code === "PGRST301") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("jwt") &&
    (message.includes("expired") || message.includes("not yet valid") || message.includes("future"))
  );
}
