import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBundles } from "./queue.server";
import {
  blockingKeys,
  comparePair,
  extractSignals,
  HIGH_CONFIDENCE,
  IDENTITY_VERSION,
  SUSPECT_CONFIDENCE,
  type IdentitySignals,
  type PairVerdict,
} from "./identity";

/**
 * Automated product identity and de-duplication.
 *
 * Supplier records are never touched. When two mirrored listings are proven to
 * be the same product, the presentation layer shows one canonical listing and
 * hides the rest. Everything below high confidence is only ever raised as a
 * suspect for a person to look at.
 */

type Db = SupabaseClient<any, "public", any>;

const CANDIDATE_LIMIT = 4000;
/** A cheaper member must beat the sitting canonical listing by this margin. */
const REELECTION_MARGIN = 0.02;

interface MemberFacts {
  productId: string;
  handle: string;
  title: string;
  price: number | null;
  available: boolean;
  inventory: number;
  quality: number;
  createdAt: string;
}

export interface DedupeResult {
  inspected: number;
  pairs: number;
  groups: number;
  highConfidenceGroups: number;
  suspectGroups: number;
  suppressed: number;
  elections: number;
  tieBreaksUsed: number;
}

/* ------------------------------------------------------------------ */
/* Signals                                                             */
/* ------------------------------------------------------------------ */

/** Rebuilds and stores identity signals for the given products. */
export async function refreshIdentitySignals(db: Db, productIds: string[]): Promise<number> {
  const bundles = await loadBundles(db, productIds);
  if (bundles.length === 0) return 0;

  const rows = bundles.map((bundle) => {
    const signals = extractSignals(bundle);
    return {
      product_id: signals.productId,
      barcodes: signals.barcodes,
      skus: signals.skus,
      model_codes: signals.modelCodes,
      vendor_key: signals.vendorKey,
      pack_quantity: signals.packQuantity,
      spec_signature: signals.specSignature,
      variant_signature: signals.variantSignature,
      attribute_tokens: signals.attributeTokens,
      image_signatures: signals.imageSignatures,
      identity_fingerprint: signals.identityFingerprint,
    };
  });

  const { error } = await db
    .from("product_identity_signals")
    .upsert(rows as never, { onConflict: "product_id" });
  if (error) throw new Error(error.message);
  return rows.length;
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

class UnionFind {
  private parent = new Map<string, string>();
  find(id: string): string {
    const current = this.parent.get(id);
    if (!current || current === id) {
      this.parent.set(id, id);
      return id;
    }
    const root = this.find(current);
    this.parent.set(id, root);
    return root;
  }
  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

interface PairRecord {
  a: string;
  b: string;
  verdict: PairVerdict;
}

function candidatePairs(signals: IdentitySignals[]): PairRecord[] {
  const buckets = new Map<string, string[]>();
  const byId = new Map(signals.map((item) => [item.productId, item]));
  for (const item of signals) {
    for (const key of blockingKeys(item)) {
      buckets.set(key, [...(buckets.get(key) ?? []), item.productId]);
    }
  }

  const seen = new Set<string>();
  const pairs: PairRecord[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2 || members.length > 60) continue;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const left = members[i]!;
        const right = members[j]!;
        const key = left < right ? `${left}|${right}` : `${right}|${left}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = byId.get(left);
        const b = byId.get(right);
        if (!a || !b) continue;
        const verdict = comparePair(a, b);
        if (verdict.score < SUSPECT_CONFIDENCE) continue;
        pairs.push({ a: left, b: right, verdict });
      }
    }
  }
  return pairs;
}

/**
 * Optional semantic tie breaker. It is only consulted when structured evidence
 * is genuinely borderline, and it can never overrule a contradiction or invent
 * confidence on title resemblance alone.
 */
async function semanticTieBreak(
  a: IdentitySignals,
  b: IdentitySignals,
): Promise<{ identical: boolean; reason: string } | null> {
  try {
    const { resolveAdapter } = await import("@/lib/ai/runtime.server");
    const adapter = resolveAdapter();
    const result = await adapter.complete({
      stage: "optimisation",
      promptVersionKey: "catalogue.duplicate_tiebreak",
      responseSchema: {},
      messages: [
        {
          role: "system",
          content:
            "You decide whether two retail listings describe exactly the same physical product. Different sizes, capacities, colours, pack quantities, generations, compatibility or accessories are NOT the same product. Answer strictly as JSON.",
        },
        {
          role: "user",
          content: `Return {"identical": boolean, "reason": string}.\n\n${JSON.stringify({
            a: { title: a.title, attributes: a.attributeTokens, pack: a.packQuantity, vendor: a.vendorKey },
            b: { title: b.title, attributes: b.attributeTokens, pack: b.packQuantity, vendor: b.vendorKey },
          })}`,
        },
      ],
    });
    const parsed = (result.parsed ?? {}) as { identical?: unknown; reason?: unknown };
    return {
      identical: parsed.identical === true,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "",
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Canonical election                                                  */
/* ------------------------------------------------------------------ */

/**
 * Chooses the listing a customer should see: the cheapest purchasable member,
 * then availability, then merchandising quality, then the oldest record so the
 * canonical URL stays stable.
 */
export function electCanonical(
  members: MemberFacts[],
  sitting: string | null,
): { winner: MemberFacts; reason: string } | null {
  if (members.length === 0) return null;
  const rank = (item: MemberFacts) => [
    item.available ? 0 : 1,
    item.price ?? Number.POSITIVE_INFINITY,
    -item.inventory,
    -item.quality,
    item.createdAt,
  ];
  const ordered = [...members].sort((x, y) => {
    const left = rank(x);
    const right = rank(y);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i]! < right[i]!) return -1;
      if (left[i]! > right[i]!) return 1;
    }
    return 0;
  });
  const best = ordered[0]!;
  const current = sitting ? members.find((item) => item.productId === sitting) : undefined;

  if (current && current.productId !== best.productId) {
    const currentPrice = current.price ?? Number.POSITIVE_INFINITY;
    const bestPrice = best.price ?? Number.POSITIVE_INFINITY;
    const materiallyCheaper = bestPrice < currentPrice * (1 - REELECTION_MARGIN);
    // Hold the existing canonical URL unless the alternative is genuinely
    // better, so search authority is not moved for a rounding difference.
    if (current.available && !materiallyCheaper) {
      return { winner: current, reason: "Existing canonical listing retained for URL stability" };
    }
    return {
      winner: best,
      reason: current.available
        ? `Re-elected because the alternative is materially cheaper (${bestPrice} against ${currentPrice})`
        : "Re-elected because the previous canonical listing is no longer purchasable",
    };
  }

  return {
    winner: best,
    reason: current ? "Canonical listing unchanged" : "Lowest priced purchasable listing selected",
  };
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

async function audit(
  db: Db,
  event: { groupId: string | null; productId?: string | null; type: string; detail: Record<string, unknown> },
) {
  await db.from("duplicate_audit_events").insert({
    group_id: event.groupId,
    product_id: event.productId ?? null,
    event_type: event.type,
    detail: event.detail,
  } as never);
}

/**
 * Full identity pass. Deterministic, idempotent and safe to repeat: the same
 * catalogue state always produces the same groups and the same canonical
 * listings.
 */
export async function runDuplicateIdentity(
  db: Db,
  options?: { allowTieBreak?: boolean },
): Promise<DedupeResult> {
  const { data: productRows } = await db
    .from("shopify_products")
    .select("id, handle, title, price_min, available_for_sale, total_inventory, created_at")
    .limit(CANDIDATE_LIMIT);
  const products = ((productRows ?? []) as any[]).map((row) => row);
  const result: DedupeResult = {
    inspected: products.length,
    pairs: 0,
    groups: 0,
    highConfidenceGroups: 0,
    suspectGroups: 0,
    suppressed: 0,
    elections: 0,
    tieBreaksUsed: 0,
  };
  if (products.length < 2) return result;

  const ids = products.map((row) => row.id as string);
  await refreshIdentitySignals(db, ids);

  const bundles = await loadBundles(db, ids);
  const signals = bundles.map((bundle) => extractSignals(bundle));
  const signalById = new Map(signals.map((item) => [item.productId, item]));

  const pairs = candidatePairs(signals);
  result.pairs = pairs.length;

  // Semantic tie breaker, strictly bounded so credits stay predictable.
  if (options?.allowTieBreak !== false) {
    const borderline = pairs.filter((pair) => pair.verdict.needsTieBreak).slice(0, 10);
    for (const pair of borderline) {
      const a = signalById.get(pair.a);
      const b = signalById.get(pair.b);
      if (!a || !b) continue;
      const verdict = await semanticTieBreak(a, b);
      if (!verdict) continue;
      result.tieBreaksUsed += 1;
      pair.verdict.evidence.push({
        code: "semantic_tiebreak",
        label: verdict.identical
          ? `Semantic check agreed the listings are identical. ${verdict.reason}`
          : `Semantic check found the listings are not identical. ${verdict.reason}`,
        weight: 0,
        strong: false,
      });
      if (verdict.identical && pair.verdict.hasStrongEvidence && pair.verdict.vetoes.length === 0) {
        pair.verdict.score = Math.max(pair.verdict.score, HIGH_CONFIDENCE);
        pair.verdict.tier = "high";
      } else if (!verdict.identical) {
        pair.verdict.tier = pair.verdict.score >= SUSPECT_CONFIDENCE ? "medium" : "low";
      }
    }
  }

  const highPairs = pairs.filter((pair) => pair.verdict.tier === "high");
  const suspectPairs = pairs.filter((pair) => pair.verdict.tier === "medium");

  // High confidence pairs form real groups. Suspect pairs only ever surface
  // for review, so nothing is hidden on resemblance alone.
  const union = new UnionFind();
  for (const pair of highPairs) union.union(pair.a, pair.b);

  const clusters = new Map<string, Set<string>>();
  for (const pair of highPairs) {
    const root = union.find(pair.a);
    const set = clusters.get(root) ?? new Set<string>();
    set.add(pair.a);
    set.add(pair.b);
    clusters.set(root, set);
  }
  for (const pair of suspectPairs) {
    const inHigh = clusters.has(union.find(pair.a)) && union.find(pair.a) === union.find(pair.b);
    if (inHigh) continue;
    const key = `suspect:${[pair.a, pair.b].sort().join("|")}`;
    clusters.set(key, new Set([pair.a, pair.b]));
  }

  const factsById = new Map<string, MemberFacts>();
  const { data: qualityRows } = await db
    .from("product_classifications")
    .select("product_id, quality_score")
    .in("product_id", ids);
  const qualityBy = new Map(((qualityRows ?? []) as any[]).map((row) => [row.product_id, row.quality_score ?? 0]));
  for (const row of products) {
    factsById.set(row.id, {
      productId: row.id,
      handle: row.handle,
      title: row.title,
      price: typeof row.price_min === "number" ? row.price_min : row.price_min ? Number(row.price_min) : null,
      available: row.available_for_sale !== false,
      inventory: Number(row.total_inventory ?? 0),
      quality: Number(qualityBy.get(row.id) ?? 0),
      createdAt: String(row.created_at ?? ""),
    });
  }

  const { data: existingGroups } = await db
    .from("duplicate_groups")
    .select("id, group_key, canonical_product_id, admin_decision, confidence_tier");
  const existingByKey = new Map(((existingGroups ?? []) as any[]).map((row) => [row.group_key, row]));
  const liveKeys = new Set<string>();

  for (const [rootKey, memberSet] of clusters) {
    const memberIds = [...memberSet].sort();
    const isHigh = !rootKey.startsWith("suspect:");
    const groupKey = isHigh ? `identity:${memberIds.join("|")}` : rootKey;
    liveKeys.add(groupKey);

    const relevantPairs = pairs.filter(
      (pair) => memberSet.has(pair.a) && memberSet.has(pair.b),
    );
    const confidence = relevantPairs.reduce((max, pair) => Math.max(max, pair.verdict.score), 0);
    const evidence = {
      version: IDENTITY_VERSION,
      pairs: relevantPairs.map((pair) => ({
        a: signalById.get(pair.a)?.handle ?? pair.a,
        b: signalById.get(pair.b)?.handle ?? pair.b,
        score: Number(pair.verdict.score.toFixed(3)),
        evidence: pair.verdict.evidence.map((item) => item.label),
        vetoes: pair.verdict.vetoes.map((item) => item.label),
      })),
    };

    const existing = existingByKey.get(groupKey);
    const memberFacts = memberIds
      .map((id) => factsById.get(id))
      .filter((item): item is MemberFacts => Boolean(item));
    const prices = memberFacts.map((item) => item.price ?? null).filter((value): value is number => value !== null);
    const spread = prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : 0;

    const keepSeparate = existing?.admin_decision === "keep_separate";
    const suppressing = isHigh && !keepSeparate;

    const election = suppressing
      ? electCanonical(memberFacts, existing?.canonical_product_id ?? null)
      : null;
    const canonical = election?.winner ?? null;

    const payload = {
      group_key: groupKey,
      confidence: Number(confidence.toFixed(3)),
      confidence_tier: isHigh ? "high" : "medium",
      evidence,
      canonical_product_id: canonical?.productId ?? null,
      canonical_handle: canonical?.handle ?? null,
      member_count: memberIds.length,
      suppressed_count: suppressing ? Math.max(0, memberIds.length - 1) : 0,
      auto_suppressed: suppressing,
      price_spread: spread,
      last_evaluated_at: new Date().toISOString(),
      ...(canonical ? { last_elected_at: new Date().toISOString() } : {}),
    };

    const { data: saved, error: saveError } = await db
      .from("duplicate_groups")
      .upsert(payload as never, { onConflict: "group_key" })
      .select("id, canonical_product_id")
      .single();
    if (saveError || !saved) continue;
    const groupId = (saved as any).id as string;

    result.groups += 1;
    if (isHigh) result.highConfidenceGroups += 1;
    else result.suspectGroups += 1;

    for (const member of memberFacts) {
      const isCanonical = canonical?.productId === member.productId;
      const suppressed = suppressing && !isCanonical;
      if (suppressed) result.suppressed += 1;
      await db.from("duplicate_group_members").upsert(
        {
          group_id: groupId,
          product_id: member.productId,
          role: !suppressing ? "suspect" : isCanonical ? "canonical" : "suppressed",
          suppressed,
          match_score: Number(confidence.toFixed(3)),
          evidence,
          price: member.price,
          available: member.available,
          quality_score: member.quality,
        } as never,
        { onConflict: "product_id" },
      );
    }

    if (election && existing?.canonical_product_id !== canonical?.productId) {
      result.elections += 1;
      await audit(db, {
        groupId,
        productId: canonical?.productId ?? null,
        type: existing ? "canonical_reelected" : "canonical_elected",
        detail: {
          reason: election.reason,
          previous: existing?.canonical_product_id ?? null,
          price: canonical?.price ?? null,
          members: memberIds.length,
        },
      });
    }
    if (!existing) {
      await audit(db, {
        groupId,
        type: isHigh ? "group_created_high_confidence" : "duplicate_suspect_raised",
        detail: { confidence: Number(confidence.toFixed(3)), members: memberIds.length, evidence },
      });
    }
  }

  // Groups that no longer hold: release their members so nothing stays hidden
  // after the catalogue changes.
  const stale = ((existingGroups ?? []) as any[]).filter((row) => !liveKeys.has(row.group_key));
  for (const row of stale) {
    await audit(db, { groupId: row.id, type: "group_released", detail: { group_key: row.group_key } });
    await db.from("duplicate_groups").delete().eq("id", row.id);
  }

  return result;
}

/**
 * Winner election only. Runs after price or stock movement and never calls a
 * model, so repricing keeps the shop correct at no cost.
 */
export async function reelectCanonicals(db: Db): Promise<{ groups: number; changes: number }> {
  const { data: groups } = await db
    .from("duplicate_groups")
    .select("id, canonical_product_id, admin_decision, auto_suppressed")
    .eq("auto_suppressed", true);

  let changes = 0;
  for (const group of ((groups ?? []) as any[])) {
    if (group.admin_decision === "keep_separate") continue;
    const { data: members } = await db
      .from("duplicate_group_members")
      .select("product_id")
      .eq("group_id", group.id);
    const memberIds = ((members ?? []) as any[]).map((row) => row.product_id as string);
    if (memberIds.length < 2) continue;

    const { data: rows } = await db
      .from("shopify_products")
      .select("id, handle, title, price_min, available_for_sale, total_inventory, created_at")
      .in("id", memberIds);
    const { data: qualityRows } = await db
      .from("product_classifications")
      .select("product_id, quality_score")
      .in("product_id", memberIds);
    const qualityBy = new Map(((qualityRows ?? []) as any[]).map((row) => [row.product_id, row.quality_score ?? 0]));

    const facts: MemberFacts[] = ((rows ?? []) as any[]).map((row) => ({
      productId: row.id,
      handle: row.handle,
      title: row.title,
      price: row.price_min === null || row.price_min === undefined ? null : Number(row.price_min),
      available: row.available_for_sale !== false,
      inventory: Number(row.total_inventory ?? 0),
      quality: Number(qualityBy.get(row.id) ?? 0),
      createdAt: String(row.created_at ?? ""),
    }));

    const election = electCanonical(facts, group.canonical_product_id ?? null);
    if (!election) continue;
    if (election.winner.productId === group.canonical_product_id) continue;

    await db
      .from("duplicate_groups")
      .update({
        canonical_product_id: election.winner.productId,
        canonical_handle: election.winner.handle,
        last_elected_at: new Date().toISOString(),
      } as never)
      .eq("id", group.id);

    for (const member of facts) {
      const isCanonical = member.productId === election.winner.productId;
      await db
        .from("duplicate_group_members")
        .update({
          role: isCanonical ? "canonical" : "suppressed",
          suppressed: !isCanonical,
          price: member.price,
          available: member.available,
        } as never)
        .eq("group_id", group.id)
        .eq("product_id", member.productId);
    }

    await audit(db, {
      groupId: group.id,
      productId: election.winner.productId,
      type: "canonical_reelected",
      detail: { reason: election.reason, previous: group.canonical_product_id, price: election.winner.price },
    });
    changes += 1;
  }

  return { groups: (groups ?? []).length, changes };
}

/**
 * Manual exception for one identity group. Normal high confidence operation is
 * automatic, so these are recorded in the audit trail with the acting admin.
 */
export async function applyGroupDecision(
  db: Db,
  groupId: string,
  action: "keep_separate" | "merge" | "reevaluate",
  actor: string | null,
): Promise<{ message: string }> {
  const { data: group } = await db
    .from("duplicate_groups")
    .select("id, canonical_product_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return { message: "That identity group no longer exists." };

  if (action === "keep_separate") {
    await db
      .from("duplicate_group_members")
      .update({ suppressed: false, role: "member" } as never)
      .eq("group_id", groupId);
    await db
      .from("duplicate_groups")
      .update({ admin_decision: "keep_separate", auto_suppressed: false, suppressed_count: 0 } as never)
      .eq("id", groupId);
    await db.from("duplicate_audit_events").insert({
      group_id: groupId,
      event_type: "admin_keep_separate",
      detail: { note: "Listings kept separate by an administrator" },
      actor,
    } as never);
    return { message: "These listings will stay separate on the storefront." };
  }

  if (action === "merge") {
    const { data: members } = await db
      .from("duplicate_group_members")
      .select("product_id")
      .eq("group_id", groupId);
    const ids = ((members ?? []) as any[]).map((row) => row.product_id as string);
    if (ids.length < 2) return { message: "That group no longer has enough listings to merge." };

    const { data: rows } = await db
      .from("shopify_products")
      .select("id, handle, title, price_min, available_for_sale, total_inventory, created_at")
      .in("id", ids);
    const facts: MemberFacts[] = ((rows ?? []) as any[]).map((row) => ({
      productId: row.id,
      handle: row.handle,
      title: row.title,
      price: row.price_min === null || row.price_min === undefined ? null : Number(row.price_min),
      available: row.available_for_sale !== false,
      inventory: Number(row.total_inventory ?? 0),
      quality: 0,
      createdAt: String(row.created_at ?? ""),
    }));
    const election = electCanonical(facts, (group as any).canonical_product_id ?? null);
    if (!election) return { message: "No purchasable listing could be selected." };

    for (const member of facts) {
      const isCanonical = member.productId === election.winner.productId;
      await db
        .from("duplicate_group_members")
        .update({ role: isCanonical ? "canonical" : "suppressed", suppressed: !isCanonical } as never)
        .eq("group_id", groupId)
        .eq("product_id", member.productId);
    }
    await db
      .from("duplicate_groups")
      .update({
        admin_decision: "merge",
        auto_suppressed: true,
        canonical_product_id: election.winner.productId,
        canonical_handle: election.winner.handle,
        suppressed_count: facts.length - 1,
        last_elected_at: new Date().toISOString(),
      } as never)
      .eq("id", groupId);
    await db.from("duplicate_audit_events").insert({
      group_id: groupId,
      product_id: election.winner.productId,
      event_type: "admin_merge",
      detail: { reason: election.reason },
      actor,
    } as never);
    return { message: `Merged. ${election.winner.title} is now the listing customers see.` };
  }

  await db
    .from("duplicate_groups")
    .update({ admin_decision: null } as never)
    .eq("id", groupId);
  await db.from("duplicate_audit_events").insert({
    group_id: groupId,
    event_type: "admin_reevaluate",
    detail: { note: "Queued for a fresh identity pass" },
    actor,
  } as never);
  const outcome = await runDuplicateIdentity(db, { allowTieBreak: false });
  return {
    message: `Re-evaluated. ${outcome.highConfidenceGroups} verified groups and ${outcome.suspectGroups} suspects.`,
  };
}
