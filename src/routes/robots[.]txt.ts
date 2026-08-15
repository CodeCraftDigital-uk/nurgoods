import { createFileRoute } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";

/** Crawler guidance. Admin surfaces stay out of the index; content is open. */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => {
        const body = [
          "User-agent: *",
          "Allow: /",
          "Disallow: /admin",
          "Disallow: /auth",
          "Disallow: /api/",
          "Disallow: /mcp",
          "",
          `Sitemap: ${BRAND.siteUrl}/sitemap.xml`,
          "",
        ].join("\n");

        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
