# NUR GOODS Platform

Good things, brought to light.

This repository holds the NUR GOODS commerce intelligence, content automation and integration platform. It sits alongside the production store and never replaces it.

- Brand: NUR GOODS
- Site: https://NurGoods.com
- Support: support@nurgoods.com

## Scope

- Commerce remains authoritative in the production store: products, variants, inventory, customers, orders, checkout and payments.
- This platform owns catalogue intelligence, the Journal editorial engine, review placements, SEO intelligence, automations, legal and trust records, and machine readable resource metadata.

## Stack

- React with TanStack Start and TanStack Router
- TypeScript
- Tailwind CSS design tokens in `src/styles.css`
- Postgres with row level security for data, auth and storage

## Local development

```sh
bun install
bun run dev
```

## Structure

```
src/components/admin   shared admin shell and UI primitives
src/lib/services       typed data services per domain
src/lib/ai             provider agnostic editorial workflow
src/routes             application routes
```

## Conventions

- Semantic design tokens only, no hardcoded colours in components.
- Mobile first, accessible, generous spacing, clear hierarchy.
- No em dashes in public facing copy.
