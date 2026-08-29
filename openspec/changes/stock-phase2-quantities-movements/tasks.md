# Tasks: Stock Phase 2 — Quantities and Movements

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~520–580 total: migration §14 ~195 (incl. rollback comment) · StockView.tsx ~280–320 · writer fixes ~25 · spec.md reconciliation ~15 |
| 400-line budget risk | High as a single PR; Low per PR in the suggested split |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (migration + writer fixes + spec reconciliation, ~235 lines) → PR 2 (StockView.tsx UI, ~300 lines) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Migration §14 (schema/ledger/RLS/triggers/RPC) + writer dedup fixes + spec reconciliation, shipped together per design's rollout note | PR 1 | N/A — `test_command: ""`; use `execute_sql`/`get_advisors` (Phase 4) | Supabase dev branch: apply §14, `get_advisors(type:"security")`, cross-tenant probe, trigger scenario SQL | Run design.md's committed rollback SQL block + `git revert` the 3 writer files; independent of PR 2 |
| 2 | StockView.tsx Productos tab: CRUD dialog, adjust-stock dialog, movements dialog, zero-stock badge | PR 2 | `npm run build` | Manual dev-branch walkthrough: create tracked product, adjust stock, view movements | Revert `StockView.tsx` to price-rule-only state; PR 1's migration stays valid without it |

## Phase 1: Spec Reconciliation

- [ ] 1.1 `specs/stock-tracking/spec.md` "Append-Only Stock Movement Ledger": split `delta` → `quantity_delta`+`applied_delta`; drop `created_by`; add `opening` to the reason enum.
- [ ] 1.2 Same file, "Admin Product Creation" scenario: creation-time opening movement `reason = restock` → `reason = opening` (matches design §14.5).
- [ ] 1.3 Same file, "Admin-Only Manual Stock Adjustment": remove the `created_by` clause (design declined this column).

## Phase 2: Migration — Schema, Ledger, RLS (`migration.sql` §14.1–14.3)

- [ ] 2.1 Add `products.stock_quantity` column + CHECK (§14.1).
- [ ] 2.2 Create `stock_movements` table + 3 indexes (§14.2).
- [ ] 2.3 Enable RLS; add SELECT+INSERT policies, verbatim `store_id` predicate, no UPDATE/DELETE policy (§14.3).

## Phase 3: Migration — Triggers/RPC (§14.4–14.6) + Writer Fixes (ship together)

- [ ] 3.1 `apply_sale_item_stock()` + `on_sale_item_inserted`/`on_sale_item_deleted` triggers on `sale_items` (§14.4). Satisfies sale-line-items: decrement/reversal/oversell-clamp/untracked-no-op.
- [ ] 3.2 `log_product_opening_stock()` + `on_product_created_with_stock` trigger on `products` (§14.5). Satisfies product-catalog: initial-stock scenario.
- [ ] 3.3 `adjust_product_stock()` RPC: admin-role check, `FOR UPDATE` read-modify-write, ledger insert (§14.6). Satisfies stock-tracking: Admin-Only Manual Stock Adjustment.
- [ ] 3.4 Append the rollback SQL as a trailing comment block, strict drop order.
- [ ] 3.5 `src/components/employee/sales-form.tsx:389`: `flatMap` over `insertedSales` → build items for `insertedSales[0].id` only; update the stale duplication comment. Satisfies sale-line-items: split-payment-decrements-once.
- [ ] 3.6 `src/components/admin/SaleModal.tsx:412`: identical fix, create path only (edit/delete untouched).
- [ ] 3.7 `src/lib/salesHelper.ts` `groupSales()` (~151-167, ~191-201): adopt-if-empty `sale_items` merge branch.

## Phase 4: Migration Verification (Supabase MCP, dev branch — no test runner configured)

- [ ] 4.1 Apply §14 to the dev branch; run `get_advisors(type:"security")`, expect zero new findings (no `rls_disabled_in_public`/`function_search_path_mutable`).
- [ ] 4.2 Cross-tenant probe (design RLS plan step 4): store-A user reads 0 store-B rows; insert/update/delete all rejected or 0 rows.
- [ ] 4.3 `execute_sql` scenarios: sale decrement+log, split-payment decrements once, oversell clamp with full requested delta logged, untracked no-op, delete-then-recreate edit nets to zero.
- [ ] 4.4 If `stock_movements` Data API is unreachable, add the two `GRANT` statements from design.md step 3; re-verify.

## Phase 5: StockView.tsx UI (depends on Phase 3 schema/RPC)

- [ ] 5.1 Split into "Productos" (new, default) / "Precios Especiales" (existing CRUD, moved unchanged) tabs.
- [ ] 5.2 Productos table: Producto/Categoría/P. Compra/P. Venta/Stock/Acciones; Stock cell `—` (NULL) / number / red "Sin stock" badge (0).
- [ ] 5.3 Product dialog: name/category(+inline new)/prices/barcode; create-mode "Rastrear stock" switch (off → NULL); edit-mode stock disabled + helper text pointing to Ajustar stock.
- [ ] 5.4 Adjust-stock dialog: Agregar/Quitar/Fijar toggle, reason select (`restock`/`manual_adjustment`), note; reject zero-delta client-side; calls `adjust_product_stock` RPC, reloads from returned balance.
- [ ] 5.5 Movements dialog: read-only list by `product_id`, `created_at desc`; distinguish `quantity_delta` vs `applied_delta` on divergence.
- [ ] 5.6 Row actions: Editar / Ajustar stock / Ver movimientos / Desactivar (soft delete only, never hard DELETE).

## Phase 6: Application Verification

- [ ] 6.1 Dev-branch walkthrough: create tracked product (stock 50) → confirm one `opening` movement logged.
- [ ] 6.2 Dev-branch walkthrough: adjust/restock via RPC, sell a tracked product, delete/edit a sale — confirm ledger + balance match the design's Data Flow.
- [ ] 6.3 `npm run build` passes.
