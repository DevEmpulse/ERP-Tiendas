# Pos Sale Entry Specification

## Purpose

Define `/pos`, the scan-first counter screen where `caja`, `employee`, and
`encargado` record sales, replacing the free-text `sales-form.tsx` entry
point. Every line MUST resolve to a real product before it is added, except a
deliberate unlisted-product escape hatch. Stock, cash-session, and payment
behavior reuse existing helpers unchanged so `/pos` unifies entry without
becoming a fourth divergent form.

## Requirements

### Requirement: Role Access to /pos

`caja`, `employee`, and `encargado` MUST be able to create sales via `/pos`.
`admin` MUST be able to reach `/pos`. Any unauthenticated user, or a role not
listed here, MUST be denied access.

#### Scenario: Caja creates a sale via /pos

- GIVEN a user with role `caja`
- WHEN they navigate to `/pos` and submit a sale
- THEN the sale is recorded successfully

#### Scenario: Encargado creates a sale via /pos

- GIVEN a user with role `encargado`
- WHEN they navigate to `/pos`
- THEN they can create a sale the same way as `caja`/`employee`

#### Scenario: Unauthenticated access is denied

- GIVEN no authenticated session
- WHEN `/pos` is requested
- THEN access is denied and the request is redirected to `/login`

### Requirement: Product Resolution Before Line Add

Every line added through the product picker (search by name or barcode) MUST
carry a `products.id` resolved at add-time, not deferred to submit. The one
exception is a deliberate "producto no listado" free-text line, which MUST
remain addable with `product_id: NULL` so the counter is never blocked by a
missing catalog entry.

#### Scenario: Selecting a search result resolves product_id

- GIVEN the cashier searches by product name
- WHEN they select a matching result
- THEN the line is added carrying that product's real `products.id`

#### Scenario: Unlisted-product line stays unblocked

- GIVEN no catalog match exists for what the cashier is selling
- WHEN they choose "producto no listado" and enter a free-text description
  and price
- THEN the line is added with `product_id: NULL` and the sale is not blocked

### Requirement: Keyboard-Wedge Barcode Scan-to-Add

A fast sequence of keystrokes ending in `Enter`, consistent with a
keyboard-wedge scanner, MUST be matched against `products.barcode` and, on a
match, add that product's line automatically with no further confirmation.
Slower, manual keystroke entry of the same digits MUST NOT be treated as a
scan.

#### Scenario: Scanning a known barcode adds the line

- GIVEN a product exists with barcode `X`
- WHEN a fast keystroke sequence for `X` ending in `Enter` is captured
- THEN the matching product's line is added automatically

#### Scenario: Manual slow typing is not treated as a scan

- GIVEN the same digits as a valid barcode
- WHEN they are typed manually at normal typing speed
- THEN no line is auto-added; the cashier must use the picker/search
  explicitly

#### Scenario: Unmatched scan does not block the counter

- GIVEN a scanned code matches no `products.barcode`
- WHEN the scan completes
- THEN no line is added, a not-found signal is shown, and the cashier can
  still search or use the unlisted-product line

### Requirement: Non-Blocking Stock Warning

Before submit, the system MUST read `branch_stock.current_stock` for the
sale's branch and, when a line's requested quantity exceeds it, show a
warning. The warning MUST NOT prevent the cashier from confirming and
completing the sale.

#### Scenario: Oversell shows a warning but still completes

- GIVEN a line's requested quantity exceeds `branch_stock.current_stock` at
  the sale's branch
- WHEN the cashier attempts to submit
- THEN a warning is shown, and confirming completes the sale

#### Scenario: Sufficient stock shows no warning

- GIVEN every line's requested quantity is at or below available stock
- WHEN the cashier submits
- THEN no stock warning is shown

### Requirement: Split-Payment Behavior Reuse

`/pos` MUST record a split-payment checkout using the existing
multi-row/`Ref:` grouping pattern from `salesHelper.ts`, unchanged.

#### Scenario: Split checkout creates grouped sales rows

- GIVEN a checkout is split across two payment methods
- WHEN it is submitted from `/pos`
- THEN two `sales` rows sharing a `Ref:` token are created, and
  `groupSales()` reconstructs them as one combined view

### Requirement: Cash-Session Attribution Without Blocking

`/pos` MUST call `fetchOpenSession` for the sale's branch immediately before
insert and attribute the sale to it when a session is open. The sale MUST
succeed with `cash_session_id: NULL` when no session is open. Session state
MUST NOT block submission.

#### Scenario: Sale with no open session succeeds unattributed

- GIVEN the sale's branch has no open `cash_sessions` row
- WHEN the sale is submitted from `/pos`
- THEN it succeeds with `cash_session_id IS NULL`

#### Scenario: Sale is attributed to an open session

- GIVEN the sale's branch has an open session S
- WHEN the sale is submitted from `/pos`
- THEN `cash_session_id = S.id`

### Requirement: Receipt Handoff After Sale

After a sale is successfully recorded from `/pos`, `ReceiptModal.tsx` MUST be
invoked unchanged to offer thermal/PDF receipt output.

#### Scenario: Successful sale opens the receipt modal

- GIVEN a sale is successfully submitted from `/pos`
- WHEN the submission completes
- THEN `ReceiptModal.tsx` opens with that sale's data
