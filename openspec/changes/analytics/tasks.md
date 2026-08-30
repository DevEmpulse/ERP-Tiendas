# Tasks: Store Analytics (P7)

> Size note: this artifact exceeds the generic 530-word tasks budget, matching
> the precedent set by `cash-register`/`pos-ui`/`stock-phase2` tasks.md — the
> design's exact SQL sections, file-by-file line estimates, and per-scenario
> verification steps are preserved literally rather than compressed.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1,405 total (Slice 1 ~85 / Slice 2 ~180 / Slice 3 ~1,140) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 3 slices per design §Migration/Rollout — Slice 1 → Slice 2 → Slice 3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — orchestrator asks the user before apply |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Bugfix A + Bugfix B + `SALES_REPORT_ROLES` | PR 1 | `npm run build` | Admin/encargado manual branch-switch + EmployeeReport pass | Revert `admin/page.tsx` bugfix diff + `EmployeeReport.tsx` + `roles.ts` constant; independently revertible |
| 2 | `migration.sql` §18 + `src/lib/analytics.ts` | PR 2 (needs Phase 0 probe) | N/A (`test_command: ""`) — `execute_sql`/`get_advisors` probes | Production DB (standing convention), live `encargado` impersonation | §18.7 rollback block, bottom-to-top; no table/column/row touched |
| 3 | `/analytics` route + gating + 4 panels + PDF export | PR 3 (needs PR 2 verified) | `npm run build` | Manual E2E per spec scenario, both roles | Revert route, `sidebar-items.ts`/`proxy.ts`/`roles.ts` gating arms, `pdfGenerator.ts` addition |

## Phase 0: Pre-Apply Probe

Orchestrator only — Supabase MCP access is required and apply sub-agents have
none in this environment.

- [x] 0.1 [ORCHESTRATOR] Baseline row counts: 1 sale, 1 sale_item, 2 cash_sessions (1 closed), 3 active branches, 4 profiles.
- [x] 0.2 [ORCHESTRATOR] `SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('sales','sale_items','cash_sessions')`. **Corrected design's claim**: `sales` already had `idx_sales_store_created (store_id, created_at DESC)` and `idx_sales_employee_id` in production — schema drift not reflected in `migration.sql`. Only `sales_branch_created_idx` (branch_id, created_at DESC) was actually missing; the design's planned `sales_store_created_idx` would have been a redundant duplicate of `idx_sales_store_created`, so it was dropped from §18.1 before applying (migration.sql and this apply updated to match).

## Phase 1: Bugfixes (Slice 1 / PR 1) — independent of Phase 0/2, may run in parallel

- [x] 1.1 `src/lib/roles.ts`: add `SALES_REPORT_ROLES = ['encargado', 'caja', 'employee'] as const`.
- [x] 1.2 `src/app/admin/page.tsx` Bugfix A: add `branchesLoaded` state; set `true` in the `finally` of effect #3 `loadBranches` (~:226-250).
- [x] 1.3 `admin/page.tsx`: effect #2 (~:163-220) guards `!userProfile?.store_id || !branchesLoaded`; build query as a variable, apply `if (selectedBranchId) query = query.eq('branch_id', selectedBranchId)` before `.order('created_at', ...)`; deps gain `selectedBranchId, branchesLoaded`.
- [x] 1.4 `admin/page.tsx`: realtime effect (~:264-316) → channel `realtime-sales-branch-${selectedBranchId}`, filter `branch_id=eq.${selectedBranchId}`, early-return when `!selectedBranchId`, deps gain `selectedBranchId`.
- [x] 1.5 Confirm `localTodayStats()` (~:319-355) is left byte-for-byte unchanged; `HistoryView` (~:382) is fixed for free by the now branch-filtered `sales` array.
- [x] 1.6 `src/components/admin/EmployeeReport.tsx` Bugfix B: add step 0 in `fetchPerformance()` reading the caller's own `role, branch_id` via `profiles` (`.eq('id', auth user id).single()`).
- [x] 1.7 `EmployeeReport.tsx`: scoping fix (~:67-70) — add `.eq('branch_id', callerBranchId)` to the `profiles` query when caller is not `admin`/`superadmin`.
- [x] 1.8 `EmployeeReport.tsx`: role filter (~:105) — replace `p.role === 'employee'` with `SALES_REPORT_ROLES.includes(p.role ?? '') || salesByEmp[p.id]?.count > 0`.
- [x] 1.9 `EmployeeReport.tsx`: relabel `Participación de tienda` (~:278) to `Participación de sucursal` when the caller is branch-scoped.
- [x] 1.10 `npm run build` passes.
- [ ] 1.11 [VERIFY] [ORCHESTRATOR] Manual: admin on Dashboard with branch X selected switches to branch Y → KPIs recompute for Y; History list shows only Y's sales (spec: *Switching branch changes Dashboard/History*). Requires a live session against real data — apply sub-agent has no Supabase/browser access.
- [ ] 1.12 [VERIFY] [ORCHESTRATOR] Manual: as encargado, other-branch employee is absent (never `$0`); as admin, `caja`/`encargado` sellers are listed (spec: *Employee Report Role-Consistent Scoping*). Same live-session constraint as 1.11.

## Phase 2: SQL + `analytics.ts` (Slice 2 / PR 2) — after Phase 0; must exist before any UI ships

- [x] 2.1 Append `migration.sql` §18.1: `sales_branch_created_idx`, `sale_items_branch_id_idx`, partial `cash_sessions_branch_closed_idx WHERE status='closed'`. (`sales_store_created_idx` dropped per 0.2 — redundant with pre-existing `idx_sales_store_created`.)
- [x] 2.2 §18.2: `CREATE VIEW public.analytics_low_stock WITH (security_invoker = true)` over `branch_stock`/`products`/`branches`, `WHERE min_stock > 0 AND current_stock <= min_stock AND is_active`.
- [x] 2.3 §18.3: `analytics_product_ranking(p_from, p_to, p_branch_id)` — `SECURITY INVOKER STABLE`, excludes legacy `product_id IS NULL` lines, returns units/revenue/`margin_estimated`/`margin_realized`.
- [x] 2.4 §18.4: `analytics_branch_comparison(p_from, p_to)` — the one function that re-derives scoping by hand with the explicit `role IN ('admin','superadmin') OR b.id = get_current_user_branch_id()` predicate (driving `FROM branches`, which is store-wide readable).
- [x] 2.5 §18.5: `analytics_cash_discrepancy(p_from, p_to, p_branch_id)` — one row per closed `cash_sessions` row, joined to `branches`/`profiles`.
- [x] 2.6 §18.6: grants/revokes — `authenticated` gets SELECT/EXECUTE, `anon`/`PUBLIC` revoked, per §17.7 precedent.
- [x] 2.7 §18.7: commented rollback block, bottom-to-top (functions → view → indexes); no table/column/row touched either direction.
- [x] 2.8 [VERIFY] [ORCHESTRATOR] Applied §18 to production via `apply_migration` (migration `store_analytics_readonly_aggregation`), with the `sales_store_created_idx` correction from 0.2/2.1. `success: true`.
- [x] 2.9 [VERIFY] [ORCHESTRATOR] `SELECT reloptions FROM pg_class WHERE relname = 'analytics_low_stock';` → `["security_invoker=true"]`. Confirmed.
- [x] 2.10 [VERIFY] [ORCHESTRATOR] Live `encargado` impersonation (real profile `a26a8f59…`, store `6eebfb72…`) via `SET LOCAL ROLE authenticated` + `request.jwt.claims`, each in its own `BEGIN...ROLLBACK` transaction:
  - Temporarily set the store's second, normally-inactive branch ("Sucursal Tucuman") `is_active = true` **inside the same transaction, uncommitted** (rolled back at the end — production `is_active` reconfirmed `false` afterward) to actually exercise the "hide sibling branch" path, since the encargado's store has only 1 real active branch.
  - `analytics_branch_comparison` as encargado → **exactly 1 row** (their own "Sucursal Principal"), despite 2 active branches existing — confirms the hand-derived predicate works.
  - `analytics_branch_comparison` as `admin` (same store, same temp state) → **2 rows** (both branches) — positive control, proves the encargado result isn't just "always 1 row" by accident.
  - `analytics_product_ranking` / `analytics_low_stock` as encargado → both `[]` (no matching data in this sparse production dataset) — no leak, though not a strong positive test given emptiness.
  - `analytics_cash_discrepancy` as encargado → **1 row**, the store's only closed session, correctly attributed to their own branch.
  - All zero non-own-branch rows confirmed. Highest-risk check passed.
- [x] 2.11 Create `src/lib/analytics.ts`: `AnalyticsPeriod`, `DEFAULT_PERIOD_DAYS = 30`, `ProductRankingRow`/`BranchComparisonRow`/`LowStockRow`/`CashDiscrepancyRow` interfaces.
- [x] 2.12 `src/lib/analytics.ts`: `fetchProductRanking`/`fetchBranchComparison`/`fetchLowStock`/`fetchCashDiscrepancy` typed wrapper functions over `supabase.rpc()`/`.from()`.
- [x] 2.13 `npm run build` passes (RPC row types type-check). Note: type-checks the wrapper functions' TS shape only — cannot confirm the RPCs exist/match in production until 2.8 runs.

## Phase 3: Route Gating (part of Slice 3 / PR 3) — after Phase 2 verified

- [x] 3.1 `src/lib/roles.ts`: add `ANALYTICS_ROLES = ['admin', 'encargado'] as const`; `canAccess()` arm `if (prefix.startsWith('/analytics')) return ANALYTICS_ROLES.includes(role)`.
- [x] 3.2 `src/proxy.ts`: new §11 access block for `/analytics` mirroring §10 `/pos` (~:130-139).
- [x] 3.3 `src/components/admin/sidebar-items.ts`: add `'analytics'` to `AdminSection` + `ADMIN_MENU_ITEMS` (inherited by `ENCARGADO_MENU_ITEMS`, absent from `EMPLOYEE_MENU_ITEMS`).
- [x] 3.4 `src/app/admin/page.tsx`: `handleSetSection` `'analytics'` arm → `router.push('/analytics')`; `?section=` guard excludes `analytics`.
- [x] 3.5 `src/app/encargado/page.tsx`: same `handleSetSection` arm + `?section=` guard **only** — no Bugfix A here (Deviation: live code already branch-filters at `:188`/`:232`).
- [x] 3.6 `npm run build` passes.
- [ ] 3.7 [VERIFY] [ORCHESTRATOR] Manual per role: `caja`/`stock`/`employee` navigating to `/analytics` are redirected by `proxy.ts`. Requires a live session — apply sub-agent has no browser/Supabase access.

## Phase 4: Analytics UI — bootstrap, shell, panels (Slice 3 / PR 3) — after Phase 3

- [x] 4.1 `npm install recharts` (v3, React 19 compatible). Installed via `pnpm add recharts` (this repo is pnpm-workspace-based, not npm — `npm install` errors out on the existing `pnpm-lock.yaml`/`node_modules` layout); resolved to recharts 3.10.1.
- [x] 4.2 Create `src/app/analytics/page.tsx`: auth + profile + branch bootstrap (mirrors `/pos`, ~:19-115).
- [x] 4.3 Create `src/components/analytics/PeriodSelector.tsx`: 7d / **30d default** / 90d presets.
- [x] 4.4 Create `src/components/analytics/AnalyticsShell.tsx`: header, branch selector (admin) / branch badge (encargado), PDF button, panel layout, refresh.
- [x] 4.5 Create `src/components/analytics/ProductRankingPanel.tsx`: horizontal `BarChart` top-10 + units/revenue/margin toggle + table.
- [x] 4.6 Create `src/components/analytics/BranchComparisonPanel.tsx`: grouped `BarChart`; degenerates to KPI cards on a single row (encargado).
- [x] 4.7 Create `src/components/analytics/LowStockPanel.tsx`: table + deficit badge, no chart.
- [x] 4.8 Create `src/components/analytics/CashDiscrepancyPanel.tsx`: `LineChart` over `closed_at`, one series per branch, plus per-cashier rollup table.
- [x] 4.9 `npm run build` passes (Recharts v3 + React 19 type-check).
- [ ] 4.10 [VERIFY] [ORCHESTRATOR] Admin selects branch X in the filter → every panel recomputes for X only (spec: *Admin narrows to one branch*). Requires 2.8/2.10 (live SQL) first, then a live session.
- [ ] 4.11 [VERIFY] [ORCHESTRATOR] Encargado opens `/analytics` → all panels show their own branch only, consistent with 2.10's live check (spec: *Encargado sees only their own branch*). Same live-session constraint.
- [ ] 4.12 [VERIFY] [ORCHESTRATOR] Low-stock panel lists only rows with `min_stock > 0` (regression: set one `min_stock` via `adjust_branch_stock`). Same live-session constraint.
- [ ] 4.13 [VERIFY] [ORCHESTRATOR] Refresh/reopen `/analytics` recomputes metrics with no realtime push (spec: *On-Demand Recomputation*). Same live-session constraint.

## Phase 5: PDF Export (Slice 3 / PR 3) — after Phase 4

- [x] 5.1 `src/lib/pdfGenerator.ts`: add `generateAnalyticsReportPdf()` — header block, 4-column summary card (revenue/transactions/margin/low-stock count), 4 `autoTable` sections chained off `lastAutoTable.finalY`, mirroring `generateSalesReportPdf`.
- [x] 5.2 Wire the PDF export button in `AnalyticsShell.tsx` to `generateAnalyticsReportPdf()` with the currently displayed panel data.
- [x] 5.3 `npm run build` passes.
- [ ] 5.4 [VERIFY] [ORCHESTRATOR] Trigger PDF export from a rendered panel → PDF reflects the currently displayed metrics (tables only, no chart rasterization, per Deviation #7). Requires live data (2.8) and a browser session.

## Phase 6: Final Verification

- [x] 6.1 Full `npm run build` pass across all phases. Confirmed clean (0 TypeScript errors) after every phase's edits, including the final combined build. `npm run lint` was also run: pre-existing lint errors unrelated to this change exist elsewhere in the repo (e.g. `react-hooks/set-state-in-effect` in `MySalesView.tsx`, `StockAdjustmentView.tsx`, `employee-dashboard.tsx`, `ProductPicker.tsx`, `CashSessionStatusBadge.tsx`, `StockAdjustDialog.tsx`, an `any` in `salesHelper.ts`); none of the newly created/modified analytics files introduce new lint errors, confirmed by diffing lint output against the new file set.
- [x] 6.2 [VERIFY] [ORCHESTRATOR] `get_advisors(security)` — all findings are pre-existing (SECURITY DEFINER RPC warnings already present for `close_cash_session`, `preload_employee`, etc., plus the standing leaked-password-protection warning). No new finding class from §18's view/functions.

## Phase 7: User Feedback Follow-up (post-apply patch, 2026-08-30)

Applied directly against the already-shipped P7 analytics feature after live
user testing. No new phases/spec/design cycle — scope was fully resolved by
the user before apply. `migration.sql` §19 was written but NOT applied to
production; that remains the orchestrator's responsibility (no Supabase MCP
access in this environment), same limitation as §18 in Phase 2/0.

- [x] 7.1 `src/components/stock/StockAdjustDialog.tsx`: add `minStock?: number` prop, a `minStockInput` state field initialized from it, and a new "Stock mínimo" numeric input, independent of the existing `adjustDelta` quantity field.
- [x] 7.2 `StockAdjustDialog.tsx`: `handleAdjustSubmit` now allows an empty delta (only required if min_stock is unchanged too); conditionally calls `adjust_branch_stock` RPC when delta is present, and conditionally issues `supabase.from('branch_stock').update({ min_stock })` when the min_stock value changed from the prop it was initialized with. No new RPC/migration needed — RLS on `branch_stock` already permits this per-branch update for any role that can reach the Stock screen.
- [x] 7.3 `src/components/admin/StockView.tsx`: add `branchMinStock` state map, fetch `min_stock` alongside `current_stock` from `branch_stock` in both the `loadProducts` callback and the mount effect, and thread it into `StockAdjustDialog` as the new `minStock` prop.
- [x] 7.4 Delete `src/components/analytics/CashDiscrepancyPanel.tsx` entirely (removed per user feedback — panel provided low value).
- [x] 7.5 `src/lib/analytics.ts`: remove `CashDiscrepancyRow`/`fetchCashDiscrepancy` (dead code, nothing else referenced them); add `SalesTrendRow`/`fetchSalesTrend` and `CategoryComparisonRow`/`fetchCategoryComparison` typed wrappers over the new §19 RPCs.
- [x] 7.6 `src/components/analytics/AnalyticsShell.tsx`: remove `CashDiscrepancyPanel` import/state/fetch/render; add `salesTrend`/`categoryRows` state, add `fetchSalesTrend`/`fetchCategoryComparison` to the `Promise.all` in `refresh()`, render `<SalesTrendPanel>`/`<CategoryComparisonPanel>` in the panel grid, and update `handleExportPdf`'s `generateAnalyticsReportPdf()` call (`cash` → `salesTrend`/`categories`).
- [x] 7.7 Create `src/components/analytics/SalesTrendPanel.tsx`: Recharts `LineChart` of daily revenue (sparse days only, no zero-fill), Card/Skeleton/empty-state conventions matching existing panels.
- [x] 7.8 Create `src/components/analytics/CategoryComparisonPanel.tsx`: horizontal `BarChart` of revenue by category (mirrors `ProductRankingPanel`'s style) plus a category/units/revenue table below; `category_id` handled as nullable ("Sin categoría" bucket).
- [x] 7.9 `migration.sql` §19 (appended after §18, written but NOT applied): `analytics_sales_trend(p_from, p_to, p_branch_id)` driven from `sales` (RLS-inherited, no manual predicate) and `analytics_category_comparison(p_from, p_to, p_branch_id)` driven from `sale_items` LEFT JOIN `categories` (RLS-inherited via `sale_items`' Shape D policy, same reasoning as §18.3), both `SECURITY INVOKER STABLE`, with grants/revokes and rollback block per §17.7/§18.6 precedent.
- [x] 7.10 `src/lib/pdfGenerator.ts`: remove the "6. CASH DISCREPANCY TABLE" `autoTable` section and the `cash`/`CashDiscrepancyRow` param from `generateAnalyticsReportPdf()`/`GenerateAnalyticsPdfOptions`; add "Tendencia de Ventas" and "Comparación por Categorías" `autoTable` sections (`salesTrend`/`categories` params) following the same `cursorY`/`finalYOf()` chaining pattern; added a `formatDateOnly()` helper (manual `YYYY-MM-DD` parsing, avoids UTC-midnight-to-local-date off-by-one shift that `new Date(dateStr)` would introduce for date-only strings).
- [x] 7.11 `npm run build` (via `pnpm`) passes with 0 TypeScript errors, including the new `/analytics` static route.
- [x] 7.12 `grep -rn "CashDiscrepancyPanel\|fetchCashDiscrepancy\|CashDiscrepancyRow" src/` returns 0 results — confirmed fully removed, no orphaned references.
- [x] 7.13 `npm run lint` re-confirmed no new lint errors from this patch's files; all reported errors are pre-existing and untouched by this patch (`ProductImportDialog.tsx`, `MySalesView.tsx`, `StockAdjustmentView.tsx`, `employee-dashboard.tsx`, `ProductPicker.tsx`, `CashSessionStatusBadge.tsx`, `salesHelper.ts`), except `StockAdjustDialog.tsx`'s `react-hooks/set-state-in-effect`, which was already flagged pre-existing at task 6.1 before this patch touched that file.
- [x] 7.14 [VERIFY] [ORCHESTRATOR] Applied §19 to production via `apply_migration` (migration `store_analytics_sales_trend_category_comparison`). `success: true`.
- [ ] 7.15 [VERIFY] [ORCHESTRATOR/USER] Manual: set a product's `min_stock > 0` via the new Stock dialog field → Low Stock panel in `/analytics` picks it up once `current_stock <= min_stock`. Requires a live browser session — not yet done.
- [x] 7.16 [VERIFY] [ORCHESTRATOR] Live `encargado` impersonation (same real profile as 2.10) confirmed both new RPCs return only own-branch/own-store data with real production data (a genuine sale now exists): `analytics_sales_trend` → 1 row (2026-08-30, $119,900); `analytics_category_comparison` → 1 row ("Bazar_Hogar", $119,900, 4 units). Neither drives from the store-wide `branches` table, so no manual predicate was needed (per design's reasoning, confirmed correct in practice). `get_advisors(security)` re-run: no new finding class.
