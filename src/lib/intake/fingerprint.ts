/**
 * Material change detection for product intake.
 *
 * A store product changes for many reasons that have nothing to do with the
 * catalogue content NUR GOODS actually reasons about. Inventory movement, a
 * repricing pass or a routine sync timestamp must never send an already
 * published product back through classification and search intelligence. Only
 * material catalogue content counts as a change worth reprocessing.
 *
 * This module is deliberately pure so the rule can be tested directly.
 */

export interface MaterialProductInput {
  title?: string | null;
  handle?: string | null;
  status?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[] | null;
  description?: string | null;
  descriptionHtml?: string | null;
  options?: Array<{ name?: string | null; values?: string[] | null }> | null;
  media?: { nodes?: Array<{ preview?: { image?: { url?: string | null } | null } | null; alt?: string | null }> } | null;
  variants?: {
    nodes?: Array<{
      title?: string | null;
      sku?: string | null;
      barcode?: string | null;
      selectedOptions?: Array<{ name?: string | null; value?: string | null }> | null;
    }>;
  } | null;
}

/** Small stable hash. No dependency and no platform specific behaviour. */
function hash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code + index, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The fingerprint covers title, handle, status, vendor, product type, tags,
 * description, option structure, imagery and variant identity. It deliberately
 * excludes price, compare at price, inventory quantity, availability and every
 * timestamp.
 */
export function materialIntakeFingerprint(product: MaterialProductInput | null | undefined): string | null {
  if (!product) return null;
  const parts: string[] = [
    clean(product.title),
    clean(product.handle),
    clean(product.status).toLowerCase(),
    clean(product.vendor),
    clean(product.productType),
    [...(product.tags ?? [])].map(clean).sort().join("|"),
    clean(product.description || product.descriptionHtml),
    (product.options ?? [])
      .map((option) => `${clean(option?.name)}=${[...(option?.values ?? [])].map(clean).sort().join(",")}`)
      .sort()
      .join("|"),
    (product.media?.nodes ?? [])
      .map((node) => `${clean(node?.preview?.image?.url)}~${clean(node?.alt)}`)
      .sort()
      .join("|"),
    (product.variants?.nodes ?? [])
      .map(
        (node) =>
          `${clean(node?.title)}~${clean(node?.sku)}~${clean(node?.barcode)}~${(node?.selectedOptions ?? [])
            .map((option) => `${clean(option?.name)}:${clean(option?.value)}`)
            .sort()
            .join(",")}`,
      )
      .sort()
      .join("|"),
  ];
  return hash(parts.join("\u0001"));
}

/** Intake states that mean the product is settled and should stay settled. */
export const SETTLED_INTAKE_STATES = ["published_to_storefront", "approved", "rejected"];

export interface ExistingIntakeRow {
  state: string;
  version_fingerprint?: string | null;
  processed_fingerprint?: string | null;
  material_fingerprint?: string | null;
}

export type RequeueAction = "create" | "requeue" | "touch" | "skip";

export interface RequeueDecision {
  action: RequeueAction;
  reason: string;
}

/**
 * Decides what a detection pass should do with a product it has just seen.
 *
 * touch means record the new version and content fingerprints without moving
 * the record back to the start of the pipeline.
 */
export function decideRequeue(input: {
  existing: ExistingIntakeRow | null;
  versionFingerprint: string;
  materialFingerprint: string | null;
  hasVersion: boolean;
}): RequeueDecision {
  const { existing, versionFingerprint, materialFingerprint, hasVersion } = input;
  if (!existing) return { action: "create", reason: "New product detected" };

  const settled = SETTLED_INTAKE_STATES.includes(existing.state);

  // Preferred path. A known content fingerprint gives a direct answer and does
  // not depend on the sync timestamp at all.
  if (materialFingerprint) {
    if (existing.material_fingerprint && existing.material_fingerprint === materialFingerprint) {
      return {
        action: versionFingerprint === existing.version_fingerprint ? "skip" : "touch",
        reason: "Only price, stock or sync timestamp changed",
      };
    }
    if (!settled) {
      return { action: "touch", reason: "Already queued, content recorded" };
    }
    return { action: "requeue", reason: "Material catalogue content changed" };
  }

  // Safe fallback when no content fingerprint could be determined. The original
  // version based behaviour applies, which errs towards reprocessing.
  if (!hasVersion) return { action: "skip", reason: "No version to compare" };
  if (existing.processed_fingerprint === versionFingerprint) {
    return { action: "skip", reason: "This version was already processed" };
  }
  if (existing.version_fingerprint === versionFingerprint && !settled) {
    return { action: "skip", reason: "Already queued at this version" };
  }
  return { action: "requeue", reason: "A newer version arrived from the store" };
}
