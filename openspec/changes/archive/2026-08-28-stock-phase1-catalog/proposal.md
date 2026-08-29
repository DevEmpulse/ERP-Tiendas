# Proposal: Stock Phase 1 — Product Catalog Data Model

## Intent

Sales are free text: `sales.description` holds a compiled string
(`"1x remera ($15.000) (Efectivo - Ref: #45KI)"`) that the app re-parses in
`salesHelper.ts`. Nothing knows what a *product* is, so stock, margin,
barcodes, and analytics (Phases 2–7) cannot be built. Price rules match by
case-insensitive **name string**, so a typo silently loses the special price.
This phase adds catalog primitives only.

## Scope

### In Scope

- `public.categories` (per-store name) + RLS.
- `public.products` (per-store; name, `category_id` nullable, `purchase_price`,
  `sale_price`, `barcode` nullable, `is_active` soft-delete, timestamps) + RLS.
  Prices/barcode exist now because Phases 4/6/7 need them; unused this phase.
- `public.sale_items` (per-sale lines: `product_id`, `quantity`, `unit_price`
  snapshot, `subtotal`) + RLS. Structured replacement for the description blob.
- `product_price_rules.product_name` → `product_id` FK to `products`.
- History preservation: `sale_items.product_id` is `ON DELETE SET NULL` (or
  products are soft-deleted only); a deleted product never removes a sale line.
- Minimal compatibility shims so existing POS/Stock/PDF screens keep working.

### Out of Scope

Stock quantities and movements (P2), cash register (P3), new POS UI (P4),
granular roles (P5), tickets/barcode rendering (P6), analytics (P7), QA
audit (P8). No UI redesign here — data model plus minimal compatibility.

## Capabilities

### New Capabilities

- `product-catalog`: per-store categories and products with prices, barcode,
  soft-delete, and tenant-isolated RLS.
- `sale-line-items`: structured per-sale lines with price snapshot at sale time,
  surviving product deletion.

### Modified Capabilities

- None (no `openspec/specs/` existed before this change).

## Approach

Append **section 13** to root `migration.sql` (the repo has no
`supabase/migrations/`). Additive-first: create tables, enable RLS, add
`store_id = public.get_current_user_store_id()` `FOR ALL` policies copied
verbatim from the `clients`/`product_price_rules` pattern, then add
`product_price_rules.product_id` **nullable alongside** `product_name`,
backfill, and drop `product_name` only after consumers migrate. All tables
report 0 rows here, so backfill is a local no-op — the script must still be
data-safe for a populated environment.

`sales.description` stays **nullable, not dropped** (Q2): it carries the
`Ref: #XXXX` token `groupSales()` uses to reconstruct split payments across
multiple `sales` rows. Dropping it silently breaks combined payments.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `migration.sql` | Modified | New numbered section 13 |
| `src/components/admin/StockView.tsx` | Modified | Price rules keyed by product |
| `src/components/employee/sales-form.tsx` | Modified | Rule lookup by `product_id` |
| `src/components/admin/SaleModal.tsx` | Modified | Same rule lookup |
| `src/lib/salesHelper.ts` | Modified | Read `sale_items` when present |
| `src/lib/pdfGenerator.ts` | Modified | Render items from `sale_items` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dropping `description` breaks split-payment grouping | High | Keep nullable; defer to P3/P4 |
| Name→id swap breaks 3 price-rule call sites | Med | Nullable `product_id` first, drop later |
| No staging branch; changes hit production | Med | See Q1 — decide before applying |
| RLS gap on new tables leaks cross-tenant data | Low | Copy existing policy pattern verbatim; run `get_advisors` |
| Over-modeling for Phases 2–7 | Med | Only columns with a named future consumer |

## Rollback Plan

Reverse section 13 with an explicit `down` script committed alongside it:
`drop table sale_items, products, categories cascade;` then
`alter table product_price_rules drop column product_id;` (and restore
`product_name` if it was dropped). Because the change is additive and
`sales.description` is retained, rolling back leaves the existing POS fully
functional. Capture a pre-migration snapshot before applying to any environment
with real rows.

## Dependencies

- Decision on Q1 (staging branch vs. direct-to-production) before applying SQL.
- Supabase MCP `execute_sql` access; `get_advisors` run after apply.

## Success Criteria

- [ ] `categories`, `products`, `sale_items` exist with RLS enabled and per-store policies.
- [ ] A cross-tenant read attempt on each new table returns zero rows.
- [ ] `product_price_rules` references `products(id)`; existing rules still resolve in the POS.
- [ ] Deleting a product leaves every historical `sale_items` row intact.
- [ ] Existing sales list, sale modal, and PDF receipt render unchanged.
- [ ] `npm run build` passes; `get_advisors` reports no new security findings.
- [ ] Phase 2 is not required for any of the above to hold.

## Proposal question round — RESOLVED (user decision, 2026-08-28)

1. **Staging vs. production.** → **Provision a Supabase development branch
   first.** Apply and verify Phase 1 SQL on the branch; only merge to
   production after it checks out there. No production apply before a branch
   exists.
2. **`sales.description` fate.** → **Keep nullable, no backfill.** New sales
   stop writing to it once the POS reads `sale_items`; existing rows (0 today)
   are untouched legacy data.
3. **Split payments and `sale_items`.** → **Items attach per `sales` row**
   (one row per payment method, as today). No transaction-grouping entity in
   this phase; `groupSales()`'s `Ref:` token remains the only place combined
   payments are reconstructed until P3/P4 revisit it.
4. **Barcode uniqueness.** → Unchanged from the original assumption: unique
   per `(store_id, barcode)`, nulls allowed (two tenants may reuse a code).
5. **Delete semantics.** → **Soft-delete only** (`is_active` on `products`,
   same on `categories`). Category delete nulls `products.category_id`;
   product soft-delete never touches existing `sale_items` rows — same
   preserve-history principle as `delete_employee_user()`.
