import { createFileRoute } from "@tanstack/react-router";
import { jsonError, jsonOk, publicHandler, validSlug } from "@/lib/public-api/http.server";
import { getProduct } from "@/lib/public-api/queries.server";

export const Route = createFileRoute("/api/public/v1/products/$handle")({
  server: {
    handlers: {
      OPTIONS: publicHandler(async () => jsonOk({})),
      GET: publicHandler(async (request) => {
        const handle = new URL(request.url).pathname.split("/").pop() ?? "";
        if (!validSlug(handle)) {
          return jsonError("invalid_request", "A valid product handle is required.");
        }
        const product = await getProduct(handle);
        if (!product) return jsonError("not_found", "No public product matches that handle.");
        return jsonOk({ data: product });
      }),
    },
  },
});
