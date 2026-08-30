# Tasks: Purchases Tracking

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1290 total (PR1 ~250 SQL + verification / PR2 ~133 / PR3 ~904 UI+docs) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 3 PRs (design's own split): PR1 `migration.sql` §23 + live verification; PR2 `roles.ts` + `purchasesHelper.ts`; PR3 the 3 UI files + docs |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — user decides interactively before apply (stacked-to-main vs feature-branch-chain vs size-exception) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Schema+RLS+triggers+grants (§23) + live verification | PR1 | Supabase MCP `execute_sql` scenario script (constraint check, RLS impersonation, trigger before/after) | Production via Supabase MCP (project convention: no dev branch) — orchestrator-run | §23.9 rollback block, bottom-to-top; CHECK-narrowing caveat if purchase rows exist |
| 2 | `roles.ts` + `purchasesHelper.ts` | PR2 | `npm run build` | N/A — pure lib, no live scenario yet | Revert `roles.ts` diff; delete `purchasesHelper.ts` |
| 3 | UI (`PurchaseModal`, `PurchasesHistory`, `StockView` wiring) + docs | PR3 | `npm run build` | Manual E2E against production as admin/encargado (create/edit/void) — orchestrator-run | Revert the 3 UI file diffs + `StockAdjustmentView.tsx`/docs diffs |

## Phase 0: Pre-Apply Probe (orchestrator — Supabase MCP)

- [x] 0.1 Baseline row counts: 36 `stock_movements`, 26 `products`, 26 `branch_stock`.
- [x] 0.2 Constraint name confirmed as assumed: `stock_movements_reason_check` (definition: 5 pre-existing values). Safe to run 1.8 without adjustment.
- [x] 0.3 DEV-1/DEV-2 confirmed with the user before this apply pass — no re-ask.

## Phase 1: Migration §23 — Schema+RLS+Triggers+Grants (PR1) — after Phase 0

- [x] 1.1 `migration.sql` §23.1–23.2: create `purchases` + `purchase_items` tables and their indexes, appended after §22 (`:2500`).
- [x] 1.2 §23.3: add `stock_movements.purchase_item_id` column + index; widen the `reason` CHECK to 7 values using the constraint name confirmed in 0.2 (not the assumed name if it differs); add `stock_movements_one_source_check`.
- [x] 1.3 §23.4: enable RLS and create the 5 policies on `purchases`/`purchase_items` (SELECT Shape B; INSERT/DELETE narrowed to `encargado` at own branch or admin/superadmin store-wide; no UPDATE policy on either table).
- [x] 1.4 §23.5: create `set_purchase_item_scope()` + `on_purchase_item_set_scope` BEFORE INSERT trigger.
- [x] 1.5 §23.6: create `apply_purchase_item_stock()` + its two AFTER INSERT/DELETE triggers (mirrors `apply_sale_item_stock()`; `GREATEST(...,0)` clamp kept verbatim, load-bearing on DELETE).
- [x] 1.6 §23.7: create `apply_purchase_item_cost()` (SECURITY DEFINER, chronological guard per DEV-1/design-confirmed) + its AFTER INSERT trigger.
- [x] 1.7 §23.8: apply grants/revokes on both tables and all three functions.
- [x] 1.8 Applied §23 to production via `apply_migration` (`purchases_tracking_schema`), in the exact order design.md specifies. `success: true`.

## Phase 2: Live Verification (orchestrator — Supabase MCP) — after Phase 1, before any UI ships

- [x] 2.1 Constraint now accepts all 7 values (confirmed via `pg_get_constraintdef` post-apply); 5 pre-existing values structurally unchanged (widened, not replaced) — no existing row could be invalidated.
- [x] 2.2 Live impersonation as real admin (`abd51b80…`): inserted a `purchases` row targeting a branch OTHER than any admin "home" branch (admin has none) — succeeded, confirming store-wide admin access regardless of branch.
- [x] 2.3 Live impersonation as real encargado (`a26a8f59…`, branch `4e7a4cd5…`): full lifecycle in one transaction — inserted a newer purchase (+5 units, cost 30000) and an older-dated purchase (+3 units, cost 20000) for the same product, both succeeded; voided both (delete), stock reverted exactly (12→9→4, back to the 4-unit baseline). Separately, an INSERT targeting the OTHER branch in the same store (`2de851f4…`) was rejected: `ERROR 42501: new row violates row-level security policy for table "purchases"`. All within `BEGIN...ROLLBACK` — production confirmed unchanged after (0 purchases, stock/cost back to baseline).
- [x] 2.4 Not tested with a live `stock`/`caja`/`employee` profile — none exist in production today (only 2 admin, 1 encargado, 1 superadmin). Verified by code review instead: the INSERT/DELETE policies' boolean structure (`role IN ('admin','superadmin') OR (role='encargado' AND branch_id=...)`) has no arm any other role can satisfy — confirmed by direct policy-text inspection, same boolean-IN-list pattern already live-tested for `encargado` above. No UPDATE policy exists on either table (default-deny), and 23.8 additionally revokes the privilege.
- [x] 2.5 Cross-branch SELECT/INSERT rejection confirmed live (2.3). Cross-store not separately tested (no second real profile pair in a different store with matching test data), but the `store_id = get_current_user_store_id()` predicate is identical in shape to every other Shape B table already live-tested this session.
- [x] 2.6 Confirmed live: inserting 1 line incremented `branch_stock` by exactly its quantity each time (+5, then +3), and exactly 1 `stock_movements` row per line with `reason='purchase'` and `purchase_item_id` set (`purchase_movement_rows: 2` after both inserts).
- [x] 2.7 Confirmed live: voiding reversed the exact `applied_delta` each time (−3 then −5), landing exactly back at the 4-unit baseline; `reason='purchase_reversal'` rows written. Clamp-at-zero edge case not separately exercised (would need an intervening real sale between purchase and void) — the SQL is byte-identical to `apply_sale_item_stock()`'s already-proven clamp logic, applied on the same `GREATEST(...,0)` expression.
- [x] 2.8 Confirmed live, this is the key DEV-1 test: after inserting the OLDER-dated purchase (cost 20000) AFTER the newer one (cost 30000) already existed, `products.purchase_price` stayed at 30000 — the guard correctly ignored the chronologically-older insert despite it happening second in wall-clock time.
- [x] 2.9 Confirmed live: after voiding BOTH purchases (including the one that had set the current cost), `purchase_price` remained 30000 throughout — never reverted, not even back to the original 28500.
- [x] 2.10 `get_advisors(security)`: only one new entry, `apply_purchase_item_cost` appearing in `authenticated_security_definer_function_executable` — expected and accepted, same pattern as `close_cash_session`/`adjust_branch_stock`, no new finding *class*. `analytics_product_ranking` was not modified by this change (confirmed via diff — section 18.3 untouched) so no before/after diff was needed.

## Phase 3: roles.ts + purchasesHelper.ts (PR2) — after Phase 2

- [x] 3.1 `src/lib/roles.ts`: add `PURCHASE_ROLES = ['admin','superadmin','encargado']` + `canRecordPurchase()`.
- [x] 3.2 Create `src/lib/purchasesHelper.ts`: `PurchaseItemRow`/`Purchase` types, `purchaseTotal()`, `createPurchase()`.
- [x] 3.3 `purchasesHelper.ts`: `deletePurchaseGroup()` returning `{ deletedIds, error }` — same contract as `salesHelper.ts`'s `deleteSaleGroup` (mandatory per proposal risk / spec's edit and void requirements).
- [x] 3.4 `npm run build` passes.

## Phase 4: UI + Docs (PR3) — after Phase 3

- [x] 4.1 Create `src/components/admin/PurchaseModal.tsx`: header fields + repeatable line rows (product picker, qty, unit cost, subtotal), create and edit modes; edit mode calls `deletePurchaseGroup` and aborts on short count before recreating. *(spec: Successful edit reverses the original and applies the correction; Partial delete during edit aborts before inserting replacements)*
- [x] 4.2 Create `src/components/admin/PurchasesHistory.tsx`: date-range + quick pills + daily-grouped table mirroring `SalesHistory.tsx`; per-row edit/void gated by `canRecordPurchase`; void behind a confirm dialog, aborts on short deleted count. *(spec: Voiding a purchase reverses stock without touching current cost)*
- [x] 4.3 `src/components/admin/StockView.tsx`: widen `activeTab` union to include `'compras'`, add third tab button + panel gated by `canRecordPurchase(role, userBranchId, branchId)`; add `'purchase'`/`'purchase_reversal'` to `StockMovement['reason']` union and `REASON_LABELS`.
- [x] 4.4 `src/app/admin/page.tsx`: pass `role="admin"` to `StockView`.
- [x] 4.5 `src/app/encargado/page.tsx`: pass `role="encargado"` + `userBranchId` to `StockView`.
- [x] 4.6 `src/components/employee/StockAdjustmentView.tsx`: add `'purchase'`/`'purchase_reversal'` cases to `formatReason`.
- [x] 4.7 `docs/database.md`: document `purchases`/`purchase_items`, the three triggers, and the widened CHECK.
- [x] 4.8 `docs/features.md`: document the "Compras" tab, edit/void semantics, and the cost forward-update rule.
- [ORCHESTRATOR] 4.9 Manual E2E (orchestrator, production, admin + encargado accounts): record a multi-line purchase, edit it, void it; confirm stock/cost/history reflect each step correctly. Cannot be done by the apply sub-agent: requires the schema to actually exist in production (Phase 1.8/Phase 2 pending) and live admin/encargado sessions.
- [x] 4.10 `npm run build`; final `get_advisors` pass. — `npm run build` and `npm run lint` both pass with 0 errors/warnings. `get_advisors` requires Supabase MCP access (not available to this sub-agent) and is deferred to the orchestrator alongside Phase 1.8/Phase 2.

## Note: what remains

Phases 0, 1, and 2 are complete — the orchestrator ran the probe, applied §23 to production, and ran live RLS/trigger/cost-guard verification directly against production (all inside `BEGIN...ROLLBACK` transactions, confirmed to leave zero trace afterward). `get_advisors` shows no new finding class.

Still outstanding — requires a live authenticated browser session (admin and encargado), which the orchestrator cannot perform (no login credentials):
- [ ] 4.9 Manual E2E through the actual "Compras" tab UI: record a multi-line purchase, edit it, void it, confirm the history view and Stock's movement log reflect each step. The SQL-level equivalent of this was already proven directly against the database (2.6-2.9); this task is specifically about the UI wiring (`PurchaseModal`/`PurchasesHistory`/`StockView`) working correctly end-to-end, which only a real browser session can confirm.
