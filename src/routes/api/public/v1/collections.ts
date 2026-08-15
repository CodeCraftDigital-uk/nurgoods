import { createFileRoute } from "@tanstack/react-router";
import { jsonOk, parseQuery, publicHandler } from "@/lib/public-api/http.server";
import { searchCollections } from "@/lib/public-api/queries.server";

/** Synced store collections, used for category discovery. */
export const Route = createFileRoute("/api/public/v1/collections")({
  server: {
    handlers: {
      OPTIONS: publicHandler(async () => jsonOk({})),
      GET: publicHandler(async (request) => {
        const parsed = parseQuery(request);
        if (!parsed.ok) return parsed.response;
        const { q, limit, offset } = parsed.value;
        const result = await searchCollections({ query: q, limit, offset });
        return jsonOk({ data: result.items, page: result.page });
      }),
    },
  },
});
