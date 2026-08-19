import { createFileRoute } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";
import { isAdminHost } from "@/lib/hosts";

/** Crawler guidance. The admin host is closed entirely; content hosts stay open. */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const host = request.headers.get("x-forwarded-host") ?? new URL(request.url).host;

        const body = isAdminHost(host)
          ? ["User-agent: *", "Disallow: /", ""].join("\n")
          : [
              "User-agent: *",
              "Allow: /",
              "Disallow: /control",
              "Disallow: /admin",
              "Disallow: /auth",
              "Disallow: /api/",
              "Disallow: /mcp",
              "",
              `Sitemap: ${BRAND.siteUrl}/sitemap.xml`,
              "",
              `# AI orientation file: ${BRAND.siteUrl}/llms.txt`,
              "",

            ].join("\n");

        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
            "x-robots-tag": isAdminHost(host) ? "noindex, nofollow" : "all",
          },
        });
      },
    },
  },
});
