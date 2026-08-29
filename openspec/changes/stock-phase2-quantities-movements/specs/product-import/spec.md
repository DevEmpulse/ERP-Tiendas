# Product Import Specification

## Purpose

Spreadsheet-driven bulk creation and update of a store's product catalog,
with category auto-creation, additive stock ingress at one admin-chosen
branch, a pre-commit preview, and a matching catalog export so codes assigned
by import round-trip back into a re-importable file. Admin-only; employees
never see either surface.

## Requirements

### Requirement: Import File Columns and Ignored Formula Columns

The system MUST read `.xlsx` columns `Nombre del Producto`, `Sección`,
`Cantidad Ingresada`, `Precio Costo Unitario`, `Precio Venta Unitario`, and
optional `ID`. Any `Margen%` or `Totales` column MUST NOT be read as data
under any circumstance, including when it contains a formula error value.

#### Scenario: A `#VALUE!` error in Margen% does not error or reject the row

- GIVEN an uploaded file has a `Margen%` column containing `#VALUE!` in one row
- WHEN the file is parsed
- THEN that row is processed normally using only the required columns, and no error is raised for the `Margen%` cell

### Requirement: Row Matching by Barcode

A row's `ID` value MUST be matched against existing products in the
destination store's catalog if and only if a product with a `barcode` exactly
equal to that `ID` exists in that store. A blank `ID`, and an `ID` present
but not equal to any existing product's `barcode` in that store, MUST both be
treated identically: create a new product with a freshly generated barcode.
The file's `ID` value MUST NOT be written anywhere in either case.

#### Scenario: Blank ID creates a new product

- GIVEN a row has no value in the `ID` column
- WHEN the row is processed
- THEN a new product is created with a freshly generated EAN-8 barcode

#### Scenario: Unmatched but present ID creates a new product, file value discarded

- GIVEN a row has `ID = "99999999"` and no product in this store has that barcode
- WHEN the row is processed
- THEN a new product is created with a freshly generated EAN-8 barcode, and "99999999" is never stored anywhere

#### Scenario: Matching ID updates the existing product

- GIVEN a row has `ID = "77912345"` and a product in this store already has that barcode
- WHEN the row is processed
- THEN that existing product is updated, not duplicated

### Requirement: Matched Row Update and Additive Stock Ingress

A matched row MUST update the existing product's `name`, `category_id` (by
`Sección`), `purchase_price`, and `sale_price`. If `Cantidad Ingresada` is
present and non-zero, one new `stock_movements` row (`reason =
import_ingress`) MUST be recorded at the run's destination branch, adding to
existing stock — an import MUST NEVER overwrite or reset a stock balance. A
blank or zero `Cantidad Ingresada` on a matched row MUST update identity
fields only and MUST NOT create a movement.

#### Scenario: Matched row with quantity adds stock

- GIVEN a matched product has `current_stock = 10` at the destination branch
- WHEN its row specifies `Cantidad Ingresada = 15`
- THEN identity fields are updated AND `current_stock` becomes 25 via one new `import_ingress` movement

#### Scenario: Matched row with blank quantity updates identity only

- GIVEN a matched product has `current_stock = 10` at the destination branch
- WHEN its row has a blank `Cantidad Ingresada`
- THEN identity fields are updated AND `current_stock` remains 10 with no new movement

### Requirement: New Product Row Creation and Opening Stock

A newly created row (from a blank or unmatched `ID`) MUST be created with the
row's `name`, category (auto-created if needed), `purchase_price`, and
`sale_price`. If `Cantidad Ingresada` is present and non-zero, one
`import_ingress` movement MUST be recorded at the destination branch as its
opening balance.

#### Scenario: New product with a quantity gets an opening movement

- GIVEN a row with a blank `ID` specifies `Cantidad Ingresada = 40`
- WHEN the row is processed
- THEN a new product is created and one `import_ingress` movement of +40 is logged, explaining the opening balance

### Requirement: Category Auto-Creation

If a row's `Sección` value does not match any existing category name in the
destination store, a new category with that name MUST be created and used.

#### Scenario: Unknown Sección creates a category

- GIVEN the store has no category named "Lácteos"
- WHEN a row specifies `Sección = "Lácteos"`
- THEN a new category "Lácteos" is created and assigned to that row's product

### Requirement: Preview-Before-Commit Consistency

Before any write occurs, the system MUST show counts of products to be
created, products to be updated, and new categories to be created. The
committed write MUST produce exactly those counts.

#### Scenario: Preview counts match the commit

- GIVEN a preview reports "3 to create, 5 to update, 1 new category"
- WHEN the admin confirms and the import commits
- THEN exactly 3 products are created, 5 are updated, and 1 category is created

### Requirement: Catalog Export

The system MUST generate a `.xlsx` export of the store's active catalog with
columns `ID`, `Nombre del Producto`, `Sección`, `Cantidad Ingresada` (current
stock at the branch selected for export), `Precio Costo Unitario`, `Precio
Venta Unitario`, in that exact order and naming, matching the import format.

#### Scenario: Export then unmodified re-import updates every row and creates nothing

- GIVEN a store's catalog is exported to a file
- WHEN that exact file is re-imported without modification
- THEN every row matches an existing product by its `ID` (barcode) and is updated, and zero new products or categories are created

### Requirement: Admin-Only Import and Export

Import and export MUST be available only under `/admin/*`. Employees MUST NOT
see either entry point.

#### Scenario: Employee has no access to import or export

- GIVEN an authenticated employee
- WHEN they navigate the employee-facing UI
- THEN neither an import nor an export action is available to them
