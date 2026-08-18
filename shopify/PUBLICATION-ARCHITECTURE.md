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

## Headless only is proven

A controlled product was published to the headless channel only, with Online
Store, Shop and Point of Sale all off, and checkout still worked end to end.
The default policy is therefore headless only.

The Online Store can be turned back on by setting the integration setting
`publication_include_online_store` to `true`. Absence of the setting, or any
error reading it, means headless only. Shop and Point of Sale have no setting
at all and are additionally blocked by `assertNoShopChannel`.

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
