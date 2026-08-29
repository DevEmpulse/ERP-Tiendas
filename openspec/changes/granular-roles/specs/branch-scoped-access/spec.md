# Delta for Branch-Scoped Access

## MODIFIED Requirements

### Requirement: Employee Branch Assignment Is Mandatory, Admin Is Branch-Free

`profiles.branch_id` MUST be nullable and MUST reference `branches(id)` with
`ON DELETE RESTRICT`. The CHECK constraint generalizes from the single
`employee` role to every branch-scoped role: `role IN ('encargado', 'caja',
'stock', 'employee') AND branch_id IS NOT NULL`, OR `role IN ('admin',
'superadmin') AND branch_id IS NULL`. Every branch-scoped role MUST carry a
non-null `branch_id`; `admin` and `superadmin` MUST carry a NULL
`branch_id`.
(Previously: `role <> 'employee' OR branch_id IS NOT NULL` — only `employee`
was required to have a branch, and nothing prevented `admin`/`superadmin`
from also carrying a non-null one.)

#### Scenario: Employee profile without a branch is rejected

- GIVEN an insert or update targets a profile with `role = 'employee'`
- WHEN `branch_id` is NULL
- THEN the CHECK constraint rejects the write

#### Scenario: Admin profile with NULL branch is accepted

- GIVEN an insert or update targets a profile with `role = 'admin'`
- WHEN `branch_id` is NULL
- THEN the write succeeds

#### Scenario: Employee profile with a branch is accepted

- GIVEN an insert targets a profile with `role = 'employee'`
- WHEN `branch_id` is set to an existing branch of the same store
- THEN the write succeeds

#### Scenario: Encargado, caja, and stock each require a non-null branch

- GIVEN an insert or update sets `role` to `encargado`, `caja`, or `stock`
- WHEN `branch_id` is NULL
- THEN the CHECK constraint rejects the write

#### Scenario: Admin profile with a non-null branch is now rejected

- GIVEN an insert or update targets a profile with `role = 'admin'`
- WHEN `branch_id` is non-null
- THEN the CHECK constraint rejects the write

### Requirement: Branch Assignment at Invite Time

`preload_employee()` MUST accept a `p_branch_id` parameter and MUST require
a non-null value whenever `p_role` is one of the three newly assignable
branch-scoped roles (`encargado`, `caja`, `stock`) — not only `employee`,
which is no longer assignable to new invites (see `granular-roles`).
Inviting any of these three roles from the admin or encargado UI MUST
require selecting a branch.
(Previously: only `p_role = 'employee'` required a non-null `p_branch_id`.)

#### Scenario: Inviting a branch-scoped role without a branch is rejected

- GIVEN an admin invites a new user with `p_role = 'stock'`
- WHEN no branch is selected
- THEN `preload_employee()` rejects the call

#### Scenario: Inviting a branch-scoped role with a branch succeeds

- GIVEN an admin invites a new user with `p_role = 'caja'` and selects
  branch X
- WHEN `preload_employee()` is called with `p_branch_id = X`
- THEN a profile is pre-created with `branch_id = X`

#### Scenario: Encargado inviting stock is bound to their own branch

- GIVEN an encargado assigned to branch X invites a new `stock` profile
- WHEN `p_branch_id` is anything other than X
- THEN `preload_employee()` rejects the call

### Requirement: Sales RLS Remains Store-Wide

**Superseded by `granular-roles`.** This requirement previously stated that
adding `sales.branch_id` must not tighten `sales` RLS to a branch-only
predicate, so that employees kept reading every sale in their store
regardless of branch. That decision is explicitly reversed by
`granular-roles`: `sales` and `sale_items` now use the Shape D
branch-scoped, verb-split predicate defined in the `role-aware-data-access`
capability. This reversal is stated by the user to be made safe specifically
because production held **zero `sales` rows** at the time of the reversal
(verified directly, 2026-08-29) — there are no pre-branch,
`branch_id IS NULL` sales rows that would be stranded or misclassified by
the new branch-scoped read predicate.
(Previously: `sales` RLS stayed store-wide after `branch_id` was added;
employees read every sale in their store regardless of branch, including
pre-branch rows with a NULL `branch_id`.)

#### Scenario: Caja now sees only their own branch's sales

- GIVEN store A has sales at branches X and Y
- WHEN a `caja` assigned to branch X queries `sales`
- THEN only branch X's sales are returned, not branch Y's

#### Scenario: Admin and superadmin remain store-wide

- GIVEN store A has sales at branches X and Y
- WHEN an `admin` or `superadmin` of store A queries `sales`
- THEN sales from every branch of store A are returned

#### Scenario: Encargado is scoped to their own branch, full access

- GIVEN an encargado assigned to branch X
- WHEN they query, insert, update, or delete `sales` at branch X
- THEN the operation succeeds; the same operation at branch Y is rejected

#### Scenario: No pre-branch NULL-branch_id sales are stranded

- GIVEN production held zero `sales` rows when this reversal was applied
- WHEN the Shape D branch-scoped predicate takes effect
- THEN no existing sale becomes invisible or misattributed, because none
  existed to strand
