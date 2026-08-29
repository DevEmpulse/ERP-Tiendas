# Delta for Sale Line Items

## ADDED Requirements

### Requirement: Structured Sale Line Items

The system MUST provide a `sale_items` table where each row records one product line for a specific `sales.id`: `product_id`, `quantity`, `unit_price` (price snapshot at sale time), and `subtotal`. Rows MUST attach directly to a `sales.id` — one row per payment method, as today — and MUST NOT introduce a transaction-grouping entity above `sales`.

#### Scenario: Sale with a single payment method

- GIVEN a sale is recorded with one payment method
- WHEN it includes two products
- THEN two `sale_items` rows are created, both referencing that one `sales.id`

#### Scenario: Split payment across two sales rows

- GIVEN a checkout is split into two payment methods
- WHEN it is recorded as two `sales` rows sharing a `Ref:` token in `description`
- THEN each `sales` row has its own `sale_items` rows, and `groupSales()` still reconstructs the combined view from the `Ref:` token

### Requirement: Row-Level Security Isolation for Sale Items

Every `sale_items` row MUST be readable and writable only by authenticated users belonging to that row's `store_id`, via an RLS policy using `store_id = public.get_current_user_store_id()`.

#### Scenario: Cross-tenant read returns zero rows

- GIVEN a user from store A is authenticated
- WHEN they query `sale_items` belonging to store B's sales
- THEN zero rows are returned

### Requirement: Sale Line Item Survival on Product Deletion

`sale_items.product_id` MUST tolerate the referenced product being soft-deleted without deleting or altering the `sale_items` row, preserving `unit_price` and `subtotal` exactly as recorded at sale time.

#### Scenario: Historical line item outlives its product

- GIVEN a sale line references a product that is later deactivated
- WHEN the sale history is queried afterward
- THEN the `sale_items` row still exists with its original `unit_price` and `subtotal`

### Requirement: `sales.description` Compatibility During Transition

`sales.description` MUST remain nullable and MUST NOT be migrated or dropped in this phase. New sales MAY stop populating it once `sale_items` becomes the source of truth for display, but existing rows and any code path still reading `description` MUST continue to function.

#### Scenario: Legacy description still renders

- GIVEN a pre-existing sale has only a `description` string and no `sale_items`
- WHEN it is displayed in the sales list
- THEN the description-based rendering path is used unchanged

### Requirement: Existing Sales Display Compatibility

The sales list, sale modal, and PDF receipt (`salesHelper.ts`, `pdfGenerator.ts`) MUST render sales correctly whether a sale has `sale_items` rows or only a legacy `description`, with no visual regression for existing sales.

#### Scenario: PDF receipt renders from sale_items

- GIVEN a sale has `sale_items` rows
- WHEN its PDF receipt is generated
- THEN the receipt lists each item from `sale_items` instead of parsing `description`

#### Scenario: Sale modal renders a legacy sale unchanged

- GIVEN a sale predates this change and has no `sale_items`
- WHEN it is opened in `SaleModal.tsx`
- THEN it renders exactly as before, using `description`
