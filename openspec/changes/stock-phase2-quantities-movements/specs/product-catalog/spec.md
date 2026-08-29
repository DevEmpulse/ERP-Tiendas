# Delta for Product Catalog

## MODIFIED Requirements

### Requirement: Category and Product Catalog Data Model

The system MUST provide per-store `categories` (name) and `products` (name,
nullable `category_id`, `purchase_price`, `sale_price`, `barcode` (see
"Barcode Uniqueness Per Store" for format and uniqueness), `is_active`,
timestamps), each scoped to exactly one `store_id`. `products` MUST NOT gain
a stock-quantity column of any kind — stock is deliberately branch-scoped and
lives exclusively in the `stock-tracking` capability's `branch_stock` table,
never on `products`. `barcode` MUST NOT be a user-entered field in any
product create or edit form; it is populated exclusively by the system per
the "Barcode Uniqueness Per Store" requirement.
(Previously: `barcode` was optional free text a user could type or leave
blank; no relationship to a stock column was stated.)

#### Scenario: Admin creates a product without a category

- GIVEN an authenticated admin of store A
- WHEN they create a product with no `category_id`
- THEN the product is persisted with `category_id` NULL and `is_active` true

#### Scenario: Admin creates a category

- GIVEN an authenticated admin of store A
- WHEN they create a category named "Bebidas"
- THEN the category is persisted scoped to store A

#### Scenario: Barcode field is absent from the product form

- GIVEN an admin opens the product create or edit form
- WHEN the form is rendered
- THEN no input field exists for `barcode`; the value shown, if any, is read-only

### Requirement: Barcode Uniqueness Per Store

`products.barcode` MUST be mandatory (never NULL), system-generated, exactly
8 numeric digits, and globally unique across all stores. It MUST NOT be
directly typed or edited by any user. The value is generated from a global
sequence (7 digits, zero-padded) plus an 8th digit that MUST validate as a
correct EAN-8 check digit computed from the first 7 digits per the standard
GS1 mod-10 weighted checksum.

This requirement explicitly supersedes and replaces the Phase 1 behavior of
per-`(store_id, barcode)` uniqueness with nullable, freely duplicable values
across stores: the same 8-digit code MUST NOT exist on more than one product
anywhere in the system, regardless of store.
(Previously: `barcode` was nullable, optional, unique only within
`(store_id, barcode)`, and explicitly allowed to repeat across different
stores.)

#### Scenario: Duplicate barcode rejected within the same store

- GIVEN store A already has a product with barcode "77912340"
- WHEN store A's system attempts to assign that same code to a second product
- THEN the insert is rejected by a uniqueness constraint

#### Scenario: Duplicate barcode rejected across different stores (supersedes Phase 1)

- GIVEN store A has a product with barcode "77912340"
- WHEN store B's system attempts to assign that same code to one of its products
- THEN the insert is rejected by a global uniqueness constraint — this contradicts and replaces the Phase 1 scenario "Same barcode allowed across different stores," which no longer holds

#### Scenario: Every product has a non-null, check-digit-valid code

- GIVEN a product is created through any path (manual, import)
- WHEN its `barcode` is read
- THEN it is exactly 8 numeric digits and the 8th digit validates as the correct EAN-8 check digit for the first 7

## ADDED Requirements

### Requirement: System-Generated Barcode Assignment

Every new product row MUST receive its `barcode` from the system at creation
time, drawn from a global Postgres sequence, before any uniqueness or
not-null constraint is evaluated. No code path (manual admin creation,
import) MUST accept an externally supplied value as a product's `barcode`.

#### Scenario: Manually created product receives a generated code

- GIVEN an admin creates a product through `StockView.tsx`
- WHEN the product is persisted
- THEN its `barcode` is a freshly generated, check-digit-valid 8-digit code, with no opportunity for the admin to supply one

#### Scenario: An externally supplied code is never adopted

- GIVEN any bulk or manual creation path receives an external identifier alongside a new product's data
- WHEN the product is created
- THEN the external identifier is discarded and a system-generated code is assigned instead
