# NUR GOODS return CTA, deployment notes

This folder is **scaffolding, not a live extension**. Nothing in this Lovable
project deploys it. A Shopify app extension has to be pushed to the store with
the Shopify CLI, and then the block has to be placed by a human in the checkout
and accounts editor.

## What it does

Adds a branded action, "Continue shopping at NUR GOODS", to the Thank you page
and the Order status page, linking to https://nurgoods.com.

## Why this route

- Checkout UI extensions on the Thank you and Order status pages are available
  on every plan, including Basic, since the December 2024 rollout.
- `checkout.liquid` and Additional Scripts are excluded on purpose. Additional
  Scripts stop running on those pages for non Plus stores on 26 August 2026.
- The Storefront Cart API has no return URL field, so the destination cannot be
  carried on the checkout link itself.

## Known limitation

On Basic, the native "Continue shopping" button on the Thank you page cannot be
hidden, removed or repointed. Block extensions are additive only. Our CTA can
be placed above it so it reads as the primary action, but both buttons will
exist. Removing native components is a Plus level capability.

## Deploying, done once by a human with store admin access

1. Install the Shopify CLI and authenticate against the NUR GOODS store.
2. Create or reuse a custom app for the store, then copy this folder into that
   app under `extensions/nur-goods-return-cta`.
3. `shopify app dev` to preview, then `shopify app deploy` to release.
4. Install the app on the store.
5. In the store admin open Settings, Checkout, Customise, switch to the Thank
   you page, add an app block, choose NUR GOODS return CTA and drag it above
   the native Continue shopping button. Repeat on the Order status page.
6. Set the block setting `storefront_url` to `https://nurgoods.com`. Any other
   host is ignored by the code and falls back to that value.
7. Place a test order and confirm the CTA appears and lands on nurgoods.com.

Until step 5 is done, the CTA does not exist for shoppers. Nothing in the
platform reports it as live.
