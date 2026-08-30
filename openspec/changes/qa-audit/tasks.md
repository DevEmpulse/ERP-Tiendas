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

## Explicitly deferred (tracked debt, not touched this phase)

Per the user's explicit scope narrowing (zero production/runtime risk this pass) and `state.yaml`'s `open_forks_for_propose`:

- [ ] **`fork_3_security_definer_revoke`**: `delete_employee_user`, `update_employee_user`, `preload_employee`, and the three `get_current_user_*` helpers have no explicit `REVOKE EXECUTE ... FROM PUBLIC, anon` (unlike `close_cash_session` and every stock-phase2/analytics-era function). No confirmed exploit — internal `auth.uid()` checks fail closed for `anon` — but it is undocumented drift against this codebase's own established pattern. Deferred to a dedicated future security-hardening pass; requires the same live-impersonation-test discipline as every prior schema phase.
- [ ] **`fk_cascade_inconsistency`**: `profiles.branch_id`/`sales.branch_id` reference `branches(id)` with no `ON DELETE` clause (defaults to `NO ACTION`), while `branch_stock`/`stock_movements`/`cash_sessions`/`cash_movements` all `CASCADE` against `branches (store_id, id)`. Dormant risk only — zero code path hard-deletes a branch today (soft-delete via `is_active` only). Would matter only if a future feature added real branch deletion.
- [ ] **`manual_verification_debt` — pos-ui T6.7 (12-item live E2E checklist)**: barcode scan-to-add, unknown-barcode toast, name search add, unlisted-product add, inline qty/price edit, oversell → stock warning → confirm → stock clamp, split payment across two `sales` rows sharing one `Ref:`, receipt modal output, encargado flow parity, DB-level `product_id` non-null check. Never run end-to-end since `/pos` first shipped; requires a live authenticated browser session with an actual/simulated barcode scanner — out of reach for this phase's apply sub-agent.
- [ ] **`manual_verification_debt` — analytics `[VERIFY]` items** (`analytics/tasks.md` 1.11, 1.12, 3.7, 4.10-4.13, 5.4, 7.15): admin branch-switch KPI recompute, `EmployeeReport` role-consistent scoping, `/analytics` role redirects for `caja`/`stock`/`employee`, per-panel branch-filtering (admin sees all + encargado own-branch-only), low-stock panel regression with the new `min_stock = 8` default, PDF export content parity. Correctly tagged `[VERIFY][ORCHESTRATOR]`/`[ORCHESTRATOR/USER]` in their source file; the SQL-level RLS impersonation tests (2.10, 6.2, 7.16) were already run live against production and should NOT be re-run.
- Not touched at all this phase (explicitly out of scope per the user's instruction): `migration.sql` — no `REVOKE EXECUTE` additions, no `ON DELETE` changes, no Supabase/RLS/production data mutation of any kind.

## Status

15/15 in-scope tasks complete (Phases 1-3). 4 items explicitly deferred as tracked debt (not part of this phase's scope). Ready for `sdd-verify`.
