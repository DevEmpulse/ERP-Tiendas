# Granular Roles Specification

## Purpose

Widen `profiles.role` from `admin | employee | superadmin` to a six-value
store-level role ladder (`admin | encargado | caja | stock | employee |
superadmin`), define who may assign which role to whom, and gate the new
`/encargado` and split `/employee` route surfaces by role. `superadmin`
remains an untouched, cross-store platform tier. `role-aware-data-access`
covers the resulting tenant-table RLS predicates; this capability covers the
role model, the assignment matrix, and routing.

## Requirements

### Requirement: Six-Value Role Ladder with a Non-Assignable Legacy Value

`profiles_role_check` MUST accept exactly
`admin | encargado | caja | stock | employee | superadmin`. `encargado`,
`caja`, and `stock` MUST be newly assignable on invite. `employee` MUST
remain a valid value for existing rows but MUST NOT be assignable to any new
invite. `superadmin` MUST be unaffected.

#### Scenario: New invite cannot select the legacy employee role

- GIVEN an admin or encargado is inviting a new user
- WHEN they submit a role of `employee`
- THEN `preload_employee()` rejects the call

#### Scenario: Existing employee row remains valid under the widened constraint

- GIVEN a profile row already has `role = 'employee'`
- WHEN `profiles_role_check` is widened to the six-value set
- THEN that row continues to satisfy the constraint with no update required

#### Scenario: Each newly assignable role is accepted

- GIVEN an admin invites a new profile
- WHEN the role is `encargado`, `caja`, or `stock`
- THEN the insert satisfies `profiles_role_check`

### Requirement: Every Branch-Scoped Role Requires a Branch

The generalized `profiles_employee_branch_check` MUST require a non-null
`branch_id` for `encargado`, `caja`, `stock`, and `employee`, and MUST
require a NULL `branch_id` for `admin` and `superadmin`. The exact
constraint text and its migration from the single-role `employee` check are
defined authoritatively in the `branch-scoped-access` capability's MODIFIED
requirement of the same name; this capability depends on that invariant
holding for every role it defines.

#### Scenario: A branch-scoped role without a branch is rejected

- GIVEN an insert or update sets `role = 'stock'`
- WHEN `branch_id` is NULL
- THEN the CHECK constraint rejects the write

#### Scenario: Admin or superadmin with a branch is rejected

- GIVEN an insert or update sets `role = 'admin'`
- WHEN `branch_id` is non-null
- THEN the CHECK constraint rejects the write

### Requirement: Role Assignment Matrix

The three employee-management RPCs (`preload_employee`,
`update_employee_user`, `delete_employee_user`) MUST enforce:

| Caller | May assign | Branch scope |
|---|---|---|
| `superadmin` | any role | cross-store (unchanged) |
| `admin` | `admin`, `encargado`, `caja`, `stock` | any branch in own store |
| `encargado` | `caja`, `stock` only | own branch only |
| `caja` / `stock` | none | — |

#### Scenario: Admin assigns any allowed role at any branch of their store

- GIVEN an admin of store A, which has branches X and Y
- WHEN they invite a new `encargado` at branch Y
- THEN the call succeeds

#### Scenario: Encargado assigns caja or stock at their own branch only

- GIVEN an encargado assigned to branch X
- WHEN they invite a `caja` at branch X
- THEN the call succeeds

#### Scenario: Encargado cannot assign encargado or admin

- GIVEN an encargado assigned to branch X
- WHEN they attempt to invite or promote a profile to `encargado` or `admin`
- THEN the call is rejected

#### Scenario: Encargado cannot target another branch

- GIVEN an encargado assigned to branch X, and their store also has branch Y
- WHEN they attempt to invite a `caja` at branch Y
- THEN the call is rejected

#### Scenario: Caja and stock cannot assign any role

- GIVEN an authenticated `caja` or `stock` profile
- WHEN they call any of the three employee-management RPCs
- THEN the call is rejected

### Requirement: Route Gating for `/encargado` and `/employee`

`/encargado` MUST be reachable only by profiles with `role = 'encargado'`.
`/employee` MUST be reachable by `admin`, `caja`, `stock`, and `employee`,
but NOT by `encargado`. On `/employee`, a `stock` profile MUST land on the
stock-adjustment view and MUST NOT reach the sales form; a `caja` or
`employee` profile MUST land on the sales form and MUST NOT reach the
stock-adjustment view. Both `src/proxy.ts`'s route matcher and each page's
own client-side re-check MUST enforce this identically.

#### Scenario: Encargado is redirected away from /employee

- GIVEN an authenticated `encargado`
- WHEN they navigate to `/employee`
- THEN they are redirected away, not shown either the sales form or the
  stock-adjustment view

#### Scenario: Stock profile lands on the stock-adjustment view

- GIVEN an authenticated `stock` profile
- WHEN they land on `/employee`
- THEN they see the stock-adjustment view scoped to their own branch, with
  no way to reach the sales form

#### Scenario: Caja profile lands on the sales form

- GIVEN an authenticated `caja` profile
- WHEN they land on `/employee`
- THEN they see the sales form, with no way to reach the stock-adjustment
  view

### Requirement: Legacy Employee Zero-Behavior-Change Guarantee

The existing `employee` account MUST continue to work with zero behavioral
change from before this capability: the same login redirect, the same POS
access, and the same data visibility — mapped as `caja`-equivalent access
everywhere a role branch exists — unless an admin explicitly reassigns its
role through `UserManager`'s edit flow.

#### Scenario: Legacy employee account is unaffected by this change

- GIVEN the one existing `employee` profile, untouched by this change
- WHEN it logs in and uses the POS after this capability ships
- THEN its redirect target, reachable routes, and sales visibility are
  identical to before this change

#### Scenario: Admin voluntarily reassigns the legacy employee's role

- GIVEN the existing `employee` profile
- WHEN an admin edits it in `UserManager` and selects `caja`
- THEN `update_employee_user()` updates its role and it behaves as a `caja`
  profile from that point on
