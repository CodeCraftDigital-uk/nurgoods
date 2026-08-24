/**
 * Final commerce publication step.
 *
 * NUR GOODS is the approval authority. A supplier origin product is pushed
 * into the store as a draft staging record and stays that way until every
 * intake gate has passed. Only then is the store record activated and placed
 * on the sales channels a saleable NUR GOODS product must appear on.
 *
 * This step fails closed. If activation or channel publication does not
 * succeed, the intake record is never marked as live.
 */
import { intakeCredentials, shopifyGraphql } from "@/lib/services/shopify.server";
import { ensureStorePublications } from "@/lib/zendrop/store-publication.server";
import type { IntakeOrigin } from "./types";

const ACTIVATE_MUTATION = /* GraphQL */ `
  mutation NurGoodsActivateProduct($id: ID!) {
    productUpdate(product: { id: $id, status: ACTIVE }) {
      product {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const STATUS_QUERY = /* GraphQL */ `
  query NurGoodsProductStatus($id: ID!) {
    product(id: $id) {
      id
      status
    }
  }
`;

export interface ActivationResult {
  ok: boolean;
  activated: boolean;
  status: string | null;
  channels: string[];
  message: string;
}

export interface ActivationPort {
  readStatus(shopifyProductId: string): Promise<string | null>;
  activate(shopifyProductId: string): Promise<{ ok: boolean; status: string | null; message: string }>;
  publishChannels(shopifyProductId: string): Promise<{ ok: boolean; channels: string[]; message: string }>;
  /**
   * Proves the listing can actually be fulfilled before it is allowed to go
   * live: stable supplier mapping, fresh supplier facts and quoted shipping to
   * every required market. Fails closed.
   */
  checkSellable(shopifyProductId: string): Promise<{ sellable: boolean; message: string }>;
  /**
   * Proves the pricing service has written and read back the approved price on
   * the formula currently in force. Fails closed.
   */
  checkPricingVerified(shopifyProductId: string): Promise<boolean>;
  /**
   * The merchant level switch. While activation is off, nothing may be put on
   * sale by automation at all, however well evidenced it is. Absent on a test
   * double means "allowed", so existing behaviour is unchanged.
   */
  checkActivationPolicy?(): Promise<boolean>;
}

/** The real store adapter. */
export const shopifyActivationPort: ActivationPort = {
  async readStatus(shopifyProductId) {
    const credentials = await intakeCredentials();
    const data: any = await shopifyGraphql(credentials, STATUS_QUERY, { id: shopifyProductId });
    const status = data?.product?.status;
    return typeof status === "string" ? status.toLowerCase() : null;
  },
  async activate(shopifyProductId) {
    const credentials = await intakeCredentials();
    const data: any = await shopifyGraphql(credentials, ACTIVATE_MUTATION, { id: shopifyProductId });
    const errors = data?.productUpdate?.userErrors ?? [];
    if (errors.length > 0) {
      return {
        ok: false,
        status: null,
        message: errors.map((error: any) => error.message).join(" "),
      };
    }
    const status = data?.productUpdate?.product?.status;
    return {
      ok: typeof status === "string" && status.toLowerCase() === "active",
      status: typeof status === "string" ? status.toLowerCase() : null,
      message: "Activated in the store",
    };
  },
  async publishChannels(shopifyProductId) {
    const result = await ensureStorePublications(shopifyProductId);
    const channels = [...result.published, ...result.alreadyPublished];
    const ok = channels.length > 0 && !/error|could not|failed/i.test(result.message);
    return { ok, channels, message: result.message };
  },
  async checkSellable(shopifyProductId) {
    const { productSellability } = await import("./sellability.server");
    const verdict = await productSellability(shopifyProductId);
    return { sellable: verdict.sellable, message: verdict.message };
  },
  async checkPricingVerified(shopifyProductId) {
    const { isPricingVerified } = await import("../pricing/lifecycle.server");
    return isPricingVerified(shopifyProductId);
  },
  async checkActivationPolicy() {
    const { activationAllowed } = await import("../pricing/gate.server");
    return activationAllowed();
  },
};


/**
 * Activates a supplier origin product and confirms its sales channels.
 *
 * A store origin product is never activated here. Its own store state is
 * respected, so the step only confirms that it is already active.
 */
export async function activateForStorefront(
  shopifyProductId: string,
  origin: IntakeOrigin,
  port: ActivationPort = shopifyActivationPort,
): Promise<ActivationResult> {
  let status = await port.readStatus(shopifyProductId);
  let activated = false;

  if (status === "archived") {
    return {
      ok: false,
      activated: false,
      status,
      channels: [],
      message: "The store product is archived, so it will not be made live automatically",
    };
  }

  // Fail closed: a supplier origin listing may only go live once its supplier
  // mapping and required market shipping evidence are proven.
  if (origin === "supplier") {
    const gate = await port.checkSellable(shopifyProductId);
    if (!gate.sellable) {
      return {
        ok: false,
        activated: false,
        status,
        channels: [],
        message: `Not made live. ${gate.message}`,
      };
    }
  }

  // Fail closed: nothing goes on sale before the pricing service has proven
  // the price. Stock, supplier evidence and intake progress are not substitutes
  // for a verified price on the formula currently in force.
  if (!(await port.checkPricingVerified(shopifyProductId))) {
    return {
      ok: false,
      activated: false,
      status,
      channels: [],
      message: "Not made live. The pricing service has not verified this product's price yet",
    };
  }



  // The merchant level switch is checked last and only when something would
  // actually change, so a product that is already live is left alone.
  if (status !== "active" && port.checkActivationPolicy && !(await port.checkActivationPolicy())) {
    return {
      ok: false,
      activated: false,
      status,
      channels: [],
      message:
        "Not made live. Activation is switched off in the pricing policy, so the product was left as a draft",
    };
  }

  if (status !== "active") {
    if (origin !== "supplier") {
      return {
        ok: false,
        activated: false,
        status,
        channels: [],
        message: `The store product is ${status ?? "in an unknown state"} and store managed products are never activated automatically`,
      };
    }
    const outcome = await port.activate(shopifyProductId);
    if (!outcome.ok) {
      return {
        ok: false,
        activated: false,
        status: outcome.status ?? status,
        channels: [],
        message: outcome.message || "The store product could not be activated",
      };
    }
    status = "active";
    activated = true;
  }

  const publication = await port.publishChannels(shopifyProductId);
  if (!publication.ok) {
    return {
      ok: false,
      activated,
      status,
      channels: publication.channels,
      message: publication.message || "The required sales channels could not be confirmed",
    };
  }

  return {
    ok: true,
    activated,
    status,
    channels: publication.channels,
    message: activated
      ? `Activated in the store and available on ${publication.channels.join(", ")}`
      : `Available on ${publication.channels.join(", ")}`,
  };
}
