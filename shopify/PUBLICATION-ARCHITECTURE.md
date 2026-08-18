# NUR GOODS sales channel architecture

NUR GOODS at https://nurgoods.com is the only shopping and browsing storefront.
The store behind it is the checkout, payment and order engine, reached on
shop.nurgoods.com. That host is infrastructure, never a place we link a shopper.

## Channels in the store

| Channel                   | State | Reason |
| ------------------------- | ----- | ------ |
| Nur Goods Headless Store  | Published | Issues the Storefront API cart and the checkout link |
| Online Store              | Off | Proven unnecessary for checkout. Opt in only |
| Shop                      | Never published | A second shopping surface for our catalogue |
| Point of Sale             | Never published | No physical retail |

Enforced in `src/lib/zendrop/publication-policy.ts`, exercised by
`publication-policy.test.ts`, applied by
`src/lib/zendrop/store-publication.server.ts`, and audited by
`src/lib/zendrop/publication-audit.server.ts`.

## Headless only is LIVE PROVEN

Proven on the live store on 2026-08-18. The turtle product was set by hand to
Nur Goods Headless Store only, with Online Store, Shop and Point of Sale all
off, and checkout still loaded with the exact product, variant and price.
Headless only is therefore the default and is no longer treated as unverified.

The Online Store can be turned back on only by a deliberate per channel
override: the integration setting `publication_include_online_store` set to
`true`. Every time that override takes effect it writes a
`publication_channel_override` row to `integration_events`. Absence of the
setting, or any error reading it, means headless only. Shop and Point of Sale
have no setting at all and are additionally blocked by `assertNoShopChannel`.

If the headless publication cannot be resolved to exactly one channel, nothing
is published at all. There is no fallback to the Online Store.

## Identity, not ids

Publication ids differ per store and per environment, so none is stored.
`resolveHeadlessChannel` finds the headless publication by name at runtime and
throws if it is missing or if more than one candidate exists. Every publish and
every audit passes through that resolution, so an unidentifiable channel means
no change rather than a guess.

## Idempotent reconciliation

`planPublicationReconciliation` produces the exact publish and unpublish work
for one product. A compliant product yields an empty plan and no store write,
so re-running an import or a migration pass can never add Shop or Online Store
back. Product status, price, variants and inventory are never touched.

Removal is destructive, so `ensureStorePublications` only unpublishes when the
caller asks for it. Ordinary import activation publishes the headless channel
and never widens to a forbidden one, but leaves existing channels alone. The
admin reconciliation path is the only caller that passes `removeUnwanted`.

## Migrating the existing catalogue

The admin console at `/control/channels` shows the desired channel state, runs a
read only dry run audit across the active catalogue, and lists drift. A live
reconciliation needs the typed phrase `HEADLESS ONLY`, runs at most ten products
per pass, and writes a row per product into `publication_audit_runs` and
`publication_audit_items`. No bulk unpublishing is performed by this build.

Suggested order: dry run the whole catalogue, reconcile a single low traffic
product by id, buy it, then reconcile in batches.

## Post purchase return path

The native "Continue shopping" button on the Thank you page cannot be
repointed, hidden or overridden on a Basic plan, and the Cart API carries no
return URL. The supported fix is an additive checkout UI extension, scaffolded
at `shopify/extensions/nur-goods-return-cta/`. It is not deployed by this
project, and the admin console says so rather than implying it is live.
