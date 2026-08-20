import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

/**
 * Attaches the Supabase bearer token to every server function call.
 *
 * A stored session can carry a token whose `iat` is ahead of the backend clock,
 * usually because the machine that minted it was skewed. The data API then
 * rejects every authenticated read with "JWT issued at future", which surfaces
 * as a blank admin screen. Detecting that locally and refreshing the session
 * once turns a hard failure into a transparent retry.
 */
function readClaims(token: string): { iat?: number; exp?: number } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as { iat?: number; exp?: number };
  } catch {
    return null;
  }
}

function isUnusable(token: string): boolean {
  const claims = readClaims(token);
  if (!claims) return false;
  const now = Math.floor(Date.now() / 1000);
  // Small tolerances mirror the leeway the auth server itself allows.
  if (typeof claims.iat === "number" && claims.iat > now + 5) return true;
  if (typeof claims.exp === "number" && claims.exp < now + 5) return true;
  return false;
}

export const attachFreshSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    let token = data.session?.access_token;

    if (token && isUnusable(token)) {
      const refreshed = await supabase.auth.refreshSession();
      token = refreshed.data.session?.access_token ?? token;
    }

    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
