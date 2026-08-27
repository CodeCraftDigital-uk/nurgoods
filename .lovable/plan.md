# Production incident report: 173 live products taken off sale on 27 Aug 2026

Read-only investigation. Nothing was changed: no code edits, no Shopify mutations, no jobs run.

## Summary of what happened

At 07:45:00Z to 07:49:12Z a **manually triggered supplier reconciliation** ran its stale-listing sweep, found 200 supplier links whose supplier facts were older than the 48 hour freshness target, and took every one of them off sale (unpublished from all channels, then set to DRAFT). This was not a pricing failure and not an automated schedule.

## 1. Responsible job / run

- Code path: `src/lib/zendrop/supplier-refresh.server.ts` -> `sweepStaleListings()` (lines 131-165) -> `takeOffSale()` (line 526) -> `holdProductFromSale()` in `src/lib/pricing/integrity.server.ts:443` -> `holdProduct()` which unpublishes every live publication then `productUpdate status: DRAFT`.
- Trigger: the admin server function `runSupplierRefreshFn` in `src/lib/zendrop/zendrop.functions.ts:414-422` (the "Supplier product health" panel). The scheduled job `supplier_product_refresh` is `enabled = false` and last ran 2026-08-21 10:17, and there is **no `automation_runs` row** in the 07:45-07:49 window for it, so this came from the admin UI, not the scheduler.
- Shopify audit evidence (product `events`, attributed to the custom app "NUR Goods Link", `attributeToUser = false`), example `gid://shopify/Product/15964874572106`:
  - 07:49:00Z excluded from Online Store, Shop, Nur Goods Headless Store
  - 07:49:00Z changed product status from active to draft
- Database evidence: `product_supplier_links` rows moved to `sync_state = held_stale`, `held_reason = freshness_target_breached`, in minute buckets 07:45 (4), 07:46 (59), 07:47 (62), 07:48 (61), 07:49 (14) = 200 links. Live draft `updatedAt` buckets match exactly: 07:45 (2), 07:46 (52), 07:47 (53), 07:48 (55), 07:49 (11), 07:53 (1).

## 2. Why each cohort was held

Grouped over the 174 current live DRAFT products:

| Reason | Count | Evidence |
| --- | --- | --- |
| `held_stale` / freshness_target_breached (supplier facts older than 48h) | 174 of 174 | `product_supplier_links.sync_state`, `held_reason`, `sync_reason` |
| Pricing gate hold | 0 | `product_pricing_lifecycle` for all 174 drafts is `verified` (160 "every variant priced on the canonical formula", 14 "written to the store and read back identical") |
| Intake quarantine today | 16 `eligible_status` + 2 `purchasable_variant`, all before 06:39Z, unrelated to this window | `product_intake_events` |
| Prohibited category | 0 quarantined (2 flagged only) at 07:20 | `automation_jobs.last_result` for `prohibited_category_sweep` |

Underlying cause of the staleness: `last_supplier_sync_at` on the held links is 2026-08-21 (about 6 days old). The supplier refresh job that keeps that data fresh has been disabled since 21 Aug ("Retired by the Shopify-led catalogue model"), so the freshness clock kept running with nothing refreshing it. The first manual run of the retired job then held everything it had aged out.

## 3. Were formerly active products demoted?

Yes. Of the 174 current live drafts, **173 were `active` in the catalogue mirror immediately before the sweep** and 1 was already draft. Live status now 268 ACTIVE / 174 DRAFT versus the previously verified 431 ACTIVE / 112 DRAFT.

## 4. Why the total fell by 101 (543 -> 442)

- Mirror holds 557 product rows; **116 of them no longer exist in Shopify**. Every one of the 116 had mirror status `draft` (samples: "Women's Sexy Sports Set with Mesh Bikini", "Pet Hair Spray Brush", "LED Spinning Pen", several oversized tee listings).
- No deduplication caused it: `duplicate_group_members` has only 7 suppressed rows, and today's `duplicate_audit_events` are 1 `admin_reevaluate`, 2 `canonical_elected`, 2 `group_created_high_confidence`. The `catalogue_duplicate_identity` job reports "0 suppressed" style output only ("8 verified groups, 16 listings presented once, 110 suspects for review").
- No application deletion path exists: there is no `productDelete` mutation anywhere in `src/` or `scripts/`.
- Conclusion: the 116 draft products were deleted in Shopify outside this application (merchant admin or the Zendrop app). Shopify does not retain events for deleted products, so the only surviving evidence is the mirror-versus-live difference. Net arithmetic: 557 mirror - 116 deleted = 441, plus 1 newly created product not yet mirrored = 442 live.

## 5. Did the 20 new products bypass the safe draft-review workflow?

Yes. 11 products carry `createdAt >= 2026-08-27T00:00:00Z` (the rest of the merchant's 20 fall outside that window or are among the deleted). All 11 are ACTIVE and **none has a row in `product_intake_records`**. Shopify events for two of them:

- `15999563432266` "Portable 500ml Plastic Hot Cold Drink Cup": 07:47:35Z created by "Zendrop - Dropshipping & POD", 07:48:00Z published to Online Store by Zendrop, 07:59:33Z published to Shop and Nur Goods Headless Store by "Mohammad Qadri" (Shopify Web, `attributeToUser = true`).
- `15999446483274` "FireProof Document Organizer": same shape at 06:44:10Z / 06:44:26Z / 07:43:07Z.

So Zendrop is still creating products as ACTIVE and self-publishing to Online Store, which is exactly the import-as-DRAFT setting that was flagged as needing a manual change in the Zendrop app. The NUR pricing gate never saw them, and `pricing_formula_policy.activation_enabled` is still `false`, so the app did not activate them.

## 6. Current queue and job state

- `catalogue_duplicate_identity` running (started 08:05:00Z), `catalogue_intelligence_worker` running (08:03:02Z), `product_intake_worker` running (07:52:00Z), `catalogue_intelligence_backfill` failed/recovered (07:48Z).
- Persistent pattern: `product_intake_worker` has 28 failed runs today, all "Recovered: the run was interrupted before it could report a result"; `catalogue_intelligence_backfill` 7 failed the same way.
- `storefront_snapshot_refresh` succeeded 08:00:02Z with 424 listings, still containing products the sweep drafted, so the public site is currently ahead of Shopify reality until the next refresh reconciles.
- Intelligence queue: 209 items remaining at the last completed worker pass.
- `pricing_formula_policy`: `formula_version = nur-landed-markup-v5`, `activation_enabled = false`.
- Next scheduled actions (cron): duplicate identity 5/25/45, intelligence worker every 10 min at :03, intake worker 7/22/37/52, intelligence backfill 8/28/48, snapshot refresh every 10 min, `price_authority_sync` every 30 min, `prohibited_category_sweep` at :20, `shopify_catalogue_sync` at :40 every 4 hours. **`supplier_product_refresh` remains disabled**, so nothing will hold further products automatically, and nothing will restore the 174 either.

## Proposed remediation (not executed, for approval)

1. Guard the stale sweep: do not take listings off sale when the refresh job that maintains freshness is disabled, and cap/confirm the sweep instead of holding up to 200 products in one unattended call.
2. Decide the freshness policy explicitly: either re-enable a bounded `supplier_product_refresh` schedule so `last_supplier_sync_at` stays inside 48 hours, or retire the freshness hold entirely under the Shopify-led model.
3. Restore the 173 demoted products once policy is agreed: they are all pricing `verified` on v5, so restoration is a status/publication change only, run in batches with read-back verification.
4. Close the Zendrop import bypass: set Zendrop to import as DRAFT and unpublish-on-create, or add an intake reconciliation that detects app-created ACTIVE products with no intake record and returns them to DRAFT until gated.
5. Fix the intake and intelligence worker interruptions (28 failed runs today) so the queue drains within its budget.
6. Reconcile the mirror against live deletions so the 116 phantom rows and the storefront snapshot stop describing products that no longer exist.
