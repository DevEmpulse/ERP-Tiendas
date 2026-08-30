# Store Analytics Specification

## Purpose

Server-side aggregated reporting at `/analytics`: branch-scoped KPIs, product
ranking and margin, branch comparison, low-stock alerts, and cash-discrepancy
trends. Also covers the corrected branch-filter behavior of Dashboard/History
(Bugfix A) and the corrected role-consistent behavior of `EmployeeReport`
(Bugfix B) — neither existing spec covers dashboard scoping or employee
reporting.

## Requirements

### Requirement: Role-Based Access and Branch Scoping

Only `admin` and `encargado` MUST reach `/analytics`; `caja`, `stock`, and
legacy `employee` MUST NOT. `admin` MUST see store-wide data across all
branches with a working branch filter. `encargado` MUST see only their own
branch, with no cross-branch or store-wide aggregate leaking, for every
metric in this spec.

#### Scenario: Admin narrows to one branch

- GIVEN an admin viewing store-wide analytics
- WHEN they select branch X in the filter
- THEN every panel recomputes for branch X only

#### Scenario: Encargado sees only their own branch

- GIVEN an encargado assigned to branch X
- WHEN they open `/analytics`
- THEN all panels show branch X data only

#### Scenario: Non-eligible roles are blocked

- GIVEN an authenticated caja, stock, or employee user
- WHEN they navigate to `/analytics`
- THEN they are redirected, matching `roles.ts` gating

### Requirement: Dashboard/History Honor the Branch Filter (Bugfix A)

Switching the header's branch selector MUST change the KPIs and sales list
shown in Dashboard and History, not merely attribute new sales to that
branch.

#### Scenario: Switching branch changes Dashboard KPIs

- GIVEN an admin on Dashboard with branch X selected
- WHEN they switch the selector to branch Y
- THEN displayed KPIs recompute for branch Y

#### Scenario: Switching branch changes the History list

- GIVEN an admin on History with branch X selected
- WHEN they switch the selector to branch Y
- THEN the sales list shows only branch Y's sales

### Requirement: Employee Report Role-Consistent Scoping (Bugfix B)

`EmployeeReport` MUST NOT show `$0`/`0 ventas` for an employee whose sales
the caller cannot see under RLS — such employees MUST be excluded or marked
not visible. The role filter MUST cover all POS-operating roles, not a
hardcoded `role === 'employee'` check.

#### Scenario: Other-branch employee is not shown as zero

- GIVEN an encargado of branch X views EmployeeReport
- WHEN the store has an employee at branch Y
- THEN that employee is excluded, never `$0`/0 ventas

#### Scenario: All POS-operating roles are listed

- GIVEN a store with caja, encargado, and employee accounts
- WHEN an admin views EmployeeReport
- THEN all three roles' figures are included

### Requirement: Product Ranking and Margin Analysis

The system MUST rank products by units sold and revenue over a default
30-day rolling window, and MUST compute margin per product/period as
`sale_price - purchase_price` times units sold.

#### Scenario: Best and worst sellers over 30 days

- GIVEN sales recorded across the last 30 days
- WHEN the ranking panel loads with no custom period
- THEN products are ranked by units and revenue

#### Scenario: Margin reflects price snapshot

- GIVEN a product's `sale_price` and `purchase_price`
- WHEN margin is computed for a period
- THEN margin equals `(sale_price - purchase_price) * units sold`

### Requirement: Branch Comparison

`admin` MUST see revenue, sales count, and stock compared side by side
across branches. For `encargado`, comparison MUST degenerate to their own
branch alone.

#### Scenario: Admin compares branches

- GIVEN store A has branches X and Y
- WHEN an admin opens branch comparison
- THEN revenue, sales, and stock show side by side for both

### Requirement: Low-Stock Alerts

Products at or below `branch_stock.min_stock` MUST surface as low-stock
alerts inside the `/analytics` panel only, with no `StockView` badge in this
phase.

#### Scenario: Product at or below min_stock is alerted

- GIVEN a branch's product stock is at or below `min_stock`
- WHEN the low-stock panel loads
- THEN that product appears in the alert list

### Requirement: Cash Discrepancy Trends

Cash-discrepancy trends over time, by cashier and branch, MUST be shown
store-wide for `admin` and scoped to their own branch for `encargado`.

#### Scenario: Admin sees discrepancy trend by cashier and branch

- GIVEN closed sessions with discrepancies across branches
- WHEN an admin opens the discrepancy trend panel
- THEN discrepancies plot over time, grouped by cashier and branch

### Requirement: On-Demand Recomputation

Analytics MUST recompute when the user opens or refreshes `/analytics`. No
live Realtime subscription MUST drive analytics updates in this phase.

#### Scenario: Refresh recomputes metrics

- GIVEN `/analytics` is open with stale data
- WHEN the user refreshes or reopens it
- THEN metrics recompute without a realtime push

### Requirement: PDF Export

The system MUST allow exporting the current analytics view to PDF via
`pdfGenerator.ts`.

#### Scenario: Export current view to PDF

- GIVEN an analytics panel with rendered data
- WHEN the user triggers PDF export
- THEN a PDF reflects the currently displayed metrics

### Requirement: RLS-Consistent Aggregation Views and RPCs

New aggregation views/RPCs MUST run as `SECURITY INVOKER`, relying on
existing RLS on `sales`, `sale_items`, `stock_movements`, and
`cash_sessions`, so no view/RPC ever bypasses per-role, per-branch
isolation.

#### Scenario: Encargado query never bypasses RLS

- GIVEN an encargado of branch X queries an analytics view/RPC
- WHEN the query executes under `SECURITY INVOKER`
- THEN only branch X rows are returned, as under direct RLS
