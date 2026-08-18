/**
 * Store adapter for recording fulfilment and tracking.
 *
 * The store owns the customer notification, so NUR GOODS only reports the
 * genuine shipment it received from the supplier and lets the store do the
 * rest.
 */
import { intakeCredentials, shopifyGraphql } from "@/lib/services/shopify.server";
import type { StoreFulfilmentPort } from "./ports";

const FULFILMENT_ORDERS_QUERY = `
  query NurGoodsFulfilmentOrders($id: ID!) {
    order(id: $id) {
      id
      fulfillmentOrders(first: 20) {
        nodes { id status }
      }
    }
  }
`;

const FULFILMENT_CREATE = `
  mutation NurGoodsFulfil($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

const ACTIONABLE = new Set(["OPEN", "IN_PROGRESS", "SCHEDULED"]);

export const shopifyStorePort: StoreFulfilmentPort = {
  async openFulfilmentOrders(shopifyOrderId: string) {
    const credentials = await intakeCredentials();
    const data: any = await shopifyGraphql(credentials, FULFILMENT_ORDERS_QUERY, { id: shopifyOrderId });
    const nodes: any[] = data?.order?.fulfillmentOrders?.nodes ?? [];
    return nodes
      .filter((node) => ACTIONABLE.has(String(node?.status ?? "").toUpperCase()))
      .map((node) => ({ id: String(node.id), status: String(node.status) }));
  },

  async createFulfilment(input) {
    if (input.fulfilmentOrderIds.length === 0) {
      return { ok: false, fulfilmentId: null, message: "There is no open store fulfilment to update" };
    }
    const credentials = await intakeCredentials();
    const trackingInfo: Record<string, unknown> = {};
    if (input.trackingNumber) trackingInfo["number"] = input.trackingNumber;
    if (input.trackingUrl) trackingInfo["url"] = input.trackingUrl;
    if (input.carrier) trackingInfo["company"] = input.carrier;

    const result: any = await shopifyGraphql(credentials, FULFILMENT_CREATE, {
      fulfillment: {
        lineItemsByFulfillmentOrder: input.fulfilmentOrderIds.map((id) => ({ fulfillmentOrderId: id })),
        notifyCustomer: input.notifyCustomer,
        ...(Object.keys(trackingInfo).length > 0 ? { trackingInfo } : {}),
      },
    });
    const errors = result?.fulfillmentCreate?.userErrors ?? [];
    if (errors.length > 0) {
      return {
        ok: false,
        fulfilmentId: null,
        message: errors.map((error: any) => String(error.message)).join(" "),
      };
    }
    return {
      ok: true,
      fulfilmentId: result?.fulfillmentCreate?.fulfillment?.id ?? null,
      message: "Tracking recorded on the store order",
    };
  },
};
