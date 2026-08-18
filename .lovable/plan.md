# Checkout return path: investigation result and options

Customers pay on `shop.nurgoods.com` (the store's own checkout host) and the native "Continue shopping" button after payment sends them there instead of back to `nurgoods.com`.

## What the code does today

Confirmed by reading `src/lib/services/shopify-storefront.server.ts`:

- The basket creates one cart through the official Cart API and uses the `checkoutUrl` the store issues (`createStorefrontCartLines`).
- `finaliseCheckoutUrl` only rewrites the host of that link so a shopper is never sent to a host that loops back here. It records nothing about where the shopper should return to.
- There is no return-path handling anywhere in the basket, checkout or storefront code today.

So this is not a bug in our handoff. The link we hand over is correct. The button after payment is rendered by Shopify.

## What Shopify actually allows in 2026

Verified against current Shopify documentation and changelogs.

1. The Cart API has no return URL. `cartCreate` and the resulting `checkoutUrl` accept no `return_to`, redirect or custom storefront field. Cart `attributes` are free form key and value pairs that ride along to the order as metadata only. Nothing in checkout reads them for navigation.
2. The native "Continue shopping" target is not configurable. It points at the store's primary Online Store domain. There is no setting for it in the checkout and accounts editor, in domain settings, or in Markets.
3. Thank you and Order status UI extensions are available on Basic. Since the December 2024 rollout, block extensions on those pages work on every plan, using the `purchase.thank-you.block.render` and `customer-account.order-status.block.render` targets. They are additive only.
4. **The native button cannot be overridden or hidden on Basic.** Block extensions cannot remove or repoint built in page elements. Replacing native page components sits in the Plus tier of the checkout and accounts editor. So on Basic both buttons will exist side by side.
5. Legacy routes are closed. Additional Scripts on the Order status page stop running for non Plus stores on 26 August 2026, so a script based redirect is not a durable answer and is excluded here.

## Options, ranked

### Option A, recommended: add our own return CTA with a Thank you / Order status UI extension

Build a small Shopify app extension using `purchase.thank-you.block.render` plus `customer-account.order-status.block.render`, rendering a clear primary action such as "Return to NUR GOODS" that links to `https://nurgoods.com`, styled with the checkout branding so it reads as ours.

- Safest and fully supported, no deprecated surface, works on Basic.
- Placement is chosen by the merchant in the checkout and accounts editor, so the block can sit above the native button and become the visually dominant action.
- Limitation to accept: the native "Continue shopping" button remains and still points at `shop.nurgoods.com`.
- Requires deploying a Shopify app extension and enabling the block in the editor, which is work outside this codebase.

### Option B: make `shop.nurgoods.com` bounce post purchase traffic home

Leave the checkout as is and make the checkout host forward shoppers who arrive at its storefront pages back to `nurgoods.com`, so pressing the native button still lands them on our site.

- No app extension needed, and it fixes the native button's real world outcome rather than the label.
- Risk: `finaliseCheckoutUrl` deliberately refuses a checkout host that redirects back to this site, because that pattern breaks checkout links. Any forwarding must be scoped strictly to non checkout paths and proven not to disturb the probe. This needs careful verification before it can be trusted.
- Depends on how the checkout host is served, which needs confirming in the store admin before committing.

### Option C: accept it and improve our own pre checkout messaging

Set expectations on the basket and checkout handoff so the domain change is not surprising, and rely on order confirmation emails, which we can brand and link to `nurgoods.com`.

- Zero risk, zero platform work, but does not change the button.
- Reasonable interim step while Option A is built.

### Not viable

- Passing a return URL on the checkout link. Unsupported, no such field.
- Changing the button target in admin. No such setting exists.
- Additional Scripts or `checkout.liquid` redirects. Sunsetting 26 August 2026.
- Shopify Functions. They cover discounts, shipping, payment and validation logic, never page navigation.

## Shopify admin changes each option needs

- Option A: install or deploy the app carrying the extension, then place the block on the Thank you and Order status pages in the checkout and accounts editor. Optionally align checkout branding with NUR GOODS.
- Option B: domain and hosting configuration for `shop.nurgoods.com`, plus a re-check that the checkout host still answers as the store.
- Option C: none.

## Straight answer on the native button

On Shopify Basic the native "Continue shopping" button cannot be repointed, hidden or overridden. It can only be out-ranked visually by a block extension, or made harmless by forwarding the destination host.

## Recommendation

Option A as the real fix, with Option C copy work alongside it now. Evaluate Option B only after confirming how `shop.nurgoods.com` is served, because it interacts with the existing checkout host safety gate.

Nothing has been implemented. Confirm which option to build and I will scope the implementation.
