import type { ProductBundle } from "@/lib/intelligence/core.server";
import { screenProhibited } from "@/lib/policy/prohibited";
import type { IntakeCheck, IntakeOrigin, IntakePolicy } from "./types";

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

/**
 * The approved retail rounding rule for NUR GOODS is charm_99, so every
 * customer facing price must end in .99. This is evaluated per variant and is
 * deliberately free of any exception, so an unrounded price is held rather
 * than published.
 */
export function retailRoundingOutcome(bundle: ProductBundle): {
  passed: boolean;
  detail: string;
} {
  const purchasable = bundle.variants.filter((variant) => variant.available_for_sale !== false);
  const priced = purchasable.filter(
    (variant) => typeof variant.price === "number" && Number.isFinite(variant.price),
  );
  if (priced.length === 0) return { passed: true, detail: "no priced variant to check" };

  const offenders = priced.filter(
    (variant) => Math.round((variant.price as number) * 100) % 100 !== 99,
  );
  if (offenders.length === 0) {
    return { passed: true, detail: `${priced.length} variant price(s) end in .99` };
  }
  const example = Number(offenders[0]?.price ?? 0).toFixed(2);
  return {
    passed: false,
    detail: `${offenders.length} of ${priced.length} variant price(s) do not end in .99, for example ${example}`,
  };

}


export function validateIntake(
  bundle: ProductBundle,
  policy: IntakePolicy,
  options: { origin?: IntakeOrigin } = {},
): ValidationOutcome {
  const product = bundle.product as any;
  const origin: IntakeOrigin = options.origin ?? "store";
  const checks: IntakeCheck[] = [];

  const add = (
    code: string,
    label: string,
    passed: boolean,
    detail?: string,
    failureLabel?: string,
  ) => {
    const check: IntakeCheck = { code, label, passed };
    if (detail !== undefined) check.detail = detail;
    if (failureLabel !== undefined) check.failureLabel = failureLabel;
    checks.push(check);
  };

  add(
    "shopify_id",
    "Valid Shopify product identifier",
    typeof product.shopify_product_id === "string"
      ? /^gid:\/\/shopify\/Product\/\d+$/.test(product.shopify_product_id)
      : true,
    product.shopify_product_id ?? undefined,
  );

  // Prohibited category control. Adult and sexual products can never become
  // customer facing, whatever else about the record is valid.
  const prohibited = screenProhibited({
    title: product.title,
    description: product.description,
    descriptionHtml: product.description_html,
    productType: product.product_type,
    vendor: product.vendor,
    tags: product.tags,
    handle: product.handle,
    extra: bundle.variants.flatMap((variant) => [
      variant.title ?? "",
      ...(Array.isArray(variant.selected_options)
        ? (variant.selected_options as any[]).map((option) =>
            [option?.name, option?.value].filter(Boolean).join(" "),
          )
        : []),
    ]),
  });
  add(
    "prohibited_category",
    "Not a prohibited category",
    !prohibited.prohibited,
    prohibited.reason ?? "No prohibited category signal",
    "the product is in a prohibited category",
  );

  /**
   * Store state.
   *
   * A supplier origin product arrives as a draft staging record because the
   * supplier push has no way to hold it anywhere else. That alone is not a
   * quality problem, so draft is accepted for supplier origin records and the
   * final activation happens only after every other gate has passed. A store
   * origin product keeps the store's own decision: draft and archived stay out
   * of the catalogue and are never activated automatically.
   */
  const status = (product.status ?? "").toLowerCase();
  const statusAllowed =
    status === "" ||
    status === "active" ||
    (origin === "supplier" && status === "draft");
  add(
    "eligible_status",
    origin === "supplier"
      ? "Store record is active or awaiting activation"
      : "Product is active in the store",
    statusAllowed,
    status || "unknown",
    `the store product is ${status || "in an unknown state"}`,
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

  // Retail rounding gate. A listing may never become customer facing with an
  // arbitrary pence ending such as .37 or .50, because that means the approved
  // pricing formula and rounding rule were not applied to it. Every
  // purchasable variant is checked individually so a multi variant product
  // cannot slip through on the strength of its cheapest option.
  const rounding = retailRoundingOutcome(bundle);
  add("retail_rounding", "Retail prices follow the approved rounding rule", rounding.passed, rounding.detail);



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
