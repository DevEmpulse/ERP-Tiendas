# Cash Movements Specification

## Purpose

An append-only ledger (`cash_movements`) for manual cash-in/cash-out during
an open session — mirroring `stock_movements` — and the recommended (not
DB-exclusive for admin) way to record a post-close correction without
touching the original sale.

## Requirements

### Requirement: Typed Manual Cash Movement Entries

Every `cash_movements` row MUST record `type` (`cash_in` or `cash_out`),
`amount`, `reason`, an optional `note`, `cash_session_id`, `branch_id`,
`store_id`, and `created_by`. Rows MUST only be created while their session
is open.

#### Scenario: Cash-out during an open session is recorded

- GIVEN an open session at branch X
- WHEN a `cash_out` of a supplier payment is recorded with a `reason`
- THEN the row is created with `type = 'cash_out'` and the given amount

### Requirement: Sale-Driven Cash Is Never Duplicated Into the Ledger

`cash_movements` MUST contain only manually created entries. A completed
sale, of any payment method, MUST NOT produce a `cash_movements` row.

#### Scenario: A full open-sell-close cycle produces zero movement rows

- GIVEN a session is opened, several cash sales are recorded, and the
  session is closed
- WHEN `cash_movements` is queried for that session, with no manual entry
  made
- THEN zero rows are returned

### Requirement: Immutability After Creation

`cash_movements` rows MUST be immutable for the `authenticated` role: no
UPDATE or DELETE policy MUST exist (RLS default-deny), and UPDATE/DELETE
privileges MUST additionally be revoked from `authenticated` and `anon` at
the grant layer, mirroring `stock_movements`.

#### Scenario: Authenticated user cannot update or delete a movement

- GIVEN a `cash_movements` row exists
- WHEN any authenticated user, including the row's creator, attempts to
  UPDATE or DELETE it
- THEN the operation is rejected by both RLS and the revoked privilege

### Requirement: Role-Scoped Read and Insert Access

`cash_movements` MUST follow the same branch/role scoping as `cash_sessions`
for SELECT and INSERT: `admin`/`superadmin` store-wide, `encargado`/`caja`/
legacy `employee` at their own branch only.

#### Scenario: Caja records and reads their own branch's movements

- GIVEN a caja assigned to branch X with an open session
- WHEN they INSERT a `cash_in` entry and then SELECT `cash_movements`
- THEN the insert succeeds and only branch X's rows are returned

### Requirement: Recommended Post-Close Correction Path

A `cash_movements` entry (a `cash_out`/`cash_in` with an explanatory `note`)
SHOULD be the way any role records a correction after a session is closed,
since a closed session is never reopened. This path is DB-enforced as the
only correction mechanism for `encargado`/`caja`/`employee` (via the
closed-session block in `role-aware-data-access`), but is not DB-enforced as
exclusive for `admin`/`superadmin`, who retain direct edit access.

#### Scenario: A correction after close is recorded as a movement, not an edit

- GIVEN a session closed with a discrepancy caused by a missed sale
- WHEN the correction is recorded as a `cash_movements` entry with a note
  explaining it
- THEN the entry is created and the closed session's stored numbers are
  unaffected
