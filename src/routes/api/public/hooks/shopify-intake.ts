import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Product intake endpoint for store product events.
 *
 * The store signs every payload, so the signature is checked before anything
 * is read. The handler only records that a product was detected and mirrors
 * the current supplier data. It never writes back to the store.
 */
export const Route = createFileRoute("/api/public/hooks/shopify-intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const signature = request.headers.get("x-shopify-hmac-sha256") ?? "";
        const topic = request.headers.get("x-shopify-topic") ?? "";

        const { getWebhookSigningSecret } = await import("@/lib/services/shopify.server");
        const secret = await getWebhookSigningSecret();
        if (!secret) {
          return Response.json({ error: "Intake is not configured" }, { status: 503 });
        }

        const expected = createHmac("sha256", secret).update(body, "utf8").digest("base64");
        const provided = Buffer.from(signature);
        const digest = Buffer.from(expected);
        if (provided.length !== digest.length || !timingSafeEqual(provided, digest)) {
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }

        let payload: any = null;
        try {
          payload = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid payload" }, { status: 400 });
        }

        const legacyId = payload?.admin_graphql_api_id ?? (payload?.id ? `gid://shopify/Product/${payload.id}` : null);
        if (typeof legacyId !== "string" || !legacyId.startsWith("gid://shopify/Product/")) {
          return Response.json({ error: "Unknown product" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { detectProducts } = await import("@/lib/intake/intake.server");
        const { fetchShopifyProductById, mirrorShopifyProducts } = await import(
          "@/lib/services/shopify.server"
        );

        try {
          const product = await fetchShopifyProductById(legacyId);
          let productId: string | null = null;
          if (product) {
            const map = await mirrorShopifyProducts(
              supabaseAdmin as never,
              [product],
              "Product intake webhook",
            );
            productId = map.get(legacyId) ?? null;
          }

          const { materialIntakeFingerprint } = await import("@/lib/intake/fingerprint");
          const detection = await detectProducts(supabaseAdmin as never, [
            {
              shopifyProductId: legacyId,
              title: (product?.title ?? payload?.title ?? null) as string | null,
              handle: (product?.handle ?? payload?.handle ?? null) as string | null,
              productId,
              updatedAt: (product?.updatedAt ?? payload?.updated_at ?? null) as string | null,
              source: "webhook",
              materialFingerprint: materialIntakeFingerprint(product as never),
            },
          ]);

          // Process immediately so a genuinely good product goes live without
          // waiting for the scheduled worker.
          const { processIntake } = await import("@/lib/intake/intake.server");
          const processed = await processIntake(supabaseAdmin as never, 2);

          return Response.json({ ok: true, topic, detection, processed });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Intake failed";
          // A 200 keeps the store from retrying forever. The scheduled delta
          // sync will pick the product up again.
          return Response.json({ ok: false, message }, { status: 200 });
        }
      },
    },
  },
});
