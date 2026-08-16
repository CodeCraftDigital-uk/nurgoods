import type { ProductBundle } from "@/lib/intelligence/core.server";
import type { IntakeCheck, IntakePolicy } from "./types";

/**
 * Deterministic intake validation. No model is involved and nothing is
 * invented: every check reads a field the store already provides.
 */

const GBP = new Set(["GBP"]);

function plainText(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export interface ValidationOutcome {
  checks: IntakeCheck[];
  passed: boolean;
  failedCodes: string[];
  summary: string;
}

export function validateIntake(bundle: ProductBundle, policy: IntakePolicy): ValidationOutcome {
  const product = bundle.product as any;
  const checks: IntakeCheck[] = [];

  const add = (code: string, label: string, passed: boolean, detail?: string) => {
    checks.push(detail === undefined ? { code, label, passed } : { code, label, passed, detail });
  };

  add(
    "shopify_id",
    "Valid Shopify product identifier",
    typeof product.shopify_product_id === "string"
      ? /^gid:\/\/shopify\/Product\/\d+$/.test(product.shopify_product_id)
      : true,
    product.shopify_product_id ?? undefined,
  );

  const status = (product.status ?? "").toLowerCase();
  add(
    "eligible_status",
    "Product is active in the store",
    status === "" || status === "active",
    status || "unknown",
  );

  const title = (product.title ?? "").trim();
  add("title", "Title present", title.length >= 3, title.slice(0, 80));

  const handle = (product.handle ?? "").trim();
  add("handle", "Storefront handle present", handle.length > 0);

  const images = bundle.media.filter((item) => typeof item.url === "string" && /^https?:\/\//.test(item.url));
  if (policy.require_image) {
    add("image", "At least one real image", images.length > 0, `${images.length} images`);
  }

  const purchasable = bundle.variants.filter((variant) => variant.available_for_sale !== false);
  if (policy.require_purchasable_variant) {
    add(
      "purchasable_variant",
      "At least one purchasable variant",
      bundle.variants.length > 0 && purchasable.length > 0,
      `${purchasable.length} of ${bundle.variants.length} purchasable`,
    );
  }

  if (policy.require_valid_price) {
    const prices = bundle.variants
      .map((variant) => (typeof variant.price === "number" ? variant.price : null))
      .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
    const currency = (product.currency ?? "").toUpperCase();
    add(
      "price",
      "Valid selling price",
      prices.length > 0 && (currency === "" || GBP.has(currency)),
      prices.length > 0 ? `${currency || "GBP"} ${Math.min(...prices).toFixed(2)}` : "no price",
    );
  }

  if (policy.require_description) {
    const description = plainText(product.description ?? product.description_html);
    const specSignals = bundle.variants.some(
      (variant) => Array.isArray(variant.selected_options) && variant.selected_options.length > 0,
    );
    add(
      "description",
      "Basic description or specification data",
      description.length >= 40 || (description.length >= 15 && specSignals),
      `${description.length} characters`,
    );
  }

  // A clearly malformed supplier record: placeholder wording or a title that is
  // only a code. These are quarantined rather than published badly.
  const malformed =
    /^(untitled|test product|default title|new product)$/i.test(title) ||
    /lorem ipsum/i.test(title) ||
    /^[0-9\-_.]+$/.test(title);
  add("well_formed", "Supplier record is well formed", !malformed);

  const failed = checks.filter((check) => !check.passed);
  return {
    checks,
    passed: failed.length === 0,
    failedCodes: failed.map((check) => check.code),
    summary:
      failed.length === 0
        ? "All intake checks passed"
        : `Held back by: ${failed.map((check) => check.label.toLowerCase()).join(", ")}`,
  };
}
