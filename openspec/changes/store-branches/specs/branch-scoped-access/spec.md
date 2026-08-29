# Branch-Scoped Access Specification

## Purpose

Bind each employee `profile` to exactly one branch, keep admins floating
across every branch of their store, and provide the access-control primitives
(helper function and RLS predicate contract) that this and future changes use
to restrict data by branch.

## Requirements

### Requirement: Employee Branch Assignment Is Mandatory, Admin Is Branch-Free

`profiles.branch_id` MUST be nullable and MUST reference `branches(id)` with
`ON DELETE RESTRICT`. A CHECK constraint MUST enforce
`role <> 'employee' OR branch_id IS NOT NULL`: every `employee` profile MUST
carry a non-null `branch_id`, while `admin` and `superadmin` profiles MUST be
allowed a NULL `branch_id` so they float across every branch of their store.

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

### Requirement: Current-User Branch Helper

The system MUST provide `get_current_user_branch_id()` as a `SECURITY
DEFINER` function, matching the shape of `get_current_user_store_id()`, that
returns the calling user's `profiles.branch_id` — NULL for admin and
superadmin, non-null for employee.

#### Scenario: Helper returns the employee's own branch

- GIVEN an authenticated employee whose profile has `branch_id = X`
- WHEN `get_current_user_branch_id()` is called
- THEN it returns `X`

#### Scenario: Helper returns NULL for admin

- GIVEN an authenticated admin whose profile has `branch_id` NULL
- WHEN `get_current_user_branch_id()` is called
- THEN it returns NULL

### Requirement: Two-Tier RLS Predicate Contract for Branch-Scoped Tables

This requirement documents the predicate contract future branch-scoped tables
(for example, the Phase 2 stock rework) MUST implement; it does not, by
itself, change the RLS policy of any existing table in this change. A
store-wide table's policy MUST keep the existing
`store_id = get_current_user_store_id()` predicate unchanged. A
branch-scoped table's policy MUST use
`store_id = get_current_user_store_id() AND (get_current_user_role() IN
('admin', 'superadmin') OR branch_id = get_current_user_branch_id())`, so
admins retain unrestricted store-wide access while employees are restricted
to their own branch.

#### Scenario: Store-wide table keeps its existing predicate

- GIVEN a store-wide table already scoped by
  `store_id = get_current_user_store_id()`
- WHEN this change is applied
- THEN that table's RLS policy text is unchanged

#### Scenario: A future branch-scoped table grants admin full store access

- GIVEN a hypothetical branch-scoped table implementing the two-tier
  predicate
- WHEN an admin of store A queries it
- THEN rows from every branch of store A are visible, not only the admin's
  selected branch

#### Scenario: A future branch-scoped table restricts an employee to their branch

- GIVEN a hypothetical branch-scoped table implementing the two-tier
  predicate
- WHEN an employee assigned to branch X queries it
- THEN only rows with `branch_id = X` (within their store) are visible

### Requirement: Branch Assignment at Invite Time

`preload_employee()` MUST accept a `p_branch_id` parameter and MUST require a
non-null value when `p_role = 'employee'`. Inviting an employee from the
admin UI MUST require selecting a branch.

#### Scenario: Inviting an employee without a branch is rejected

- GIVEN an admin invites a new user with `p_role = 'employee'`
- WHEN no branch is selected
- THEN `preload_employee()` rejects the call

#### Scenario: Inviting an employee with a branch succeeds

- GIVEN an admin invites a new user with `p_role = 'employee'` and selects
  branch X
- WHEN `preload_employee()` is called with `p_branch_id = X`
- THEN a profile is pre-created with `branch_id = X`

### Requirement: Employee Branch Reassignment

`update_employee_user()` MUST accept a `p_branch_id` parameter and update an
existing employee profile's `branch_id`. The admin employee-edit UI MUST
expose a branch selector for this purpose.

#### Scenario: Admin reassigns an employee to a different branch

- GIVEN an existing employee profile has `branch_id = X`
- WHEN an admin edits that employee and selects branch Y
- THEN `update_employee_user()` updates the profile's `branch_id` to Y AND
  `get_current_user_branch_id()` returns Y on that employee's next request

### Requirement: Sales Carry a Non-Null Branch Attribution

Every `sales` row inserted through any point-of-sale entry point MUST carry a
non-null `branch_id`, resolved from the acting user's own `branch_id` when
they are an employee, or from the admin's currently-selected branch when they
are an admin. `sales.branch_id` is nullable at the schema level (for
pre-existing rows) but MUST be populated on every new insert regardless of
which payment flow (single or split) or which entry point (employee POS or
admin sale modal) performs the insert.

#### Scenario: Employee sale carries the employee's own branch

- GIVEN an employee assigned to branch X creates a sale, by any payment
  method, from any POS entry point
- WHEN the sale is inserted
- THEN the resulting `sales` row has `branch_id = X`

#### Scenario: Admin sale carries the admin's selected branch

- GIVEN an admin has branch Y selected in the branch selector
- WHEN the admin creates a sale, by any payment method, from any POS entry
  point
- THEN the resulting `sales` row has `branch_id = Y`

### Requirement: Sales RLS Remains Store-Wide

Adding `sales.branch_id` MUST NOT tighten `sales` RLS to a branch-only
predicate in this change. Employees MUST continue to read every sale
belonging to their store, including sales recorded before this change with a
NULL `branch_id`.

#### Scenario: Employee still reads all of their store's sales

- GIVEN store A has sales from multiple branches, including some with a NULL
  `branch_id` recorded before this change
- WHEN an employee of store A queries `sales`
- THEN every sale belonging to store A is returned, regardless of
  `branch_id`
