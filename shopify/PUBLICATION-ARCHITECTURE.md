# NUR GOODS sales channel architecture

NUR GOODS at https://nurgoods.com is the only shopping and browsing storefront.
The store behind it is the checkout, payment and order engine, reached on
shop.nurgoods.com.

## Channels in the store

| Channel                   | Intended state | Reason |
| ------------------------- | -------------- | ------ |
| Nur Goods Headless Store  | Published      | Issues the Storefront API cart and the checkout link |
| Online Store              | Published for now | See the finding below. Not proven removable yet |
| Shop                      | Never published | A second shopping surface for our catalogue |
| Point of Sale             | Never published | No physical retail |

Enforced in `src/lib/zendrop/publication-policy.ts`, exercised by
`publication-policy.test.ts`, and applied by
`src/lib/zendrop/store-publication.server.ts`.

## Is Online Store publication actually required?

Read from the real checkout implementation in
`src/lib/services/shopify-storefront.server.ts`:

- The basket calls `cartCreate` on the Storefront API using the private token
  issued to the headless channel, then sends the shopper to the `checkoutUrl`
  the store returns. Nothing in our code reads an Online Store page.
- Storefront API visibility is per channel: a variant resolves because it is
  published to the headless channel, not the Online Store.
- The hosted checkout that `checkoutUrl` points at is served by the checkout
  system, not by the Online Store channel.

On that evidence, headless only publication should produce a working checkout,
so the code is designed for it. It has **not** been proven against the live
store, so the default stays as it is and nothing has been unpublished.

Fail safe behaviour: `loadPublicationPolicy()` defaults to including the Online
Store, and any error reading the setting also returns the safe, buyable
configuration.

## Proving it before any bulk change

1. Pick one controlled, low traffic product.
2. In the store admin, unpublish that product from Online Store and Shop,
   leaving Nur Goods Headless Store published.
3. On nurgoods.com, add it to the basket and confirm a checkout link is issued
   and the checkout page loads with the correct line and price. Complete a real
   or test purchase.
4. If it holds, set the integration setting `publication_include_online_store`
   to `false`. New imports will then target the headless channel only.
5. Only after that, consider unpublishing the rest. Nothing here does that in
   bulk.

`readStorePublications(shopifyProductId)` gives a read only per product channel
report to check state before and after, and never writes.

## Shop channel

There is no setting that turns Shop publishing on. `selectPublicationTargets`
excludes it even when an opt in flag is passed, and `assertNoShopChannel`
throws if a Shop publication ever reaches the publish mutation. Enabling it
would require a deliberate code change plus a test change.

## Post purchase return path

The native "Continue shopping" button on the Thank you page cannot be
repointed, hidden or overridden on a Basic plan, and the Cart API carries no
return URL. The supported fix is a checkout UI extension, scaffolded at
`shopify/extensions/nur-goods-return-cta/`. It is not deployed by this project.
