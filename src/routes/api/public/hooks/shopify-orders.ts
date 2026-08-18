import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";

/**
 * Store order events.
 *
 * The store signs every payload, so the signature is verified against the raw
 * body before anything is read. The handler records the order in the NUR GOODS
 * ledger and derives payment from the store's own reported status. It never
 * places a supplier order directly: the scheduled fulfilment queue does that,
 * under its own safety switches.
 *
 * Delivery handling is claim, process, mark processed. A delivery that fails
 * part way through stays unprocessed and returns a retryable response, so the
 * store can redeliver it safely.
 */
/** The only order topics this ingress accepts. Anything else is refused. */
const SUPPORTED_TOPICS = new Set(["orders/paid", "orders/updated", "orders/cancelled"]);

const methodNotAllowed = () =>
  Response.json(
    { error: "Method not allowed. This endpoint accepts signed store order webhooks only." },
    { status: 405, headers: { Allow: "POST" } },
  );

export const Route = createFileRoute("/api/public/hooks/shopify-orders")({
  server: {
    handlers: {
      GET: async () => methodNotAllowed(),
      PUT: async () => methodNotAllowed(),
      PATCH: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
      POST: async ({ request }) => {
        const body = await request.text();
        const signature = request.headers.get("x-shopify-hmac-sha256") ?? "";
        const topic = (request.headers.get("x-shopify-topic") ?? "").toLowerCase();
        // A stable identity. When the store sends no delivery header the exact
        // raw body is hashed, so a genuine redelivery is still recognised.
        const webhookId =
          request.headers.get("x-shopify-webhook-id") ??
          request.headers.get("x-shopify-event-id") ??
          `${topic}:${createHash("sha256").update(body, "utf8").digest("hex")}`;

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
        const { claimWebhookDelivery, completeWebhookDelivery, failWebhookDelivery, recordStoreOrder } =
          await import("@/lib/commerce/ledger.server");

        let claim;
        try {
          claim = await claimWebhookDelivery(supabaseAdmin as never, {
            webhookId,
            topic,
            shopifyOrderId: order.shopifyOrderId,
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "The delivery could not be claimed";
          return Response.json({ ok: false, message }, { status: 503 });
        }

        if (!claim.claimed) {
          if (claim.reason === "already_processed") {
            return Response.json({ ok: true, duplicate: true });
          }
          // Another delivery of the same event is in flight. Ask for a retry
          // rather than silently dropping this one.
          return Response.json({ ok: false, message: "Delivery already in flight" }, { status: 409 });
        }

        try {
          const result = await recordStoreOrder(supabaseAdmin as never, order);
          await completeWebhookDelivery(supabaseAdmin as never, claim.deliveryId);
          return Response.json({ ok: true, topic, state: result.state, reason: result.reason });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "The order could not be recorded";
          await failWebhookDelivery(supabaseAdmin as never, claim.deliveryId, message).catch(() => undefined);
          // Retryable. The delivery stays unprocessed so the store can send it
          // again and the claim will be handed back.
          return Response.json({ ok: false, message }, { status: 503 });
        }
      },
    },
  },
});

