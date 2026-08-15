import { createFileRoute } from "@tanstack/react-router";
import { jsonOk, parseQuery, publicHandler } from "@/lib/public-api/http.server";
import { searchArticles } from "@/lib/public-api/queries.server";

/** Published Journal articles only. Drafts and scheduled work stay private. */
export const Route = createFileRoute("/api/public/v1/articles")({
  server: {
    handlers: {
      OPTIONS: publicHandler(async () => jsonOk({})),
      GET: publicHandler(async (request) => {
        const parsed = parseQuery(request);
        if (!parsed.ok) return parsed.response;
        const { q, limit, offset, extras } = parsed.value;
        const result = await searchArticles({
          query: q,
          tag: extras.get("tag") ?? undefined,
          limit,
          offset,
        });
        return jsonOk({ data: result.items, page: result.page });
      }),
    },
  },
});
