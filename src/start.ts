import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachFreshSupabaseAuth } from "@/lib/auth/attach-fresh-auth";
import { isAdminPath } from "./lib/hosts";
import { connectorGuard, isConnectorPath } from "./lib/mcp/guard.server";

/**
 * Volume and payload limits for the public connector endpoint. Placed ahead of
 * the handler so abusive traffic never reaches the database.
 */
const connectorGuardMiddleware = createMiddleware().server(async ({ next }) => {
  let request: Request | null = null;
  try {
    request = getRequest();
  } catch {
    return next();
  }
  if (request && isConnectorPath(new URL(request.url).pathname)) {
    const blocked = connectorGuard(request);
    if (blocked) return blocked;
  }
  return next();
});


/**
 * The admin console lives at /control inside this single application. This
 * middleware only marks admin surfaces as non indexable; it performs no host
 * rewriting, so preview, local and production all behave identically.
 */
const adminRobotsMiddleware = createMiddleware().server(async ({ next }) => {
  let pathname = "/";
  try {
    pathname = new URL(getRequest().url).pathname;
  } catch {
    return next();
  }

  const result = await next();
  if (isAdminPath(pathname)) {
    const response: unknown =
      result instanceof Response
        ? result
        : (result as { response?: unknown } | null)?.response;
    if (response instanceof Response) {
      try {
        response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
      } catch {
        // Immutable headers on some runtimes; the route level meta tag still applies.
      }
    }
  }
  return result;
});


const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, connectorGuardMiddleware, adminRobotsMiddleware, csrfMiddleware],
}));

