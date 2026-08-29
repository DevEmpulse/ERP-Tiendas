# Store Branches Specification

## Purpose

Introduce `branches` as a per-store location primitive beneath `stores`, so a
store's physical sucursales can be represented, isolated by tenant, and
selected for admin-initiated writes.

## Requirements

### Requirement: Branch Data Model

The system MUST provide a per-store `branches` table with `id`, `store_id`
(NOT NULL, references `stores(id)` ON DELETE CASCADE), `name` (NOT NULL,
non-empty after trimming), `is_active` (NOT NULL, default `true`), and
`created_at`/`updated_at` timestamps.

#### Scenario: Admin creates a branch

- GIVEN an authenticated admin of store A
- WHEN they create a branch named "Sucursal Centro"
- THEN the branch is persisted scoped to store A with `is_active` true

#### Scenario: Blank branch name rejected

- GIVEN an authenticated admin of store A
- WHEN they attempt to create a branch whose name is empty or all whitespace
- THEN the insert is rejected by a constraint

### Requirement: Guaranteed Default Branch Per Store

Every store MUST have at least one branch at all times. Creating a new store
MUST create a default branch named "Sucursal Principal" in the same
transaction as the `stores` row, before or alongside the admin profile
insert.

#### Scenario: New store gets a default branch

- GIVEN a first-time login triggers `handle_new_user()` to create a new store
- WHEN the new `stores` row is inserted
- THEN a "Sucursal Principal" branch is inserted for that store in the same
  transaction, before the transaction commits

### Requirement: Soft Deactivation, Not Hard Delete

Deactivating a branch MUST set `is_active = false` and MUST NOT modify or
remove any `profiles` rows already assigned to it. An inactive branch MUST be
excluded from branch selectors and from new employee/sale assignments. The
database MUST prevent hard-deleting a branch that any `profiles` row still
references, via `ON DELETE RESTRICT` on `profiles.branch_id`.

#### Scenario: Deactivating a branch preserves existing assignments

- GIVEN branch "Sucursal Centro" has two employees assigned to it
- WHEN an admin deactivates "Sucursal Centro"
- THEN `is_active` becomes false AND both employees keep `branch_id` pointing
  to that branch AND neither employee's access is revoked

#### Scenario: Inactive branch excluded from selectors

- GIVEN branch "Sucursal Centro" is inactive
- WHEN an admin opens the branch selector or the employee-invite branch picker
- THEN "Sucursal Centro" does not appear as a selectable option

#### Scenario: Hard-deleting a referenced branch is rejected

- GIVEN branch "Sucursal Centro" has at least one profile with
  `branch_id = 'Sucursal Centro'.id`
- WHEN a hard `DELETE` is attempted against that branch row
- THEN the delete is rejected by the `ON DELETE RESTRICT` foreign key
  constraint

### Requirement: Row-Level Security Isolation for Branches

Every `branches` row MUST be readable and writable only by authenticated
users belonging to that row's `store_id`, via RLS policies using
`store_id = public.get_current_user_store_id()`, matching the existing
pattern on `categories` and `products`.

#### Scenario: Cross-tenant read returns zero rows

- GIVEN a user from store A is authenticated
- WHEN they query `branches` filtered to store B's `id`
- THEN zero rows are returned

#### Scenario: Cross-tenant write is rejected

- GIVEN a user from store A is authenticated
- WHEN they attempt to insert or update a `branches` row carrying store B's
  `store_id`
- THEN the write is rejected by the RLS policy's WITH CHECK clause

### Requirement: Admin Branch Selector Always Targets One Active Branch

The admin UI MUST maintain a "currently selected branch" state that always
resolves to exactly one concrete active branch of the admin's store. No
selector option MUST represent "all branches" in this change. The selector
MUST default to the store's first active branch when no prior selection
exists.

#### Scenario: Selector defaults to an active branch

- GIVEN an admin with no prior branch selection logs in
- WHEN the admin dashboard loads
- THEN exactly one active branch of that admin's store is selected by default

#### Scenario: No "all branches" option is offered

- GIVEN an admin opens the branch selector
- WHEN the list of options is rendered
- THEN every option is one concrete active branch, and no option represents
  "all branches"

### Requirement: Branch CRUD from the Admin UI

Admins MUST be able to create, rename, and deactivate branches of their own
store from the admin UI. Admins MUST NOT be able to create, rename, or
deactivate a branch belonging to another store.

#### Scenario: Admin renames a branch

- GIVEN branch "Sucursal Centro" belongs to the admin's store
- WHEN the admin renames it to "Sucursal Centro Norte"
- THEN the branch's `name` is updated and its `id` and `store_id` are
  unchanged
