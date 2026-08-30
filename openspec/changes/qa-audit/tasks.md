# Tasks: QA Audit (P8)

> This change skipped separate spec/design artifacts: the orchestrator resolved
> `fork_1_remediation_scope` to Approach 1 (documentation-only fix + tracked
> debt ledger, zero production/runtime risk) directly at apply time, since the
> scope was fully narrowed and detailed in `exploration.md`/`state.yaml` before
> any code was touched. No SQL/RLS/production schema change is part of this
> phase — see "Explicitly deferred" below.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~230 (docs) + ~60 (lint, scattered across 11 files) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | ask-on-risk |
| Chain strategy | N/A — single PR, well under budget |

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Low

## Phase 1: `docs/database.md` staleness fixes

- [x] 1.1 Removed the duplicate, stale `profiles` table section (old 3-role `CHECK ('admin','employee','superadmin')`, matching `migration.sql:214-215`, itself superseded by the granular-roles migration at `migration.sql:1076-1078`). Cross-checked the surviving section's 6-role `CHECK` and `profiles_employee_branch_check` CASE expression against `migration.sql:1076-1078` — verified accurate, kept as the sole `profiles` section.
- [x] 1.2 Fixed the stale `sales.branch_id` RLS claim (was: "las políticas RLS de `sales` siguen siendo a nivel de tienda completa"). Cross-checked against `migration.sql:1417-1477`'s actual current `CREATE POLICY` statements for `sales` (Shape D, branch-and-verb-split, `admin`/`superadmin` store-wide vs. `encargado`/`caja`/`employee` branch-scoped) — corrected the claim to match, consistent with the existing RLS table further down the same file.
- [x] 1.3 Replaced the dead `sales-form.tsx` reference (deleted in the `pos-ui` phase) with `/pos` (`src/components/pos/PosShell.tsx`), alongside `SaleModal.tsx` for corrections/edits, in the `cash_session_id` resolution note.
- [x] 1.4 Added a new "Store Analytics — agregación de solo lectura (secciones 18-19)" section documenting all 6 read-only aggregation objects from `migration.sql` §18-20: `analytics_low_stock` view (`security_invoker = true`), `analytics_product_ranking`, `analytics_branch_comparison` (the one hand-derived-predicate exception), `analytics_cash_discrepancy` (documented as unused-by-UI debt, not a new finding), `analytics_sales_trend`, `analytics_category_comparison` (all `SECURITY INVOKER`), the revoke/grant pattern, and the `branch_stock.min_stock` default-value change (`0` → `8`). Read `migration.sql:2147-2426` in full before writing.

## Phase 2: `docs/features.md` staleness fixes

- [x] 2.1 Rewrote the sale-entry section (was: `sales-form.tsx` co-owning entry, no `/pos` mention). Read `src/components/pos/PosShell.tsx` in full; new section describes `/pos` (`ProductPicker`, `BarcodeWedgeListener`, `PosCart`, `StockWarningDialog` non-blocking oversell warning, `PosSubmitPanel`) as the primary entry surface for `caja`/`employee`/`encargado`, and `SaleModal.tsx` as the correction/edit tool (`HistoryView`/`MySalesView`) plus an admin back-office alternative for new sales.
- [x] 2.2 Removed the false "Desglose por Medio de Pago" claim. Read `src/components/admin/KpiCards.tsx` in full — confirmed it only renders `dailyIncome` (with a show/hide toggle) and `dailySalesCount`, with the average ticket size computed inline inside the sales-count card. Replaced the claim with an accurate description.
- [x] 2.3 Added a new "Analítica de Tienda (`/analytics`)" section: read `src/components/analytics/AnalyticsShell.tsx` and its 5 panel components (`ProductRankingPanel`, `BranchComparisonPanel`, `LowStockPanel`, `SalesTrendPanel`, `CategoryComparisonPanel`) to confirm the best/worst-seller toggle + unit/revenue/margin metric selector, branch comparison, low-stock alerts (`min_stock`), sales trend, category comparison, PDF export (`generateAnalyticsReportPdf`), `admin`+`encargado`-only gating, and the 30-day default period (`PeriodSelector`).

## Phase 3: Lint debt (19 problems → 0)

- [x] 3.1 Re-ran `npm run lint` before editing to confirm exact line numbers were unchanged from `state.yaml`'s `key_findings.build_lint_reverified` — confirmed identical (19 problems, 12 errors, 7 warnings, same files/lines).
- [x] 3.2 Silenced 9 `react-hooks/set-state-in-effect` errors with a scoped `// eslint-disable-next-line react-hooks/set-state-in-effect -- <reason>` comment at each site, matching the exact convention already used in `CashSessionPanel.tsx`/`CashSessionHistoryView.tsx`/`AnalyticsShell.tsx`:
  - `src/app/admin/page.tsx:83` and `src/app/encargado/page.tsx:61` — sync `activeSection` from a URL query param on mount.
  - `src/components/admin/ProductImportDialog.tsx:201` — initial branch fetch when the dialog opens.
  - `src/components/employee/MySalesView.tsx:151` — initial fetch on mount.
  - `src/components/employee/StockAdjustmentView.tsx:154` — initial fetch on mount.
  - `src/components/employee/employee-dashboard.tsx:54` — sync `activeSection` from a URL query param on mount.
  - `src/components/pos/ProductPicker.tsx:44` — reset highlighted index on query change.
  - `src/components/shared/CashSessionStatusBadge.tsx:26` — a **second**, distinct disable comment in this file (the existing one at line 36/37 covers a different rule, `react-hooks/exhaustive-deps`, on the effect's own dependency array).
  - `src/components/stock/StockAdjustDialog.tsx:59` — reset form fields when the target product opens/switches.
- [x] 3.3 `src/components/employee/StockAdjustmentView.tsx:382` (2x `react/no-unescaped-entities`) — escaped the literal quote marks wrapping `{mov.note}` with `&ldquo;`/`&rdquo;` (opening/closing respectively).
- [x] 3.4 `src/lib/salesHelper.ts:243` (`@typescript-eslint/no-explicit-any`) — read `deleteSaleGroup`'s full body; replaced `supabase: any` with the codebase's established `type SupabaseClient = ReturnType<typeof createClient>` pattern (already used in `src/lib/analytics.ts`), imported as a type-only import.
- [x] 3.5 `src/components/employee/MySalesView.tsx:148` (`react-hooks/exhaustive-deps`, missing `toast`) — read `src/components/ui/toast.tsx`'s `useToast()`: `toast` is `useCallback`-memoized with a stable `[dismiss]` dependency, and `dismiss` itself is memoized with `[]` — confirmed referentially stable across renders. Added `toast` to `loadMySales`'s `useCallback` deps array (safe, no loop risk).
- [x] 3.6 `src/components/pos/PosShell.tsx:29` (unused `homeFor` import) — removed; kept the `type Role` import.
- [x] 3.7 `src/components/pos/PosShell.tsx:118,137,170` (missing `supabase` dep x3) — read `src/utils/supabase/client.ts`: `createClient()` calls `createBrowserClient(...)` directly with no module-level singleton, so it returns a **new** client instance on every call/render. Adding `supabase` to these effects' deps arrays would re-run the fetch on every render. Added a scoped `eslint-disable-next-line react-hooks/exhaustive-deps` comment at each of the 3 sites explaining the intentional omission, matching `StockAdjustDialog.tsx`'s existing convention of documenting why a dep is deliberately excluded.
- [x] 3.8 `src/components/admin/StockView.tsx:97` (unused `AdjustReason` type import — actually a locally-declared, never-referenced type alias) — removed.
- [x] 3.9 `src/components/employee/MySalesView.tsx:18` (unused `Calendar` icon import) — removed.
- [x] 3.10 `npm run lint` → `0 problems`. Confirmed no new lint errors introduced.
- [x] 3.11 `npm run build` → passes clean, 0 TypeScript errors, all 13 routes (including `/pos` and `/analytics`) generate successfully. Build behavior unchanged, as expected for a lint/docs-only patch.

## Phase 4: Closing the deferred production debt (2026-08-30, user-requested)

The user asked to close out the two production-touching items originally deferred above. Both are now resolved — see `state.yaml`'s `fork_3_security_definer_revoke` and `fk_cascade_resolution` for full detail.

- [x] 4.1 `migration.sql` §21.1: `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated` for `delete_employee_user(uuid)`, `update_employee_user(uuid,text,text,uuid,text)`, `preload_employee(text,text,text,uuid,uuid)` — exact live signatures confirmed by tracing `DROP FUNCTION`/`CREATE FUNCTION` history in `migration.sql` first, not assumed. Applied via `apply_migration` (`revoke_execute_employee_management_rpcs`).
- [x] 4.2 [VERIFY] `get_advisors(security)`: all three functions dropped out of the `anon_security_definer_function_executable` list (8 → 5 entries in that category); still correctly listed under `authenticated_security_definer_function_executable` (the intentional `GRANT`).
- [x] 4.3 `migration.sql` §21.2: `stock_movements_store_id_branch_id_fkey` and `cash_movements_store_id_branch_id_fkey` changed from `ON DELETE CASCADE` to `ON DELETE RESTRICT` — exact constraint names queried from production's `pg_constraint` first, not guessed. `branch_stock`/`cash_sessions`/`profiles`/`sales` deliberately left untouched (only the two tables documented as immutable append-only audit ledgers needed protection). Applied via `apply_migration` (`protect_audit_ledgers_from_branch_cascade`).
- [x] 4.4 [VERIFY] Read `pg_constraint` directly in production: both constraints confirmed `ON DELETE RESTRICT`.
- The `get_current_user_*`/`handle_new_user`/`rls_auto_enable` helpers remain un-revoked, deliberately — read-only/no-arg functions with lower risk, not part of the user's "3 funciones RPC" request.

## Still outstanding — requires the user's own browser session, cannot be done by the orchestrator

- [ ] **pos-ui T6.7 (12-item live E2E checklist)**: barcode scan-to-add, unknown-barcode toast, name search add, unlisted-product add, inline qty/price edit, oversell → stock warning → confirm → stock clamp, split payment across two `sales` rows sharing one `Ref:`, receipt modal output, encargado flow parity, DB-level `product_id` non-null check. Never run end-to-end since `/pos` first shipped.
- [ ] **analytics `[VERIFY]` items** (`analytics/tasks.md` 1.11, 1.12, 3.7, 4.10-4.13, 5.4, 7.15): admin branch-switch KPI recompute, `EmployeeReport` role-consistent scoping, `/analytics` role redirects for `caja`/`stock`/`employee`, per-panel branch-filtering, low-stock panel regression with the new `min_stock = 8` default, PDF export content parity. The SQL-level RLS impersonation tests (2.10, 6.2, 7.16) were already run live against production and should NOT be re-run — only the browser-dependent UI behavior remains unverified.

These require a real authenticated Google OAuth session per role (admin/encargado/caja) — the orchestrator has no login credentials and cannot perform them; this is the user's own testing to do.

## Status

15/15 in-scope docs+lint tasks complete (Phases 1-3), plus 4/4 follow-up production-debt tasks complete (Phase 4). Only the browser-dependent manual verification items remain, and they are not something the orchestrator can close. Ready for `sdd-verify` once the user completes (or explicitly waives) that manual pass.
