import { createFileRoute } from "@tanstack/react-router";
import { verifyStoreSignature } from "@/lib/commerce/webhook";

/**
 * Product intake endpoint for store product events.
 *
 * The store expects an acknowledgement within seconds and removes a
 * subscription that keeps failing, so this handler does the smallest amount of
 * work that is safe: verify the signature, record that the product needs
 * intake, acknowledge. Every expensive step (mirroring from the store,
 * classification, pricing, publication) is left to the intake worker.
 *
 * Nothing here writes back to the store and no supplier or store price is
 * treated as authoritative. The record only marks the product for review.
 */

const ACK_BUDGET_MS = 2500;

function ack(body: Record<string, unknown>) {
  return Response.json({ ok: true, ...body });
}

export const Route = createFileRoute("/api/public/hooks/shopify-intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const signature = request.headers.get("x-shopify-hmac-sha256") ?? "";
        const topic = request.headers.get("x-shopify-topic") ?? "";

        const { getWebhookSigningSecret } = await import("@/lib/services/shopify.server");
        let secret: string | null = null;
        try {
          secret = await getWebhookSigningSecret();
        } catch {
          secret = null;
        }
        if (!secret) {
          // Retryable on the store side. The scheduled delta sync is the
          // backstop so nothing is lost while credentials are unavailable.
          return Response.json({ error: "Intake is not configured" }, { status: 503 });
        }

        if (!verifyStoreSignature(body, signature, secret)) {
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }

        let payload: any = null;
        try {
          payload = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid payload" }, { status: 400 });
        }

        const productId =
          payload?.admin_graphql_api_id ??
          (payload?.id ? `gid://shopify/Product/${payload.id}` : null);
        if (typeof productId !== "string" || !productId.startsWith("gid://shopify/Product/")) {
          // Acknowledged so the store stops retrying an event we cannot use.
          return ack({ topic, ignored: "unknown_product" });
        }

        // Deletions are handled by the catalogue mirror, not by intake.
        if (topic.startsWith("products/delete")) {
          return ack({ topic, ignored: "delete" });
        }

        try {
          const queue = (async () => {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { detectProducts } = await import("@/lib/intake/intake.server");
            // The material fingerprint is left unset on purpose. The worker
            // recomputes it from mirrored store data, so a webhook can never
            // settle a product on the strength of the raw payload alone.
            return detectProducts(supabaseAdmin as never, [
              {
                shopifyProductId: productId,
                title: typeof payload?.title === "string" ? payload.title : null,
                handle: typeof payload?.handle === "string" ? payload.handle : null,
                productId: null,
                updatedAt: typeof payload?.updated_at === "string" ? payload.updated_at : null,
                source: "webhook",
                materialFingerprint: null,
                // Carried so a product that arrives already on sale without
                // having been verified here is taken back off sale at once.
                status: typeof payload?.status === "string" ? payload.status : null,
              },
            ]);
          })();

          const detection = await Promise.race([
            queue,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), ACK_BUDGET_MS)),
          ]);

          return ack({ topic, queued: detection !== null, detection: detection ?? undefined });
        } catch {
          // Never fail a verified delivery. The delta sync re-detects the
          // product on its next pass.
          return ack({ topic, queued: false, deferred: true });
        }
      },
      GET: async () => Response.json({ ok: true, service: "product-intake" }),
    },
  },
});
