# Delta for Role-Aware Data Access

## MODIFIED Requirements

### Requirement: Shape D — Branch-Scoped, Verb-Split Write on Sales

`sales` and `sale_items` writes MUST split by verb so INSERT and
UPDATE/DELETE differ by role, all scoped to `store_id` first:

| Role | SELECT | INSERT | UPDATE/DELETE |
|---|---|---|---|
| `admin` / `superadmin` | all branches | all branches | all branches, unconditionally — exempt from the closed-session condition below |
| `encargado` | own branch | own branch | own branch, AND only if the sale's `cash_session_id IS NULL` or its session is not `closed` |
| `caja` / `employee` | own branch | own branch | own branch, own rows only (`employee_id = auth.uid()`), AND only if the sale's `cash_session_id IS NULL` or its session is not `closed` |
| `stock` | own branch | none | none |

`sale_items` write access MUST mirror its parent `sales` row's branch and
creator, since `sale_items` carries no `employee_id`/`branch_id` of its own.
The `sale_items` UPDATE/DELETE policies' existing `EXISTS (SELECT 1 FROM
public.sales s WHERE s.id = sale_items.sale_id AND s.employee_id = (select
auth.uid()))` subquery (and the equivalent encargado arm) MUST extend to
also require the parent sale's `cash_session_id IS NULL` or its session is
not `closed`, for the `encargado`/`caja`/`employee` arms only. The `admin`/
`superadmin` arm on `sale_items` remains unconditional.
(Previously: UPDATE/DELETE for `encargado`/`caja`/`employee` had no session
or date restriction; a closed, reconciled session's sales and sale_items
could be silently edited by the same roles that created them.)

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

#### Scenario: Caja's UPDATE/DELETE succeeds while the sale's session is open

- GIVEN a caja's own sale is attributed to a session with `status = 'open'`
  at their branch
- WHEN they UPDATE or DELETE that sale
- THEN the operation succeeds, exactly as before this change

#### Scenario: Caja's UPDATE/DELETE is rejected once the sale's session is closed

- GIVEN the same caja's own sale is attributed to a session that is now
  `status = 'closed'`
- WHEN they attempt to UPDATE or DELETE that sale
- THEN zero rows are affected

#### Scenario: Closed-session block extends to the sale's sale_items

- GIVEN a caja's own sale is attributed to a `closed` session
- WHEN they attempt to UPDATE or DELETE that sale's `sale_items` rows
- THEN zero rows are affected, via the extended `EXISTS` subquery

#### Scenario: Admin's UPDATE/DELETE succeeds unconditionally, even on a closed session

- GIVEN any sale, including one attributed to a `closed` session, at any
  branch of the admin's store
- WHEN an `admin` or `superadmin` UPDATEs or DELETEs that sale or its
  `sale_items`
- THEN the operation succeeds, exempt from the closed-session condition
