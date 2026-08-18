# Why orders are invisible, and the Orders console to build

## Findings (read-only)

**There is no orders UI at all.** The commerce system was built entirely as backend: ledger, orchestrator, webhook ingress, supplier/store ports and two cron jobs. Nothing was ever added to the admin console.

- Control routes present: dashboard, catalogue, preview, journal, reviews, seo, automations, integrations, contact, legal, sourcing, pricing, intake, mcp. No orders/commerce route file exists.
- `ADMIN_NAV` in `src/lib/navigation.ts` has 14 entries, none commerce related. So nothing is hidden or unlinked; it simply was never built.
- No client-callable commerce server functions exist. `src/lib/commerce/` contains only `*.server.ts` / plain modules (`ledger.server`, `orchestrator`, `jobs.server`, `supplier.server`, `store.server`, `ports`, `types`, `webhook`). There is no `commerce.functions.ts`, so the UI has no callable surface for actions.

**Backend data that is already available to power a UI**

- `commerce_orders` (39 cols): Shopify identity (`shopify_order_id/name/number`, financial + fulfillment status), `currency`, `order_total`, ship-to city/country, Zendrop identity (`zendrop_store_id`, `zendrop_order_id`, `zendrop_order_number`, `zendrop_fulfillment_operation_id`), `orchestration_state`, `supplier_status`, tracking number/carrier/url, `fulfilment_cost` / `product_cost` / `shipping_cost` / `gross_margin`, `preview_payload` / `preview_at` / `preview_reference` / `preview_scope` / `preview_is_credit_redeem`, `dispatch_idempotency_key`, `last_error`, `retry_count`, and the timeline stamps `paid_at`, `submitted_at`, `shipped_at`, `delivered_at`, `lines_linked_at`.
- `commerce_order_lines`: Shopify line/variant/product ids, sku, title, qty, unit price, and Zendrop line/store-line/product/variant ids plus per line supplier status and tracking.
- `commerce_order_events`: from/to state, code, message, jsonb detail, timestamp. A ready made timeline.
- `commerce_webhook_deliveries`: webhook id, topic, order id, status, attempts, processed_at, last_error.
- `commerce_settings`: `auto_fulfilment_enabled`, `allow_supplier_credit`, `safe_test_order_ids`, `max_orders_per_run`.
- Cron: `nurgoods-order-fulfilment-queue` every 10 min and `nurgoods-order-tracking-sync` every 30 min, both active; `automation_jobs` rows `order_fulfilment_queue` and `order_tracking_sync` both enabled and last succeeded today.
- RLS: all five commerce tables have admin-only SELECT for `authenticated` and no write policies, so read screens can query directly while every action must go through a server function.

**Note on financials.** Supplier cost columns have no currency of their own; the only currency column is the Shopify order currency. Any cost display must be labelled as supplier quoted rather than silently rendered as GBP.

## Recommended admin UI

New section `/control/orders` (nav entry "Orders and Fulfilment", placed after Dashboard).

**1. Orders list** `/control/orders`
- Attention-first grouping: manual review and failures pinned at the top, then active, then terminal.
- Columns: order name/number, paid at, total with order currency, ship-to country, orchestration state pill, supplier status, Zendrop order number, tracking presence, retry count.
- Filters by state, search by Shopify order name/number or Zendrop order id, plus a state count summary strip.

**2. Order detail** `/control/orders/$orderId`
- Header: state pill, Shopify order link, Zendrop order/store ids, paid/submitted/shipped/delivered stamps.
- Shopify and webhook panel: financial and fulfillment status, plus that order's webhook deliveries with topic, attempts, status and last error.
- Zendrop panel: store id, order id/number, supplier status, fulfilment operation id, dispatch idempotency key, preview reference/scope/age and whether the preview is a credit redeem.
- Line mapping table: each Shopify line beside its linked Zendrop line, with an explicit unlinked warning where mapping is missing rather than an empty cell.
- Tracking panel: carrier, number, link out, last observed by the tracking job. Never render a fabricated tracking value.
- Event timeline from `commerce_order_events`, newest first, with expandable jsonb detail.
- Financials: order total in order currency, supplier product/shipping/fulfilment cost labelled "supplier quoted", gross margin shown only when both sides are present and comparable, otherwise "not comparable".

**3. Operations panel** (top of list page)
- Safety flags read-out: auto fulfilment, supplier credit, max orders per run, safe test order ids. Toggles are admin-only server actions with a typed confirmation for enabling auto fulfilment or supplier credit.
- Cron health: both order jobs with schedule, enabled state, last run and last status, drawn from `automation_jobs`.
- Manual "run fulfilment queue" and "run tracking sync" buttons that call the existing job entry points.

**4. Manual review actions** (order detail, all admin-verified server functions)
- Quote/preview supplier cost (read-only supplier call, no confirmation).
- Confirm dispatch, gated by: auto fulfilment off means explicit owner confirmation, a typed order number, and a disabled button whenever `zendrop_order_id` or `dispatch_idempotency_key` is already set.
- Link an externally placed supplier order (the manual backfill path used for #1001) without any supplier write.
- Mark resolved / return to queue / cancel orchestration, each writing a `commerce_order_events` row.

**Duplicate submission safeguards**
- Server side remains authoritative: confirm refuses when a dispatch key or supplier order id already exists, and reuses the existing key otherwise.
- UI shows the existing dispatch key and supplier order id prominently and disables confirm on their presence.
- Single-flight confirm button with server round-trip acknowledgement, no optimistic state.
- Any confirm timeout lands in manual review rather than auto retrying, matching the current orchestrator behaviour.

## Technical notes

- Add `src/lib/commerce/commerce.functions.ts` with read fns (list, detail, settings, cron health) and mutation fns, all behind `requireSupabaseAuth` plus an explicit `has_role(uid,'admin')` check, loading `*.server` modules inside handlers.
- Routes live under `src/routes/_authenticated/control.orders.*`; nav item added to `ADMIN_NAV`.
- Reads may go through the existing admin-only SELECT policies; no RLS or grant changes are required for the read screens. Mutation fns use verified admin identity, not the anon path.
- No changes to safety flags, cron schedules, or supplier behaviour as part of building the UI.
