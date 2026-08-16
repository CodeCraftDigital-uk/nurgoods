import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  ADMIN_HOST,
  PUBLIC_HOST,
  isAdminHost,
  isAdminPath,
  isInfrastructurePath,
  isPublicProductionHost,
} from "./lib/hosts";

/**
 * Hostname routing. admin.nurgoods.com is the canonical admin console, the
 * public storefront stays on nurgoods.com, and neither host indexes admin
 * surfaces. Preview and local hosts keep /admin working unchanged.
 */
const hostRoutingMiddleware = createMiddleware().server(async ({ next }) => {
  let host = "";
  let pathname = "/";
  let method = "GET";
  let search = "";

  try {
    const request = getRequest();
    const url = new URL(request.url);
    host = request.headers.get("x-forwarded-host") ?? url.host;
    pathname = url.pathname;
    search = url.search;
    method = request.method;
  } catch {
    return next();
  }

  const documentRequest = method === "GET" && !isInfrastructurePath(pathname);

  if (documentRequest) {
    if (isAdminHost(host) && !isAdminPath(pathname)) {
      return new Response(null, {
        status: 302,
        headers: { location: pathname === "/" ? "/admin" : `https://${PUBLIC_HOST}${pathname}${search}` },
      });
    }
    if (isPublicProductionHost(host) && isAdminPath(pathname)) {
      return new Response(null, {
        status: 302,
        headers: { location: `https://${ADMIN_HOST}${pathname}${search}` },
      });
    }
  }

  const result = await next();
  if (result instanceof Response && (isAdminHost(host) || isAdminPath(pathname))) {
    result.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
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
  requestMiddleware: [errorMiddleware, hostRoutingMiddleware, csrfMiddleware],
}));

