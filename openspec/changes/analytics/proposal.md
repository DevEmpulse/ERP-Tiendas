# Proposal: Store Analytics (P7)

## Intent

Reporting is ad-hoc, client-side, and partly wrong. Dashboard ignores its own header branch selector (`src/app/admin/page.tsx:171-194`, `318-357`). `EmployeeReport` shows other-branch employees as `$0 / 0 ventas` because `profiles` RLS is store-wide while `sales` RLS is branch-wide for `encargado`. Product ranking, margin, branch comparison, low-stock alerts, and cash-discrepancy trends do not exist. Fix both defects and add `/analytics` on server-side aggregation instead of extending the fetch-all-then-`.reduce()` pattern.

## Scope

### In Scope

Two bugfixes + four new analytics domains, one change (forks 1, 7):

- **Bugfix A** — Dashboard/History honor `selectedBranchId`.
- **Bugfix B** — `EmployeeReport` scoping role-consistent, no misleading zeros; role filter covers the 4-role model, not hardcoded `'employee'`.
- **Product** — best/worst sellers by units and revenue; `sale_price - purchase_price` margin per product/period (fork 8).
- **Branch** — revenue, sales count, stock side by side.
- **Stock** — low-stock alerts. First functional consumer of `branch_stock.min_stock` (`docs/database.md:101`), inert since stock-phase2. Not a schema change; the column already exists.
- **Cash** — discrepancy trends over time by cashier and branch.
- `/analytics` route gated to `admin` + `encargado` (fork 6); Recharts (fork 4); PDF export via `pdfGenerator.ts` (fork 5).

### Out of Scope

- Realtime subscriptions — recompute on open/refresh (fork 3).
- `caja` / `stock` / `employee` analytics views.
- Excel export, stock velocity/turnover, shrinkage, custom date ranges.
- New tables or columns.

## Capabilities

### New Capabilities

- `store-analytics`: branch-scoped KPIs, product ranking and margin, branch comparison, low-stock alerts, cash-discrepancy trends, role gating, PDF export — plus the corrected behavior of both bugfixes.

### Modified Capabilities

- None. Existing specs (`product-catalog`, `sale-line-items`) state no requirement about dashboard branch scoping or employee reporting, so the bugfixes have no contract to delta; their corrected behavior is specified under `store-analytics`.

## Approach

Aggregate in Postgres via new read-only views/RPCs appended to `migration.sql` as a new numbered section, following the `close_cash_session` / `adjust_branch_stock` precedent, instead of client-side reduction over growing tables.

**Resolved by user**: `SECURITY INVOKER` for all new aggregation views/RPCs. Confirmed sufficient because `encargado` sees ONLY their own branch in `/analytics` — branch "comparison" degenerates to their own branch alone for that role, with no other-branch rows and no store-wide aggregate leaking through. No legitimate case here needs to bypass RLS.

**Default period**: last 30 days (rolling window), for ranking/margin/branch-comparison/discrepancy-trend views alike.

**Low-stock alerts**: live only inside the `/analytics` panel for this phase — no badge/indicator added to `StockView`. Can be promoted later if wanted.

Client: `/analytics` reusing the existing shell and header branch selector, Recharts charts, PDF export button.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `migration.sql` | New | Aggregation views/RPCs + RLS |
| `src/app/.../analytics` | New | Analytics surface |
| `src/app/admin/page.tsx` | Modified | Branch filter on sales query + `localTodayStats()` |
| `src/app/encargado/page.tsx` | Modified | Same fix |
| `src/components/admin/EmployeeReport.tsx` | Modified | Role-consistent scoping; 4-role filter |
| `src/lib/roles.ts` | Modified | Gate `/analytics` |
| `src/lib/pdfGenerator.ts` | Modified | Analytics report generator |
| `package.json` | Modified | Add `recharts` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| New views/RPCs leak cross-branch data to `encargado` | High | Highest risk here. Replicate the exact per-role/per-branch scoping in `sales` / `sale_items` / `stock_movements` / `cash_sessions` RLS; prefer `SECURITY INVOKER`; test as `encargado`. `EmployeeReport` proves this bug class already occurred. |
| Spans 5 subsystems, likely exceeds the 400-line review budget | High | Noted, no PR split here; delivery strategy is decided at the tasks review-workload gate as in prior phases. |
| Missing indexes for time-range/branch/product queries | Medium | Verify `migration.sql` indexes during design. |
| Bugfix A changes numbers admins see today | Medium | Intended correction; call out at verification. |
| Recharts is the first charting dependency | Low | Explicitly approved; Shadcn-standard pairing. |
| `docs/features.md:89` claims an unfound payment-method breakdown | Low | Treat as stale docs. |

## Rollback Plan

Additive, so revert is straightforward: `DROP VIEW` / `DROP FUNCTION` the new aggregation objects (no tables, columns, or rows touched; `min_stock` returns to inert), revert the `/analytics` route, `recharts`, and `pdfGenerator.ts` additions, then revert the two bugfix commits — Dashboard returns to store-wide and `EmployeeReport` to prior scoping. Because the bugfixes ship in this change, rollback reverts them too; cherry-pick them back if only they are worth keeping. No data migration either direction.

## Dependencies

- **New**: `recharts`.
- **Existing**: `pdfGenerator.ts` (`jspdf`/`jspdf-autotable`); `branch_stock.min_stock`; `sale_items.product_id` (P1); `products.sale_price` / `purchase_price`; `close_cash_session` / `adjust_branch_stock` RPC precedent.

## Success Criteria

- [ ] Switching branch in the header changes Dashboard and History KPIs.
- [ ] `EmployeeReport` never shows a misleading `$0` for sales the caller cannot see, and lists all POS-operating roles.
- [ ] `/analytics` ranks products by units, revenue, and margin for a period.
- [ ] `/analytics` compares revenue, sales count, and stock across branches.
- [ ] Products at or below `branch_stock.min_stock` surface as low-stock alerts.
- [ ] Cash discrepancy trends render over time by cashier and branch.
- [ ] An `encargado` sees only their branch's data in `/analytics`, verified against live RLS.
- [ ] `caja` / `stock` / `employee` cannot reach `/analytics`.
- [ ] Analytics exports to PDF via `pdfGenerator.ts`.
- [ ] `npm run build` passes.
