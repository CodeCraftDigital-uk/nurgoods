# NUR GOODS Online Store 2.0 theme

An isolated, dependency free Shopify Online Store 2.0 theme that mirrors the
current NUR GOODS public website. Nothing outside this directory is touched by
this package, and nothing in it is deployed automatically.

- No build step, no bundler, no React runtime, no external JS/CSS CDN beyond the
  brand webfonts.
- No runtime calls to Lovable, Supabase, Zendrop or any NUR API.
- Shopify is authoritative for product data, price, inventory, cart, search and
  checkout. Retail price is never recalculated in Liquid or JavaScript.

## Package structure

```
layout/      theme.liquid, password.liquid
templates/   index, product, collection, list-collections, search, cart,
             page, page.contact, blog, article, 404, password
sections/    header-group.json, footer-group.json, header, footer, hero,
             featured-products, category-carousel, service-cues, home-faq,
             journal-preview, main-product, main-collection, main-search,
             main-cart, main-page, main-contact, main-blog, main-article,
             main-404, cart-drawer, predictive-search
snippets/    meta-tags, organization-schema, brand-logo, nur-category,
             product-card, category-tile, search-form, breadcrumbs, icon
assets/      nur-theme.css, nur-theme.js, brand PNGs, og image
config/      settings_schema.json, settings_data.json
locales/     en.default.json, en.default.schema.json
```

## Design parity with the live headless site

Ported directly from `src/styles.css` and the public components:

- Palette: NUR navy `oklch(0.224 0.052 240.3)`, warm gold `oklch(0.712 0.131 83.7)`,
  white canvas, with hex fallbacks for engines without `oklch`.
- Type: Plus Jakarta Sans display, DM Sans body, Cormorant Garamond for the
  serif section and hero headings. Radii 12 to 18px, glass card and glass panel
  treatments, `--shadow-card` / `--shadow-lift` elevation.
- Header: horizontal master logo, centred search, Support link, basket button
  with live count, primary nav row on desktop, sheet menu on mobile, gold
  dotted service strip. Collections is deliberately not a top level item.
- Homepage order: hero (with live catalogue stats, actions and AI connector
  banner) then Recently added, then Shop by category rail, then service cues,
  then Journal, then FAQ. There is no "From the Range" section.
- Product card, category tile, cart drawer, PDP layout and footer all mirror
  `ProductCard.tsx`, `CategoryTile.tsx`, `BasketSheet.tsx`, `shop.$handle.tsx`
  and `PublicShell.tsx`.

## NUR category contract

The theme never treats a supplier or legacy Shopify collection name as an
authoritative category. `snippets/nur-category.liquid` resolves, in order:

1. `product.metafields.nur.category_name` and `product.metafields.nur.category_slug`
2. the first collection whose handle uses the canonical `nur-` prefix
   (for example `nur-kitchen-dining`)
3. blank, in which case callers show a neutral label or the vendor

`sections/category-carousel.liquid` uses theme editor collection pickers when
blocks are configured, and otherwise auto discovers only `nur-` prefixed
collections. Legacy collections can therefore never appear as category labels.

Because `render` has an isolated scope, callers wrap the snippet in `capture`:

```liquid
{%- capture cat_name %}{% render 'nur-category', product: product, field: 'name' %}{% endcapture -%}
```

## Upload notes

1. Create a new unpublished theme in Shopify, then upload every file in this
   directory with `themeFilesUpsert` (or `shopify theme push --unpublished`).
   Binary assets in `assets/` are already the approved masters and upload as is.
2. Create the menus the theme expects: `main-menu`
   (Home, Store, Journal, Reviews, About, FAQ, Contact, Policies) and `footer`.
   Do not add Collections to the primary menu.
3. Point "Store" at `/collections/all`, or at a dedicated `nur-` collection if
   you prefer a curated store landing page.
4. Create canonical `nur-` collections and, optionally, the
   `nur.category_name` / `nur.category_slug` product metafield definitions.
5. Preview, then publish manually from Shopify admin. Nothing here publishes
   itself.

## Validation performed

- All JSON (templates, section groups, config, locales, embedded section
  schemas) parses.
- Every Liquid file has balanced `if`, `unless`, `for`, `case`, `form`,
  `paginate`, `capture`, `comment` and `schema` blocks.
- Every `render` target snippet and every section type referenced from a
  template or section group exists.
- No hardcoded colours outside the token block, no external framework loaded.

Shopify CLI and `theme-check` were not available in the build environment, so
the checks above were run as a structural audit script rather than by the
official linter. Run `shopify theme check` locally before publishing.

## Known limitations

- Customer account templates are not included, so the store falls back to
  Shopify's default account pages. Add them only if account links are wanted in
  the header.
- Hero stats use `collections.all.all_products_count` and a count of `nur-`
  collections. A live variant count is not exposed to Liquid, so the second
  stat is Categories rather than Variants.
- Predictive search returns Shopify's native resource set. Metafield-only
  attributes such as materials are not part of Shopify's native search index.
- Blog templates assume a blog with handle `journal`.
- Reviews widgets are not embedded. Add the provider's app block once the app is
  installed on the theme.

## Binary assets

Copied into `assets/`: `nur-goods-horizontal-light.png`,
`nur-goods-horizontal-dark.png`, `nur-goods-square-light.png`,
`nur-goods-square-dark.png`, `favicon-nurgoods-v2.png`,
`icon-nurgoods-512-v2.png`, `og-nurgoods-v2.jpg`. No binary assets are missing.

## Parity checklist

- [ ] Header logo, search, support, basket and mobile menu match the live site
- [ ] Service strip copy matches current delivery and support statements
- [ ] Homepage section order: hero, Recently added, Shop by category, cues,
      Journal, FAQ
- [ ] Category cards show only canonical NUR categories
- [ ] PDP shows Shopify price, variants, availability and add to basket
- [ ] Cart drawer opens on add and falls back to `/cart` without JavaScript
- [ ] Search results and predictive suggestions render correctly
- [ ] Product, Organization, WebSite, Breadcrumb and FAQ structured data present
      without duplication
- [ ] Lighthouse mobile pass on home, collection and product
