## Exploration: analytics (P7)

### Current State

There is no dedicated analytics/reporting module. "Reporting" today is scattered across ad-hoc components that each fetch a full row set client-side and aggregate it in JS/memory — none of them were built with cross-branch, cross-product, or cross-session trend questions in mind, because branches (store-branches), `sale_items.product_id`, `branch_stock`/`stock_movements`, and `cash_sessions` did not exist yet when they were written.

**Dashboard is unconditionally store-wide, despite a branch selector already existing in the header.**
- `src/app/admin/page.tsx:171-194` fetches ALL of the store's `sales` (and joined `sale_items`) with no `.eq('branch_id', ...)` filter, regardless of `selectedBranchId`.
- `localTodayStats()` (`src/app/admin/page.tsx:318-357`) computes `dailyIncome`/`dailySalesCount`/`previousIncome` from that unfiltered set.
- The header branch `<Select>` (`src/app/admin/page.tsx:533-552`) exists and is wired to `StockView`/`CashSessionPanel`/`CashSessionHistoryView` (lines 403-427), but `DashboardView`/`HistoryView` receive `branchId` only as a pass-through prop used exclusively to attribute a *new* sale created from `SaleModal` (`SalesTable.tsx:435`, `SalesHistory.tsx:433`) — never to filter the displayed KPIs or sales list. An admin switching branches in the header sees zero change in Dashboard/History numbers. This is a genuine, surprising gap: the affordance to filter by branch already exists in the UI chrome, so users will expect it to work here and won't get why it doesn't.
- `KpiCards.tsx` (`src/components/admin/KpiCards.tsx`) shows exactly two metrics: `dailyIncome` (with a show/hide toggle, `useState` + `localStorage('showIncome')`, lines 19-31) and `dailySalesCount` with an average-ticket-size derived line (line 213). No payment-method breakdown, despite `docs/features.md:89` claiming one exists ("Desglose por Medio de Pago") — no such breakdown was found in `KpiCards.tsx` or `DashboardView.tsx`; the docs entry appears stale/aspirational relative to the actual component. `previousIncome` prop exists but is accepted and destructured, then never rendered anywhere in `KpiCards.tsx` (the trend/comparison badge only says static "Hoy") — day-over-day comparison is computed but silently discarded in the UI.

**Employee report is stale relative to the granular-roles phase and inconsistent under RLS for encargado.**
- `EmployeeReport.tsx:67-70` fetches ALL `profiles` in the store with no branch filter, but `EmployeeReport.tsx:75-79` fetches `sales` with no branch filter either — relying entirely on RLS to scope the result. Per `docs/database.md:250`, sales SELECT RLS for `encargado` is "toda su sucursal" (branch-scoped), while profiles SELECT RLS (`docs/database.md:246`) is store-wide (`store_id = get_current_user_store_id()`). Net effect: when an `encargado` opens this report (reachable via `EmployeesView.tsx:3,21` under both `/admin` and `/encargado`, confirmed in `src/app/encargado/page.tsx:346-347`), they see every employee in the *entire store* but sales data scoped to only *their own branch* — employees from other branches will always show `$0` / `0 ventas` / `0%`, which reads as "this person sold nothing" rather than "not visible to you." This is actively misleading, not just an absent feature.
- `EmployeeReport.tsx:105` filter — `p.role === 'employee' || salesByEmp[p.id]?.count > 0` — predates the 4-role model (P5: admin/encargado/caja/stock/employee). It still hardcodes `'employee'` as the only role unconditionally shown; `caja`/`stock`/`encargado` staff (the actual day-to-day POS operators post-P5) only appear if they happen to have sales in the selected period.
- Filter granularity is `day` or `month` only (`EmployeeReport.tsx:20`) — no week option, no custom range, no week-over-week/month-over-month comparison.

**Cash session history has zero cross-session aggregation.**
- `CashSessionHistoryView.tsx:61-109` loads a flat, reverse-chronological list of individual `cash_sessions` rows. Each row shows its own `discrepancy` (green if over, red if short — lines 230-231, 263-265), but nothing aggregates across sessions: no total/average discrepancy over a date range, no per-cashier accuracy ranking, no per-branch comparison beyond an optional `branch_name` column shown only when `!branchId` (line 189, 249-251).
- "Efectivo sin caja" (`loadUnattributed`, lines 112-138) is a same-day-only snapshot (`todayMidnight` hardcoded, line 115-116) — no historical view over time.

**Stock movement history is raw, per-product, per-branch, capped at 50 rows — no aggregation, no alerts.**
- `StockView.tsx:411-431` (`openHistoryDialog`) queries `stock_movements` filtered to exactly one `(branch_id, product_id)` pair, `.limit(50)`, ordered by `created_at desc`. No cross-product view, no stock velocity/turnover calculation, no shrinkage analysis, no aggregation of movement reasons.
- `branch_stock.min_stock` already exists as a column and is explicitly documented as reserved for a future phase: `docs/database.md:101` — "Columna reservada para alertas de stock mínimo (sin comportamiento en esta fase; **Fase 7**)." Low-stock/reorder-point alerting is schema that was deliberately pre-built for this exact phase and currently does nothing.

**Product-level analytics is fully greenfield.**
- A repo-wide grep for best-seller/ranking/margin logic returned zero functional matches. Despite `sale_items.product_id` now resolving to real products (P1), nothing ranks products by units sold, revenue, or margin (`sale_price - purchase_price`, both already columns on `products`). This is the single largest genuinely new capability this phase would add.

**Role-based access is currently binary: admin/encargado full dashboard, everyone else zero.**
- `canAccess()` (`src/lib/roles.ts:36-45`): `/admin` is admin-only, `/encargado` is encargado-only; `caja`/`stock`/`employee` all resolve to `/employee` (`homeFor`, lines 29-34).
- A grep for `KpiCards|DashboardView|EmployeeReport|dailyIncome` under `src/app/employee/` returned no matches — `caja`/`stock`/`employee` roles see zero aggregate/KPI data today.

**Export tooling already exists and is proven, no new dependency required for exports.**
- `src/lib/pdfGenerator.ts` exports `generateSalesReportPdf` (used by `DashboardView.tsx:50-56`) and `generateReceiptPdf`, via `jspdf`/`jspdf-autotable` (already a dependency).
- `write-excel-file`/`read-excel-file` already power catalog import/export — reusable for analytics Excel export with zero new dependencies.

**No charting library exists.** `package.json` has no `recharts`, `chart.js`, `victory`, `d3`, `apexcharts`, or `nivo`. Any visual chart requires a new dependency decision.

### Affected Areas

- `src/app/admin/page.tsx` — sales query (171-194) and `localTodayStats()` (318-357): root cause of the "Dashboard ignores branch selector" gap; likely needs to move from fetch-all-then-aggregate-in-JS to server-side aggregation.
- `src/app/encargado/page.tsx` — mirrors the same store-wide fetch, reuses `DashboardView`.
- `src/components/admin/KpiCards.tsx` — sole current KPI surface; `previousIncome` already threaded through but unused.
- `src/components/admin/EmployeeReport.tsx` — stale role filter (line 105) and RLS-inconsistent profiles/sales scoping (lines 67-79).
- `src/components/shared/CashSessionHistoryView.tsx` — natural extension point for discrepancy-trend analytics.
- `src/components/admin/StockView.tsx` (404-431) — natural extension point for stock velocity/turnover; `min_stock` is the direct hook for low-stock alerting.
- `src/lib/pdfGenerator.ts`, `write-excel-file`/`read-excel-file` — reusable export path.
- `src/lib/roles.ts` (`canAccess`, `homeFor`) — any new route needs a role-gating decision.
- `migration.sql` — new aggregation likely needs new SQL views or `SECURITY DEFINER` RPCs (following `adjust_branch_stock`/`close_cash_session` precedent) rather than raw client-side joins, given growing row counts.
- `package.json` — a charting library is a new, explicit dependency decision.

### Approaches

1. **New dedicated `/analytics` route/section with server-side aggregation (views/RPCs)** — new sidebar section backed by new Postgres views/RPCs pre-aggregating revenue-by-branch, product rankings, stock velocity, cash discrepancy trends.
   - Pros: keeps existing Dashboard/History/EmployeeReport/CashSessionHistoryView untouched (lower regression risk); server-side aggregation scales; clean place to fix the branch-filter gap without touching live dashboards.
   - Cons: most work; new SQL needs careful RLS review; needs role-gating/route decision.
   - Effort: High.

2. **Enrich existing DashboardView/HistoryView/EmployeeReport/CashSessionHistoryView in place.**
   - Pros: fixes concrete cited bugs (branch-filter gap, EmployeeReport's misleading zeros, unused `previousIncome`) without new navigation; ships incrementally.
   - Cons: no coherent "analytics" home for product ranking/stock velocity; touches live, high-traffic, realtime-subscribed components (`src/app/admin/page.tsx:264-316`), raising regression risk; doesn't fix the scaling concern.
   - Effort: Medium, but risk-concentrated on live surfaces.

3. **Hybrid**: fix the cited concrete bugs/gaps in place first (branch filter on Dashboard, EmployeeReport role/branch consistency — cheap, low-risk), then build a genuinely new `/analytics` route for the greenfield capabilities (product ranking/margin, stock velocity/low-stock alerts, cash discrepancy trends, period comparison), backed by new server-side aggregation.
   - Pros: separates "fix what's broken" from "build what's new"; easier to review/ship as smaller PRs; still gets the scalability benefit for new work.
   - Cons: two work streams to sequence.
   - Effort: Medium-High, decomposable into safely stackable PRs.

### Recommendation

Approach 3 (hybrid). The branch-filter gap and `EmployeeReport` inconsistency are real, low-risk bugfixes independent of "analytics v1" scope. The genuinely new capabilities have no existing home and are best served by new server-side aggregation rather than more client-side `.reduce()` over ever-growing tables — the current fetch-all pattern is already a scalability liability and P7 is the natural point to stop extending it.

### Risks

- **RLS correctness for new aggregation views/RPCs** — highest risk; must replicate exact per-role, per-branch scoping already in `sales`/`sale_items`/`stock_movements`/`cash_sessions` RLS, or leak cross-branch data. The `EmployeeReport` precedent shows this exact bug class already happening once.
- **Performance** — no indexes verified for time-range/branch/product aggregation queries (no Supabase MCP access this phase); check against `migration.sql` indexes before implementation.
- **Chart library choice** — first-ever charting dependency; needs explicit sign-off, not an implicit default.
- **Real-time vs. batch aggregation** — `DashboardView` has a live realtime subscription today; deciding whether analytics KPIs must also update live is a materially different (costlier) design.
- **Scope creep** — touches five subsystems (sales/branches, stock, cash, roles, catalog); will likely exceed the 400-line PR review budget; plan chained/stacked PR slices from the start.
- **`docs/features.md:89` claims a payment-method breakdown exists** that was not found in code — either stale docs or a missed component; verify before `sdd-propose` treats it as shipped.

### Open Forks for Proposal

1. New dedicated `/analytics` route (own sidebar section) vs. folding analytics into existing views vs. the hybrid split recommended above.
2. Must-have v1 metrics vs. deferred: product ranking, branch comparison, low-stock alerts (`min_stock`), cash discrepancy trends — all v1, or split across sub-phases?
3. Real-time (like today's Dashboard) vs. batch/cached aggregation.
4. Chart library adoption: yes/no, and which one.
5. Export scope: in-app only, or also PDF/Excel reusing existing tooling.
6. Role visibility: admin + encargado only, or a restricted view for `caja`/`stock` too?
7. Bundle the `EmployeeReport`/branch-filter bugfixes into this change, or ship as a separate, smaller change first?
8. Margin analysis (`sale_price - purchase_price`): v1 metric or defer?

### Ready for Proposal

Yes. Current-state gaps are concretely evidenced with file:line citations, the available data model is fully mapped, and every real product fork is surfaced above.
