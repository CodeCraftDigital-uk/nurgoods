import { createFileRoute } from "@tanstack/react-router";

/**
 * Public delivery for Journal hero images.
 *
 * The media library itself stays private. This route streams a stored image
 * back on a stable site URL so article pages, the Journal index and social
 * previews can all reference one permanent address.
 */
export const Route = createFileRoute("/api/public/journal-media/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const path = (params as { _splat?: string })._splat ?? "";
        if (!path || path.includes("..")) {
          return new Response("Not found", { status: 404 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage.from("journal-media").download(path);
        if (error || !data) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(await data.arrayBuffer(), {
          headers: {
            "Content-Type": data.type || "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
