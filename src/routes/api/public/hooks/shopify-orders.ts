import { createFileRoute } from "@tanstack/react-router";

/**
 * Store order events.
 *
 * The store signs every payload, so the signature is verified against the raw
 * body before anything is read. The handler records the order in the NUR GOODS
 * ledger and derives payment from the store's own reported status. It never
 * places a supplier order directly: the scheduled fulfilment queue does that,
 * under its own safety switches.
 */
export const Route = createFileRoute("/api/public/hooks/shopify-orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const signature = request.headers.get("x-shopify-hmac-sha256") ?? "";
        const topic = request.headers.get("x-shopify-topic") ?? "";
        const eventId =
          request.headers.get("x-shopify-event-id") ??
          request.headers.get("x-shopify-webhook-id") ??
          `${topic}:${Date.now()}`;

        const { getWebhookSigningSecret } = await import("@/lib/services/shopify.server");
        const secret = await getWebhookSigningSecret();
        if (!secret) return Response.json({ error: "Order intake is not configured" }, { status: 503 });

        const { verifyStoreSignature, normaliseOrderPayload } = await import("@/lib/commerce/webhook");
        if (!verifyStoreSignature(body, signature, secret)) {
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }

        let payload: any = null;
        try {
          payload = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid payload" }, { status: 400 });
        }

        const order = normaliseOrderPayload(payload);
        if (!order) return Response.json({ error: "Unknown order" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { claimWebhookDelivery, recordStoreOrder } = await import("@/lib/commerce/ledger.server");

        try {
          const fresh = await claimWebhookDelivery(supabaseAdmin as never, {
            eventId,
            topic,
            shopifyOrderId: order.shopifyOrderId,
          });
          if (!fresh) return Response.json({ ok: true, duplicate: true });

          const result = await recordStoreOrder(supabaseAdmin as never, order);
          return Response.json({ ok: true, topic, state: result.state, reason: result.reason });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "The order could not be recorded";
          // A 200 stops the store retrying forever. The reconciliation job
          // picks the order up again.
          return Response.json({ ok: false, message }, { status: 200 });
        }
      },
    },
  },
});
