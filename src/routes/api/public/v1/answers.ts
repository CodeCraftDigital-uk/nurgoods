import { createFileRoute } from "@tanstack/react-router";
import { jsonOk, parseQuery, publicHandler } from "@/lib/public-api/http.server";
import { listAnswers } from "@/lib/public-api/queries.server";

/** Approved question and answer pairs attached to genuinely public content. */
export const Route = createFileRoute("/api/public/v1/answers")({
  server: {
    handlers: {
      OPTIONS: publicHandler(async () => jsonOk({})),
      GET: publicHandler(async (request) => {
        const parsed = parseQuery(request);
        if (!parsed.ok) return parsed.response;
        const { q, limit, offset } = parsed.value;
        const result = await listAnswers({ query: q, limit, offset });
        return jsonOk({ data: result.items, page: result.page });
      }),
    },
  },
});
