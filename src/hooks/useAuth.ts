import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isTokenRejection, isUnusableToken } from "@/lib/auth/session-health";

export type AppRole = "admin" | "staff" | "viewer";

/**
 * Session and role state for the control panel.
 *
 * The role read is authorisation-critical, so a failed read must never be
 * reported as "this account has no admin role". A token whose `iat` is ahead of
 * the backend clock is rejected with PGRST303, which previously emptied the
 * role list and locked the owner out of /control. The read now refreshes the
 * session and retries, and callers can tell "no role" apart from "role unknown"
 * through `rolesResolved` and `rolesError`.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [rolesResolved, setRolesResolved] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!nextSession?.user) {
        setRoles([]);
        setRolesResolved(true);
        setRolesError(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setSessionLoaded(true);
      if (!data.session?.user) setRolesResolved(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const loadRoles = useCallback(async (userId: string) => {
    // The stored token is tried first: it is usually fine, and refreshing
    // eagerly would throw away a working session whenever the local clock is
    // slightly off. Only a rejection from the data API triggers a refresh.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);

      if (!error) {
        return { roles: (data ?? []).map((row) => row.role as AppRole), error: null };
      }

      if (attempt === 0 && isTokenRejection(error)) {
        const current = await supabase.auth.getSession();
        const token = current.data.session?.access_token;
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.error) {
          const detail =
            token && isUnusableToken(token)
              ? "Your sign-in token was rejected as out of date and could not be renewed. Sign out and sign in again to restore access."
              : `Role check failed: ${error.message}`;
          return { roles: [] as AppRole[], error: detail };
        }
        continue;
      }

      return { roles: [] as AppRole[], error: `Role check failed: ${error.message}` };
    }

    return { roles: [] as AppRole[], error: "Role lookup did not complete." };
  }, []);


  useEffect(() => {
    if (!user) return;
    let active = true;
    setRolesResolved(false);
    setRolesError(null);
    loadRoles(user.id).then((result) => {
      if (!active) return;
      setRoles(result.roles);
      setRolesError(result.error);
      setRolesResolved(true);
    });
    return () => {
      active = false;
    };
  }, [user, loadRoles]);

  const refreshRoles = useCallback(async () => {
    if (!user) return;
    setRolesResolved(false);
    const result = await loadRoles(user.id);
    setRoles(result.roles);
    setRolesError(result.error);
    setRolesResolved(true);
  }, [user, loadRoles]);

  return {
    session,
    user,
    roles,
    // Stay in the loading state until the role answer is trustworthy.
    loading: !sessionLoaded || (Boolean(user) && !rolesResolved),
    rolesResolved,
    rolesError,
    refreshRoles,
    isAdmin: roles.includes("admin"),
    signOut: () => supabase.auth.signOut(),
  };
}
