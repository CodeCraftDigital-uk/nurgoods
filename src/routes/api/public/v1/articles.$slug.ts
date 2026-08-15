import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk, publicHandler, validSlug } from "@/lib/public-api/http.server";
import { getArticle } from "@/lib/public-api/queries.server";

export const Route = createFileRoute("/api/public/v1/articles/$slug")({
  server: {
    handlers: {
      OPTIONS: publicHandler(async () => jsonOk({})),
      GET: publicHandler(async (request) => {
        const slug = new URL(request.url).pathname.split("/").pop() ?? "";
        if (!validSlug(slug)) {
          return jsonError("invalid_request", "A valid article slug is required.");
        }
        const article = await getArticle(slug);
        if (!article) return jsonError("not_found", "No published article matches that slug.");
        return jsonOk({ data: article });
      }),
    },
  },
});
