# Role-Aware Data Access Specification

## Purpose

Close the pre-existing RLS gap on the six tenant tables that carried only a
`store_id` predicate (`categories`, `products`, `product_price_rules`,
`clients`, `sales`, `sale_items`), so the roles defined in `granular-roles`
are database-enforced boundaries, not UI conventions. Also close a
privilege-escalation path in the `profiles` policy's `WITH CHECK`.

## Requirements

### Requirement: Shape C — Store-Wide, Role-Gated Write

`categories`, `products`, and `product_price_rules` MUST be readable by
every role in the store and writable only by `admin`, `superadmin`, and
`encargado`. `clients` MUST follow the same read/write split, except `caja`
(and legacy `employee`) additionally MUST be able to SELECT and INSERT
`clients` rows, without UPDATE or DELETE.

#### Scenario: Every role reads the store's catalog

- GIVEN a `caja`, `stock`, `encargado`, or `admin` profile of store A
- WHEN they SELECT from `categories`, `products`, or `product_price_rules`
- THEN store A's rows are returned

#### Scenario: Caja cannot write to the catalog

- GIVEN an authenticated `caja` profile
- WHEN they attempt to INSERT or UPDATE a `products`, `categories`, or
  `product_price_rules` row
- THEN zero rows are affected

#### Scenario: Encargado can write to the store-wide catalog

- GIVEN an authenticated `encargado` profile
- WHEN they update a product's `sale_price`
- THEN the write succeeds, store-wide, not limited to their branch

#### Scenario: Caja can add a client but not edit or delete one

- GIVEN an authenticated `caja` profile mid-sale
- WHEN they INSERT a new `clients` row
- THEN the insert succeeds
- AND WHEN they attempt to UPDATE or DELETE any `clients` row
- THEN zero rows are affected

### Requirement: Shape D — Branch-Scoped, Verb-Split Write on Sales

`sales` and `sale_items` writes MUST split by verb so INSERT and
UPDATE/DELETE differ by role, all scoped to `store_id` first:

| Role | SELECT | INSERT | UPDATE/DELETE |
|---|---|---|---|
| `admin` / `superadmin` | all branches | all branches | all branches |
| `encargado` | own branch | own branch | own branch |
| `caja` / `employee` | own branch | own branch | own branch, own rows only (`employee_id = auth.uid()`) |
| `stock` | own branch | none | none |

`sale_items` write access MUST mirror its parent `sales` row's branch and
creator, since `sale_items` carries no `employee_id`/`branch_id` of its own.

#### Scenario: Caja voids a sale they created themselves

- GIVEN a `caja` created a sale at their own branch
- WHEN they delete that sale (and its `sale_items`)
- THEN the delete succeeds and the `SECURITY INVOKER` stock-reversal trigger
  fires, restoring stock exactly as it does for an admin edit today

#### Scenario: Caja cannot touch a sale created by a different employee

- GIVEN a caja and a different employee both work at the same branch, and
  the other employee created a sale there
- WHEN the caja attempts to UPDATE or DELETE that sale or its `sale_items`
- THEN zero rows are affected

#### Scenario: Caja's sales visibility is limited to their own branch

- GIVEN store A has sales at branches X and Y
- WHEN a caja assigned to branch X queries `sales`
- THEN only branch X's sales are returned

#### Scenario: Stock role reads but cannot write sales

- GIVEN a `stock` profile assigned to branch X
- WHEN they SELECT `sales` at branch X, THEN rows are returned
- AND WHEN they attempt to INSERT, UPDATE, or DELETE any `sales` or
  `sale_items` row
- THEN zero rows are affected

#### Scenario: Encargado has full sales access at their own branch only

- GIVEN an encargado assigned to branch X, and their store also has branch Y
- WHEN they UPDATE a sale at branch X, THEN it succeeds
- AND WHEN they attempt the same at branch Y
- THEN zero rows are affected

#### Scenario: Orphaned sale with a NULL employee_id is uneditable by any caja

- GIVEN a sale's creating profile was later deleted, setting
  `sales.employee_id` to NULL (`ON DELETE SET NULL`)
- WHEN any `caja` at that branch attempts to UPDATE or DELETE it
- THEN zero rows are affected, since no `auth.uid()` can match a NULL
  `employee_id`; only `admin`, `superadmin`, or the branch's `encargado` can
  still act on it

#### Scenario: A caja's sale insert still decrements stock exactly once

- GIVEN a caja creates a sale with one `sale_items` line at their own branch
- WHEN the insert commits
- THEN the `SECURITY INVOKER` stock-decrement trigger fires exactly once,
  unaffected by the new role/branch predicate on `sale_items`

### Requirement: Profiles Target-Role Privilege-Escalation Closure

The `profiles` UPDATE policy's `WITH CHECK` clause MUST reject any write
whose resulting row `role` is not one the acting user is permitted to
assign to that row's `branch_id`, per the assignment matrix in the
`granular-roles` capability. This applies regardless of whether the acting
user reached the row through the self-row (`id = auth.uid()`) or the
admin/encargado management branch of the policy's `USING` clause.

#### Scenario: Encargado cannot promote a profile to admin via direct write

- GIVEN an encargado authenticated as themselves
- WHEN they issue a direct `UPDATE profiles SET role = 'admin'` against any
  profile in their store, including their own row
- THEN the write is rejected by `WITH CHECK`

#### Scenario: Encargado cannot self-promote to encargado's own tier either

- GIVEN an encargado attempting to set another branch's profile to
  `encargado`
- WHEN the update is issued directly against the table
- THEN it is rejected, since `encargado` may only assign `caja`/`stock`

#### Scenario: Caja cannot escalate their own role via the self-row path

- GIVEN a `caja` profile authenticated as themselves
- WHEN they issue a direct `UPDATE profiles SET role = 'admin'` on their own
  row
- THEN the write is rejected, since `caja` may assign no role at all

#### Scenario: Admin's direct write still succeeds within the matrix

- GIVEN an admin
- WHEN they directly set another profile in their store to `encargado`
- THEN the write succeeds, matching what the RPC already allowed

### Requirement: Stock Ledger RLS Is Unchanged by This Capability

`branch_stock` and `stock_movements` require no new policy. Their existing
Shape B predicate (`role IN ('admin','superadmin') OR branch_id =
get_current_user_branch_id()`, from `store-branches`) already falls through
to the branch-equality clause for every newly introduced branch-scoped role,
so `encargado`, `caja`, and `stock` are already correctly scoped without
modification.

#### Scenario: A new stock role is already scoped correctly

- GIVEN a `stock` profile assigned to branch X
- WHEN they query `branch_stock` or `stock_movements`
- THEN only branch X's rows are returned, via the existing unmodified
  Shape B policy
