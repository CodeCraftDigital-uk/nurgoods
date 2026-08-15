import { createFileRoute } from "@tanstack/react-router";
import { jsonOk, parseQuery, publicHandler } from "@/lib/public-api/http.server";
import { searchProducts } from "@/lib/public-api/queries.server";

/** Active, synced store products only. The store remains the source of truth. */
export const Route = createFileRoute("/api/public/v1/products")({
  server: {
    handlers: {
      OPTIONS: publicHandler(async () => jsonOk({})),
      GET: publicHandler(async (request) => {
        const parsed = parseQuery(request);
        if (!parsed.ok) return parsed.response;
        const { q, limit, offset, extras } = parsed.value;

        const result = await searchProducts({
          query: q,
          productType: extras.get("product_type") ?? undefined,
          tag: extras.get("tag") ?? undefined,
          limit,
          offset,
        });
        return jsonOk({ data: result.items, page: result.page });
      }),
    },
  },
});
