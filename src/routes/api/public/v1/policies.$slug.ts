import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk, publicHandler, validSlug } from "@/lib/public-api/http.server";
import { getPolicy } from "@/lib/public-api/queries.server";

export const Route = createFileRoute("/api/public/v1/policies/$slug")({
  server: {
    handlers: {
      OPTIONS: publicHandler(async () => jsonOk({})),
      GET: publicHandler(async (request) => {
        const slug = new URL(request.url).pathname.split("/").pop() ?? "";
        if (!validSlug(slug)) {
          return jsonError("invalid_request", "A valid policy slug is required.");
        }
        const policy = await getPolicy(slug);
        if (!policy) return jsonError("not_found", "No published policy matches that slug.");
        return jsonOk({ data: policy });
      }),
    },
  },
});
