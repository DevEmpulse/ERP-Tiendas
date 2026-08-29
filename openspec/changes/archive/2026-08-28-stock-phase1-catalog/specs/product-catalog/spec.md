# Delta for Product Catalog

## ADDED Requirements

### Requirement: Category and Product Catalog Data Model

The system MUST provide per-store `categories` (name) and `products` (name, nullable `category_id`, `purchase_price`, `sale_price`, nullable `barcode`, `is_active`, timestamps), each scoped to exactly one `store_id`.

#### Scenario: Admin creates a product without a category

- GIVEN an authenticated admin of store A
- WHEN they create a product with no `category_id`
- THEN the product is persisted with `category_id` NULL and `is_active` true

#### Scenario: Admin creates a category

- GIVEN an authenticated admin of store A
- WHEN they create a category named "Bebidas"
- THEN the category is persisted scoped to store A

### Requirement: Barcode Uniqueness Per Store

The system MUST enforce that `products.barcode`, when not null, is unique within a `(store_id, barcode)` pair, while allowing null barcodes and allowing the same barcode value across different stores.

#### Scenario: Duplicate barcode rejected within the same store

- GIVEN store A already has a product with barcode "7791234"
- WHEN store A creates a second product with barcode "7791234"
- THEN the insert is rejected by a uniqueness constraint

#### Scenario: Same barcode allowed across different stores

- GIVEN store A has a product with barcode "7791234"
- WHEN store B creates a product with barcode "7791234"
- THEN the insert succeeds

### Requirement: Row-Level Security Isolation for Categories and Products

Every `categories` and `products` row MUST be readable and writable only by authenticated users belonging to that row's `store_id`, via RLS policies using `store_id = public.get_current_user_store_id()`, matching the existing pattern on `clients` and `product_price_rules`.

#### Scenario: Cross-tenant read returns zero rows

- GIVEN a user from store A is authenticated
- WHEN they query `products` or `categories` filtered to store B's `id`
- THEN zero rows are returned

#### Scenario: Cross-tenant write is rejected

- GIVEN a user from store A is authenticated
- WHEN they attempt to insert or update a `products`/`categories` row carrying store B's `store_id`
- THEN the write is rejected by the RLS policy's WITH CHECK clause

### Requirement: Soft-Delete History Preservation

Deleting a category or product MUST NOT hard-delete rows or destroy history. Deleting a category MUST set `products.category_id` to NULL for its products. Deactivating a product MUST set `is_active = false` and MUST NOT modify or remove any `sale_items` rows referencing it, mirroring the reference-nulling pattern in `delete_employee_user()`.

#### Scenario: Category deletion detaches its products

- GIVEN category "Bebidas" has two active products
- WHEN an admin deletes category "Bebidas"
- THEN both products remain active with `category_id` NULL

#### Scenario: Product soft-delete preserves prior sales

- GIVEN a product has three historical `sale_items` rows
- WHEN an admin deactivates the product
- THEN `is_active` becomes false AND all three `sale_items` rows remain unchanged

### Requirement: Price Rule Product Reference Migration

`product_price_rules` MUST gain a nullable `product_id` foreign key to `products(id)`, added alongside the existing `product_name` column, not replacing it in the same step. `product_name` MUST NOT be dropped in this phase.

The behavioral cutover — price-rule lookups in `src/components/employee/sales-form.tsx`, `src/components/admin/SaleModal.tsx`, and the price-rule admin view (`StockView.tsx`) resolving by `product_id` instead of case-insensitive `product_name` string matching — is explicitly OUT OF SCOPE for this phase. It requires a product-picker UI to let a user select (rather than free-type) a product when creating a price rule or a sale line, which does not exist until Phase 4 (new POS). This deferral was confirmed by the user during `sdd-design` after `design.md` surfaced that the column/index can ship now but the app-layer cutover cannot. All three call sites keep matching by `product_name` until Phase 4 adds the picker.

#### Scenario: Price rules keep resolving by name in this phase

- GIVEN a product "Remera" has a price rule for quantity 12
- WHEN a sale line for "Remera" reaches quantity 12 in `sales-form.tsx`
- THEN the rule is matched via case-insensitive `product_name`, as before this phase

#### Scenario: `product_id` cutover deferred to Phase 4

- GIVEN Phase 1 has been applied
- WHEN a price rule or sale line is created without a product-picker UI
- THEN `product_price_rules.product_id` and `sale_items.product_id` MAY remain unset, and no call site is required to resolve rules by `product_id` until a picker exists

### Requirement: Non-Regression and Build Verification

This phase MUST NOT require Phase 2 (stock quantities), Phase 3 (cash register), or any later phase to exist or function. The migration MUST pass `npm run build` and MUST NOT introduce new findings in Supabase `get_advisors`.

#### Scenario: Build and advisors pass after migration

- GIVEN section 13 of `migration.sql` has been applied to a development branch
- WHEN `npm run build` and `get_advisors` are run
- THEN the build succeeds AND no new security findings are reported

#### Scenario: Catalog usable without Phase 2

- GIVEN only Phase 1 has been applied
- WHEN an admin manages categories and products
- THEN all Phase 1 behavior works with no dependency on stock-quantity features
