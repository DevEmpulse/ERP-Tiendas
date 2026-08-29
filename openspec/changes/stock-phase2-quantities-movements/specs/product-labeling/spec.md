# Product Labeling Specification

## Purpose

Printable labels rendering each product's system-generated EAN-8 barcode
(defined by the `product-catalog` capability) as a scannable graphic, plus
identifying text, for a single product or a batch. Barcode scanning at the
point of sale is explicitly out of scope (Phase 4); this capability only
generates and renders printable output.

## Requirements

### Requirement: Single Product Label Content

The system MUST render a printable label for one product containing: the
EAN-8 barcode graphic encoding `products.barcode`, the 8-digit code as
visible text beneath the graphic, the product name, and the sale price.

#### Scenario: Label shows all four required elements

- GIVEN a product with barcode "77912345", name "Remera", sale price $5000
- WHEN its label is generated
- THEN the rendered label shows a scannable EAN-8 graphic, the text "77912345", "Remera", and "$5000"

#### Scenario: Label reflects the current sale price at generation time

- GIVEN a product's sale price was recently changed
- WHEN its label is generated after the change
- THEN the label shows the current sale price, not a stale one

### Requirement: Batch Label Printing

The admin product list MUST support selecting multiple products and printing
one label per selected product in a single print job, including a
"print all products from this import run" entry point.

#### Scenario: Admin prints labels for a multi-selection

- GIVEN an admin selects 5 products in the product list
- WHEN they trigger batch label printing
- THEN a single print job containing exactly 5 labels, one per selected product, is produced

#### Scenario: Admin prints labels for a completed import run

- GIVEN an import run just created 12 new products
- WHEN the admin triggers "print all products from this import run"
- THEN a single print job containing exactly 12 labels is produced, one per created product

### Requirement: Admin-Only Label Printing

Label generation and printing MUST be available only under `/admin/*`.
Employees MUST NOT see or reach any label-printing entry point.

#### Scenario: Employee has no access to label printing

- GIVEN an authenticated employee
- WHEN they navigate the employee-facing UI
- THEN no label print action, single or batch, is available to them
