# Proposal: Purchases Tracking

## Intent

**A new, independently-requested capability — NOT a continuation of the completed 8-phase roadmap.**

Cost today is a single scalar with no history: `products.purchase_price` (`migration.sql:464-465`) is silently overwritten on every product edit (`StockView.tsx:325-362`) and every Excel import row (`ProductImportDialog.tsx:365-389`). Nothing records what was paid, to whom, or when; restocking via `adjust_branch_stock` has no cost field. The request is a real Purchase entity mirroring `sales`/`sale_items`.

## Scope

### In Scope
- `purchases` (header: `store_id, branch_id, supplier_name text NULL, purchase_date, note`) + `purchase_items` (`purchase_id, product_id, quantity, unit_cost, subtotal`), with Shape B RLS.
- `apply_purchase_item_stock()` trigger handling **both** `AFTER INSERT` and `AFTER DELETE` (mirroring `apply_sale_item_stock()`'s `TG_OP` branching exactly, not just the INSERT half) so a purchase can be edited (delete + re-insert corrected rows, same pattern as `SaleModal.tsx`'s edit mode) or voided (delete with no re-insert). Nullable `stock_movements.purchase_item_id`; `'purchase'` AND `'purchase_reversal'` added to the `stock_movements.reason` CHECK (two new values, not one — mirrors the existing `sale`/`sale_reversal` pair).
- **Every purchase INSERT sets `products.purchase_price` forward to that row's `unit_cost`**, in addition to being preserved in `purchase_items` history — resolved by the user: the current-cost scalar stays live/meaningful, `purchase_items` is the append-only record of what was actually paid at each point in time.
- `PURCHASE_ROLES` in `src/lib/roles.ts` (admin, superadmin, encargado).
- "Compras" tab in `StockView.tsx` for purchase entry, edit, and void.
- Purchase-history list view reusing `SalesHistory.tsx`'s date-range + daily-grouping pattern.

### Out of Scope
- Any margin/analytics *calculation* change. `analytics_product_ranking` stays untouched; margin math keeps using `products.purchase_price` exactly as today — only what feeds that scalar changes (purchases now update it, not just manual catalog edits/Excel import).
- A `suppliers` table (free-text only).
- Weighted-average or FIFO costing.
- Supplier autocomplete or dedup.
- **Automatic reversion of `products.purchase_price` on edit/void.** Editing or voiding a purchase does not try to restore the current-cost scalar to whatever it was before that purchase — doing so would need a lookback across a product's remaining purchase history, a real edge case once multiple purchases exist for the same product. The scalar simply stays at its last-set value after a void; a correction is a new purchase or a direct catalog edit. Flagged as an orchestrator default in `state.yaml` (`q2b_purchase_price_reversion_on_edit_void`) — confirm before/at apply if this isn't the desired behavior.

## Capabilities

### New Capabilities
- `purchase-tracking`: purchase header/line data model, trigger-driven stock increase, `stock_movements` linkage and reason extension, RLS/role gating, entry and history UI.

### Modified Capabilities
- None. `openspec/specs/product-catalog/spec.md` was read: it defines `products.purchase_price` as a column and its RLS/soft-delete rules, none of which change. No delta needed.

## Approach

Trigger-based, mirroring `apply_sale_item_stock()` (`migration.sql:919-968`) exactly, both directions: inserting a `purchase_items` row atomically increments `branch_stock` and writes a `stock_movements` row (`reason='purchase'`, `purchase_item_id` set); deleting one atomically reverses that exact contribution and writes a `reason='purchase_reversal'` row — same `TG_OP`-branching structure as the sales trigger, applied to purchases. "Editing" a purchase is delete-then-recreate at the API layer (no true in-place `UPDATE` of quantity/cost, consistent with how `SaleModal.tsx` already handles sale corrections); "voiding" is delete with no recreate. RLS on `purchase_items` INSERT/DELETE is the sole write gate (no `UPDATE` policy needed or granted, matching the append-only-per-row, replace-via-delete-insert pattern used for sales).

`ALTER TABLE stock_movements DROP/ADD CONSTRAINT` to widen `reason` (two new values: `purchase`, `purchase_reversal`) is a **production schema change on a live table** and needs the same care as prior CHECK/constraint migrations.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `migration.sql` | New section | Tables, RLS, trigger, CHECK widening, `purchase_item_id` column |
| `src/lib/roles.ts` | Modified | Add `PURCHASE_ROLES` |
| `src/components/admin/StockView.tsx` | Modified | Third `'compras'` tab |
| New purchase entry + history components | New | Header + repeatable line items; dated list |
| `docs/database.md`, `docs/features.md` | Modified | Document the entity |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Third copy of stock-increase arithmetic (`apply_sale_item_stock`, `adjust_branch_stock`, new trigger) drifts — notably floor-at-zero | Med | Copy `apply_sale_item_stock()` line-for-line; assert floor-at-zero identical across all three in design |
| `reason` CHECK widening touches a live table with 5 in-use values | Med | Live-tested migration; verify all 5 existing values still validate before/after |
| RLS not replicating Shape B exactly | Med | Store-wide for admin/superadmin, branch-scoped otherwise; append-only (no UPDATE/DELETE policy) |
| INSERT gate is narrower than `stock_movements`' own role set | Low | Intentional per decision 2: `stock` may adjust quantities but MUST NOT record purchases (cost is sensitive). Spec it explicitly so it is not "fixed" later |
| Delete-then-recreate edit flow silently "succeeds" on a partial/RLS-blocked delete, duplicating stock/cost impact | Med | **This exact bug class already shipped and was fixed once in this codebase**: `salesHelper.ts`'s `deleteSaleGroup` originally returned only `{error}`, so an RLS-blocked 0-row delete was indistinguishable from success — the fix (already live) returns `deletedIds` and both call sites abort on a short count. The new purchase edit/void flow must use the identical pattern from day one: check the actual deleted-row count against the expected count before treating an edit/void as successful, never assume a `null` error means all rows were removed |

## Rollback Plan

Purely additive. Drop trigger → drop `purchase_items` → drop `purchases` → drop `stock_movements.purchase_item_id`. Revert UI/roles by code revert.

**Narrowing the `reason` CHECK back to 5 values requires zero rows with `reason='purchase'`.** Once purchases exist, either delete those `stock_movements` rows first or leave the widened CHECK in place (harmless if unused).

## Dependencies

- Existing `branch_stock`, `stock_movements`, `products`, `branches` tables.
- Live production schema re-verified before `sdd-design` (`state.yaml: production_data_last_verified`); this project applies migrations directly to production.

## Success Criteria

- [ ] An N-line purchase inserts 1 `purchases` + N `purchase_items` rows, increments `branch_stock`, and writes N `stock_movements` rows (`reason='purchase'`, non-null `purchase_item_id`) in one transaction.
- [ ] admin/superadmin/encargado can record a purchase; `employee` and `stock` are rejected by RLS.
- [ ] Cross-store and cross-branch reads return zero rows.
- [ ] `analytics_product_ranking` output is unchanged.
- [ ] All 5 pre-existing `reason` values still insert after the CHECK widening.
- [ ] "Compras" tab records a purchase; history lists purchases by date range with a total.
- [ ] Recording a purchase sets `products.purchase_price` to the new `unit_cost` for every line's product.
- [ ] Editing a purchase (delete + re-insert) correctly reverses the original stock/cost impact and applies the corrected one, with no double-counting; the delete step verifies the actual deleted-row count before proceeding (per the `deleteSaleGroup`-precedent risk above).
- [ ] Voiding a purchase reverses its stock impact via `reason='purchase_reversal'` and does not alter `products.purchase_price`.
- [ ] `npm run build` passes; `get_advisors` reports no new findings.
