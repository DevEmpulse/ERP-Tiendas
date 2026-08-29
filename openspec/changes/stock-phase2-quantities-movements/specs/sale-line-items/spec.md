# Delta for Sale Line Items

## MODIFIED Requirements

### Requirement: Structured Sale Line Items

The system MUST provide a `sale_items` table where each row records one
product line for a specific `sales.id`: `product_id`, `quantity`,
`unit_price` (price snapshot at sale time), and `subtotal`. Rows MUST attach
directly to a `sales.id` — one row per payment method, as today — and MUST
NOT introduce a transaction-grouping entity above `sales`.

Creating a `sale_items` row with a non-NULL `product_id` MUST decrement the
stock of `(sales.branch_id, sale_items.product_id)` in `branch_stock`
(defined by the `stock-tracking` capability), clamped at zero, logging the
full requested delta even when clamped. Deleting such a row — directly, via
edit-by-delete-recreate, or via cascade when its parent `sales` row is
deleted — MUST restore stock by the movement's applied (not requested) delta.
A `sale_items` row with a NULL `product_id` MUST have no stock effect.

Combined/split payments duplicate the full item set across N `sales` rows
sharing one `Ref:` token in `description`, but each resulting `sales` row now
gets its own decrement logic; the actual duplication that previously would
have decremented N times per logical purchase was fixed upstream in
`store-branches`, whose sale writers attach one `sale_items` set to
`insertedSales[0].id` only. This capability's stock effect MUST equal exactly
one decrement (and one restoration on delete) per logical purchase, and
relies on — rather than re-implements — that upstream fix.
(Previously: table structure only, with a MODIFIED block from Phase 2's first
draft decrementing a single store-wide `products.stock_quantity`; stock is
now branch-scoped via `branch_stock`, resolved through `sales.branch_id`.)

#### Scenario: Sale with a single payment method

- GIVEN a sale is recorded with one payment method
- WHEN it includes two products
- THEN two `sale_items` rows are created, both referencing that one `sales.id`

#### Scenario: Split payment across two sales rows

- GIVEN a checkout is split into two payment methods
- WHEN it is recorded as two `sales` rows sharing a `Ref:` token in `description`
- THEN each `sales` row has its own `sale_items` rows, and `groupSales()` still reconstructs the combined view from the `Ref:` token

#### Scenario: Sale decrements the selling branch's stock

- GIVEN branch X has `current_stock = 10` for product P
- WHEN a `sale_items` row for P with `quantity = 4` is created on a sale whose `branch_id` is X
- THEN branch X's `current_stock` becomes 6, and branch Y's stock for P is untouched

#### Scenario: Split payment decrements stock exactly once (regression, upstream fix)

- GIVEN branch X has `current_stock = 10` for product P, and the split-payment writer fix from `store-branches` is in place (one `sale_items` set attached only to `insertedSales[0].id`)
- WHEN a checkout for quantity 3 of product P is split across two payment methods, producing two `sales` rows sharing one `Ref:` token
- THEN branch X's `current_stock` becomes 7, not 4 — the decrement happens once because only one `sales` row actually carries the `sale_items` set, not because this change deduplicates

#### Scenario: Oversell clamps stock at zero but logs the full requested delta

- GIVEN branch X has `current_stock = 2` for product P
- WHEN a `sale_items` row for P with `quantity = 5` is created at branch X
- THEN `current_stock` becomes 0, not -3, and the sale is not blocked
- AND the logged `stock_movements` row records `requested_delta = -5`, `applied_delta = -2`

#### Scenario: NULL product_id line has no stock effect

- GIVEN a `sale_items` row is created with `product_id` NULL
- WHEN the insert trigger fires
- THEN no `branch_stock` row changes and no `stock_movements` row is created

#### Scenario: Deleting a sale line restores stock by the applied delta

- GIVEN branch X's stock for product P was decremented from 10 to 7 by a sale of quantity 3
- WHEN that `sale_items` row is deleted
- THEN branch X's `current_stock` returns to 10
- AND a `stock_movements` row with `reason = sale_reversal` is logged restoring the applied delta

#### Scenario: Deleting a clamped-oversell sale restores exactly the applied amount

- GIVEN branch X's stock for product P was clamped from 2 to 0 by an oversell of quantity 5 (`applied_delta = -2`)
- WHEN that `sale_items` row is deleted
- THEN branch X's `current_stock` returns to 2, not 5

#### Scenario: Edit-by-delete-recreate nets to zero

- GIVEN branch X's stock for product P is at 6 after a sale of quantity 4 from an original balance of 10
- WHEN an admin edits that sale in `SaleModal.tsx`, which deletes the old `sale_items` row and inserts a new one for the same quantity 4
- THEN stock returns to 10 after the delete and back to 6 after the recreate, netting to zero across the edit

### Requirement: Row-Level Security Isolation for Sale Items

Every `sale_items` row MUST be readable and writable only by authenticated
users belonging to that row's `store_id`, via an RLS policy using
`store_id = public.get_current_user_store_id()`. This requirement is
unaffected by this change; `sale_items` remains store-wide (Shape A, per
`store-branches`), not branch-scoped — only the derived `stock_movements`
side effect is branch-scoped.

#### Scenario: Cross-tenant read returns zero rows

- GIVEN a user from store A is authenticated
- WHEN they query `sale_items` belonging to store B's sales
- THEN zero rows are returned

### Requirement: Sale Line Item Survival on Product Deletion

`sale_items.product_id` MUST tolerate the referenced product being
soft-deleted without deleting or altering the `sale_items` row, preserving
`unit_price` and `subtotal` exactly as recorded at sale time.

#### Scenario: Historical line item outlives its product

- GIVEN a sale line references a product that is later deactivated
- WHEN the sale history is queried afterward
- THEN the `sale_items` row still exists with its original `unit_price` and `subtotal`

### Requirement: `sales.description` Compatibility During Transition

`sales.description` MUST remain nullable and MUST NOT be migrated or dropped
in this phase. New sales MAY stop populating it once `sale_items` becomes the
source of truth for display, but existing rows and any code path still
reading `description` MUST continue to function.

#### Scenario: Legacy description still renders

- GIVEN a pre-existing sale has only a `description` string and no `sale_items`
- WHEN it is displayed in the sales list
- THEN the description-based rendering path is used unchanged

### Requirement: Existing Sales Display Compatibility

The sales list, sale modal, and PDF receipt (`salesHelper.ts`,
`pdfGenerator.ts`) MUST render sales correctly whether a sale has
`sale_items` rows or only a legacy `description`, with no visual regression
for existing sales.

#### Scenario: PDF receipt renders from sale_items

- GIVEN a sale has `sale_items` rows
- WHEN its PDF receipt is generated
- THEN the receipt lists each item from `sale_items` instead of parsing `description`

#### Scenario: Sale modal renders a legacy sale unchanged

- GIVEN a sale predates this change and has no `sale_items`
- WHEN it is opened in `SaleModal.tsx`
- THEN it renders exactly as before, using `description`
