# Purchase Tracking Specification

## Purpose

Model a real Purchase entity (`purchases` header + `purchase_items` lines)
mirroring `sales`/`sale_items`, so restocking cost is recorded with history
instead of silently overwriting the single `products.purchase_price` scalar.
Recording a line atomically increases stock and keeps `products.purchase_price`
current; a purchase can be corrected (edit) or reversed (void) via delete,
never a true in-place `UPDATE`.

## Requirements

### Requirement: Purchase Header and Line Item Data Model

The system MUST provide a `purchases` header (`store_id`, `branch_id`,
nullable `supplier_name`, `purchase_date`, nullable `note`) and
`purchase_items` lines (`purchase_id`, `product_id`, `quantity`, `unit_cost`,
`subtotal`), mirroring the `sales`/`sale_items` shape, each scoped to exactly
one `store_id`.

#### Scenario: Admin records a multi-line purchase

- GIVEN an authenticated admin of store A
- WHEN they submit a purchase with 3 lines for different products
- THEN 1 `purchases` row and 3 `purchase_items` rows are persisted, all
  scoped to store A

#### Scenario: Purchase without a supplier name is allowed

- GIVEN an authenticated admin of store A
- WHEN they submit a purchase with `supplier_name` left blank
- THEN the purchase is persisted with `supplier_name` NULL

### Requirement: Role Authorization for Recording, Editing, and Voiding Purchases

`admin`/`superadmin` MUST be able to record, edit, and void a purchase at any
branch of their store. `encargado` MUST be able to record, edit, and void a
purchase only at their own branch, and MUST be rejected for any other branch.
`stock`, `caja`, and `employee` MUST NOT be able to record, edit, or void a
purchase, even though `stock` may adjust quantities via other means.

#### Scenario: Admin records a purchase at any branch of their store

- GIVEN an admin of store A
- WHEN they record a purchase at branch X or branch Y of store A
- THEN both operations succeed regardless of branch

#### Scenario: Encargado is rejected outside their own branch

- GIVEN an encargado assigned to branch X
- WHEN they attempt to record, edit, or void a purchase at branch Y
- THEN the operation is rejected

#### Scenario: Stock role cannot record a purchase

- GIVEN a user with the `stock` role
- WHEN they attempt to record a purchase
- THEN the operation is rejected

### Requirement: Row-Level Security Isolation for Purchases

Every `purchases` and `purchase_items` row MUST be readable and writable only
by authenticated users belonging to that row's `store_id`, matching the
existing Shape B pattern (store-wide for `admin`/`superadmin`, branch-scoped
otherwise).

#### Scenario: Cross-store read returns zero rows

- GIVEN a user from store A is authenticated
- WHEN they query `purchases` or `purchase_items` filtered to store B's `id`
- THEN zero rows are returned

#### Scenario: Cross-branch read returns zero rows for branch-scoped roles

- GIVEN an encargado assigned to branch X
- WHEN they query purchases at branch Y of the same store
- THEN zero rows are returned

### Requirement: Atomic Stock Increase on Purchase Line Insert

Inserting a `purchase_items` row MUST, in the same transaction, increment the
corresponding `branch_stock` row by `quantity` and write a `stock_movements`
row with `reason = 'purchase'` and a non-null `purchase_item_id` referencing
the inserted line. This MUST happen for every line of an N-line purchase.

#### Scenario: N-line purchase increments stock and writes N movements

- GIVEN a product has 10 units in branch stock
- WHEN a purchase inserts a line for that product with `quantity = 5`
- THEN branch stock becomes 15 AND exactly one `stock_movements` row is
  written with `reason = 'purchase'` and `purchase_item_id` set to that line

#### Scenario: Partial insert failure leaves no stock changes

- GIVEN a purchase with 3 lines where one line would violate a constraint
- WHEN the insert is attempted
- THEN no `purchase_items` row, `branch_stock` change, or `stock_movements`
  row from any line of that purchase is persisted

### Requirement: Atomic Stock Reversal on Purchase Line Delete

Deleting a `purchase_items` row MUST, in the same transaction, reverse the
exact stock contribution that its insert made — decrementing `branch_stock`
by the same `quantity` — and write a `stock_movements` row with
`reason = 'purchase_reversal'` referencing the deleted line's product and
branch.

#### Scenario: Deleting a purchase line reverses its stock contribution

- GIVEN a purchase line previously added 5 units to branch stock
- WHEN that `purchase_items` row is deleted
- THEN branch stock decreases by exactly 5 AND a `stock_movements` row with
  `reason = 'purchase_reversal'` is written

### Requirement: Purchase Forward-Updates Current Product Cost

Every `purchase_items` insert MUST set the referenced product's
`purchase_price` forward to that line's `unit_cost`, in addition to the value
being preserved permanently in the `purchase_items` row itself. This MUST
apply on every insert, including a re-insert performed as part of editing a
purchase, regardless of whether the new value is higher or lower than the
current one.

#### Scenario: Recording a purchase updates the product's current cost

- GIVEN a product currently has `purchase_price = 100`
- WHEN a purchase line for that product is recorded with `unit_cost = 120`
- THEN the product's `purchase_price` becomes 120

#### Scenario: A lower unit cost still moves the scalar forward

- GIVEN a product currently has `purchase_price = 100`
- WHEN a purchase line for that product is recorded with `unit_cost = 80`
- THEN the product's `purchase_price` becomes 80

### Requirement: Editing a Purchase via Delete-Then-Recreate

Editing a purchase MUST be implemented as deleting its existing
`purchase_items` rows and inserting corrected replacement rows — never a true
in-place `UPDATE` of `quantity` or `unit_cost`. Before inserting the
replacement rows, the edit flow MUST verify that the number of rows actually
deleted matches the expected number of rows for that purchase, and MUST abort
without inserting replacements if the counts do not match. This check is
mandatory: `salesHelper.ts`'s `deleteSaleGroup` originally returned only an
error object, making an RLS-blocked partial delete indistinguishable from a
full success, and duplicated stock/cost impact until the fix (now returning
`deletedIds` for the caller to count) shipped. The purchase edit flow MUST
NOT repeat that defect.

#### Scenario: Successful edit reverses the original and applies the correction

- GIVEN a purchase with 2 lines was previously recorded
- WHEN it is edited to correct one line's quantity
- THEN both original lines are deleted (reversing their stock/cost impact)
  and 2 corrected lines are inserted (applying the new stock/cost impact),
  with no double-counting

#### Scenario: Partial delete during edit aborts before inserting replacements

- GIVEN a purchase has 2 `purchase_items` rows but RLS blocks deleting one of
  them
- WHEN an edit is attempted
- THEN the deleted-row count (1) is compared against the expected count (2),
  the mismatch is detected, and no replacement rows are inserted

### Requirement: Voiding a Purchase via Delete With No Recreate

Voiding a purchase MUST delete its `purchase_items` rows with no replacement
insert, reversing the purchase's full stock contribution via
`reason = 'purchase_reversal'` movements. Voiding MUST NOT modify
`products.purchase_price` in any way. The same deleted-row-count verification
required for edits MUST also apply to void: the void MUST NOT be treated as
successful unless the actual deleted count matches the expected count.

#### Scenario: Voiding a purchase reverses stock without touching current cost

- GIVEN a purchase recorded 5 units of a product and forward-updated its
  `purchase_price` to 120
- WHEN the purchase is voided
- THEN branch stock decreases by 5 via `reason = 'purchase_reversal'`
  movements AND the product's `purchase_price` remains 120

#### Scenario: Voiding an older purchase never retroactively changes current cost

- GIVEN product P had purchase A (`unit_cost = 100`) then purchase B
  (`unit_cost = 120`), so `purchase_price` is currently 120
- WHEN purchase A (the older one) is voided or edited
- THEN `purchase_price` remains 120; no lookback across remaining purchase
  history is performed to "restore" a prior cost

### Requirement: Non-Regression on Analytics and Existing Stock Movement Reasons

Widening the `stock_movements.reason` allowed values to include `purchase`
and `purchase_reversal` MUST NOT change behavior for any of the 5
pre-existing reason values, and MUST NOT change `analytics_product_ranking`
output, which continues to use the current `products.purchase_price` exactly
as before this change.

#### Scenario: All pre-existing reasons still insert after the CHECK widening

- GIVEN the `stock_movements.reason` CHECK has been widened
- WHEN a row is inserted for each of the 5 pre-existing reason values
- THEN all 5 inserts succeed unchanged

#### Scenario: Analytics output is unaffected by the widening

- GIVEN purchases now exist and have updated `products.purchase_price`
- WHEN `analytics_product_ranking` is run
- THEN its margin calculation continues reading the current
  `products.purchase_price` exactly as it did before this change
