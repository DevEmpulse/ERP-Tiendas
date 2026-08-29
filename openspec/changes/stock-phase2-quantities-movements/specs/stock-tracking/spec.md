# Stock Tracking Specification

## Purpose

Per-branch stock balances (`branch_stock`) plus an append-only, branch-isolated
ledger (`stock_movements`) explaining every quantity change, including
sale-driven movements and admin manual adjustments. A minimal per-branch admin
UI for viewing/adjusting stock and browsing movement history. Low-stock
alerts/thresholds/reporting are out of scope (Phase 7); stock transfers
between branches, cash register, and the sales-time product picker are out of
scope for this change.

## Requirements

### Requirement: Branch-Scoped Stock Balance

The system MUST provide `public.branch_stock` keyed `(branch_id, product_id)`
with `current_stock` (integer) and `min_stock` (integer, a bare column with no
alert/threshold behavior in this phase). A missing `(branch_id, product_id)`
row MUST NOT be treated as an error; it MUST be created on demand with
`current_stock = 0` the first time that pair is referenced.

#### Scenario: Reading stock for a never-referenced product/branch pair

- GIVEN branch X has no `branch_stock` row for product P
- WHEN P's stock at branch X is read or is first written to (sale or adjustment)
- THEN a row is created with `current_stock = 0` before applying any delta

#### Scenario: Existing balance is read directly

- GIVEN branch X has a `branch_stock` row for product P with `current_stock = 15`
- WHEN it is read from any admin view
- THEN 15 is returned

### Requirement: Append-Only Branch Stock Movement Ledger

The system MUST provide `public.stock_movements`: `id`, `store_id`,
`branch_id` (NOT NULL, `REFERENCES branches(id)`), `product_id`, a typed
`reason` (`sale`, `sale_reversal`, `manual_adjustment`, `import_ingress`),
`requested_delta` and `applied_delta` (both signed integers, tracked
separately so a clamped oversell's reversal restores exactly the amount that
was actually applied, not the amount requested), `resulting_balance`,
nullable `sale_item_id`, nullable note, `created_at`, nullable `created_by`.
No role MUST be able to UPDATE or DELETE an existing row.

#### Scenario: A stock-affecting event logs exactly one movement

- GIVEN a `branch_stock` row for product P at branch X is at `current_stock = 10`
- WHEN a sale, reversal, manual adjustment, or import ingress changes it
- THEN exactly one `stock_movements` row is inserted with `resulting_balance` equal to the new `current_stock`

#### Scenario: Movement rows are immutable

- GIVEN a `stock_movements` row exists
- WHEN any authenticated user attempts to UPDATE or DELETE it
- THEN the operation is rejected

### Requirement: Shape B RLS on Branch Stock and Movements

Every `branch_stock` and `stock_movements` row MUST be readable and writable
only within its `store_id`, and additionally: admins and superadmins of that
store MUST be able to access rows for every branch of that store, while
employees MUST be restricted to rows of their own `branch_id`, per the
`store-branches` Shape B predicate (`get_current_user_role() IN ('admin',
'superadmin') OR branch_id = get_current_user_branch_id()`).

#### Scenario: Cross-tenant read returns zero rows

- GIVEN a user from store A is authenticated
- WHEN they query `branch_stock` or `stock_movements` belonging to store B
- THEN zero rows are returned

#### Scenario: Employee restricted to their own branch

- GIVEN an employee is assigned to branch X of store A, which also has branch Y
- WHEN they query `branch_stock` or `stock_movements` for branch Y
- THEN zero rows are returned

#### Scenario: Admin floats across all branches of their store

- GIVEN an admin of store A, which has branches X and Y
- WHEN they query `branch_stock` or `stock_movements` for either branch
- THEN rows for both branches are returned

### Requirement: Sale-Driven Stock Movement

Inserting a `sale_items` row for a non-NULL `product_id` MUST decrement
`branch_stock.current_stock` for `(sales.branch_id, sale_items.product_id)`
by `quantity`, clamped at zero, and MUST log one `stock_movements` row with
`reason = sale` recording the full `requested_delta` even when clamping
occurred. Deleting that `sale_items` row (directly, via edit-by-delete-recreate,
or via cascade) MUST restore stock by the movement's `applied_delta` (not its
`requested_delta`) and log one `reason = sale_reversal` row. A `sale_items`
row with a NULL `product_id` MUST NOT affect stock and MUST NOT log a
movement.

#### Scenario: Oversell clamps at zero without blocking the sale

- GIVEN branch X has `current_stock = 2` for product P
- WHEN a `sale_items` row for P with `quantity = 5` is created at branch X
- THEN the sale succeeds, `current_stock` becomes 0 (not -3)
- AND the logged movement has `requested_delta = -5`, `applied_delta = -2`

#### Scenario: Reversing a clamped oversell restores only what was applied

- GIVEN the prior scenario logged `applied_delta = -2`
- WHEN that `sale_items` row is deleted
- THEN `current_stock` is restored by 2 (not 5), returning to its pre-sale value exactly

#### Scenario: NULL product_id sale line is a no-op for stock

- GIVEN a `sale_items` row is created with `product_id` NULL
- WHEN the insert trigger fires
- THEN no `branch_stock` row changes and no `stock_movements` row is created

#### Scenario: Edit-by-delete-recreate nets to zero, including the clamped case

- GIVEN branch X has `current_stock = 2` for product P
- WHEN a sale for `quantity = 5` is created (clamping to 0, `applied_delta = -2`) and then edited, which deletes and recreates the same line at the same quantity
- THEN the delete restores `current_stock` to 2, and the recreate re-clamps it back to 0
- AND the net effect after edit equals the state before the edit

#### Scenario: Split-payment sale decrements exactly once (regression)

- GIVEN the split-payment duplication bug was already fixed upstream in `store-branches` — writers attach one `sale_items` set to `insertedSales[0].id` only, never duplicating it across the other payment-method rows
- WHEN a checkout for quantity 3 of product P is split across two payment methods
- THEN stock at the sale's branch decrements by exactly 3, not 6
- AND this change's triggers introduce no deduplication logic of their own, because the writer-level fix already guarantees one `sale_items` set per logical purchase

### Requirement: Admin-Only Manual Stock Adjustment

The system MUST provide an atomic, admin-only RPC that adjusts
`branch_stock.current_stock` for a given `(branch_id, product_id)` and logs a
`stock_movements` row with `reason = manual_adjustment`. Employees MUST NOT
be able to invoke it.

#### Scenario: Admin adjusts stock for the selected branch

- GIVEN an admin has branch X selected in the header
- WHEN they record a manual adjustment of +20 for product P at branch X
- THEN `current_stock` increases by 20 and a `manual_adjustment` movement is logged

#### Scenario: Employee cannot adjust stock

- GIVEN an authenticated employee
- WHEN they attempt to invoke the adjustment RPC
- THEN the request is rejected

### Requirement: Minimal Per-Branch Admin Stock UI

`StockView.tsx` MUST display and allow adjusting stock for the branch
currently selected via the existing header selector (`selectedBranchId`), and
MUST show a read-only movement history per product for that branch.

#### Scenario: Stock view reflects the selected branch

- GIVEN an admin has branch X selected in the header
- WHEN they open the stock view
- THEN stock levels and movement history shown are branch X's, not another branch's

#### Scenario: Movement history is read-only

- GIVEN a product has prior movements at the selected branch
- WHEN the admin views its movement history
- THEN entries are listed but none are editable or deletable
