import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { isUnusableToken } from "@/lib/auth/session-health";

/**
 * Attaches the Supabase bearer token to every server function call.
 *
 * A stored session can carry a token whose `iat` is ahead of the backend clock,
 * usually because the machine that minted it was skewed. The data API then
 * rejects every authenticated read with "JWT issued at future", which surfaces
 * as a blank admin screen. Detecting that locally and refreshing the session
 * once turns a hard failure into a transparent retry.
 */
const isUnusable = isUnusableToken;


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
