# Cash Sessions Specification

## Purpose

Model a per-branch till shift (`cash_sessions`): an opening float, a single
active session per branch enforced by the database, and a frozen
reconciliation (`expected_amount` vs `counted_amount`) computed once at
close and never recomputed afterward.

## Requirements

### Requirement: One Open Session Per Branch

The system MUST guarantee, at the database level via a partial unique index
on `(branch_id) WHERE status = 'open'`, that at most one `cash_sessions` row
per branch has `status = 'open'` at any time. This MUST NOT be a UI-only
convention.

#### Scenario: Second concurrent open at the same branch is rejected

- GIVEN branch X already has a `cash_sessions` row with `status = 'open'`
- WHEN a second INSERT attempts to open another session for branch X
- THEN the database rejects the insert via the unique index violation

### Requirement: Session Open/Close Role Authorization

`admin`/`superadmin` MUST be able to open and close a `cash_sessions` row at
any branch of their store. `encargado`/`caja`/legacy `employee` MUST be able
to open and close a session only at their own branch, and MUST be rejected
for any other branch.

#### Scenario: Admin opens and closes a session at any branch

- GIVEN an admin of store A
- WHEN they open, then close, a session at branch X or branch Y of store A
- THEN both operations succeed regardless of branch

#### Scenario: Caja is rejected outside their own branch

- GIVEN a caja assigned to branch X
- WHEN they attempt to open or close a session at branch Y
- THEN the operation is rejected

### Requirement: Cash Sale Attribution Without Blocking

No sale MUST ever be blocked or rejected due to cash session state. When no
session is open at the sale's branch, `sales.cash_session_id` MUST be set to
`NULL`. When a session is open, the sale MUST be attributed to it.

#### Scenario: Cash sale with no open session succeeds unattributed

- GIVEN branch X has no `cash_sessions` row with `status = 'open'`
- WHEN a cash sale is recorded at branch X
- THEN the sale succeeds with `cash_session_id IS NULL`, no error or gate

#### Scenario: Cash sale while a session is open is attributed to it

- GIVEN branch X has an open session S
- WHEN a cash sale is recorded at branch X, on any writer path
- THEN the sale's `cash_session_id = S.id`

### Requirement: Frozen Reconciliation at Close

Closing a session MUST compute and store, once, `expected_amount =
opening_amount + Σ(cash sales attributed to the session) + Σ(cash_in
movements) − Σ(cash_out movements)` and `discrepancy = counted_amount −
expected_amount`. These stored values MUST NOT be recomputed afterward for
any reason, including a later authorized edit to the underlying sales.

#### Scenario: Close computes and stores expected and discrepancy

- GIVEN an open session with a known opening amount, cash sales, and
  movements
- WHEN it is closed with a supplied `counted_amount`
- THEN `expected_amount` and `discrepancy` are computed and stored on that
  row

#### Scenario: Closed session numbers survive a later admin edit

- GIVEN a session was closed with a stored `expected_amount` and
  `discrepancy`
- WHEN an admin later performs an exempt post-close edit to a sale that
  belonged to that session (see `role-aware-data-access`)
- THEN re-reading the closed session returns the same `expected_amount` and
  `discrepancy` as at close time, unchanged

### Requirement: Session History Visibility by Role

`admin`/`superadmin` MUST see session history store-wide. `encargado` MUST
see only their own branch's history. `caja` MUST see only their own branch's
history, read-only.

#### Scenario: Admin sees store-wide session history

- GIVEN store A has closed sessions at branches X and Y
- WHEN an admin queries session history
- THEN sessions from both branches are returned

#### Scenario: Caja sees their own branch's history read-only

- GIVEN a caja assigned to branch X
- WHEN they query session history
- THEN only branch X's sessions are returned, and no UPDATE/DELETE succeeds

### Requirement: Shift Continuity Without Hand-off

Any role authorized to operate a branch MAY attach further sales to that
branch's already-open session, opened by a different person. No explicit
hand-off action MUST be required.

#### Scenario: A different employee continues an already-open session

- GIVEN caja A opened session S at branch X
- WHEN caja B, also assigned to branch X, records a cash sale during the
  same shift
- THEN the sale is attributed to S with no hand-off step performed
