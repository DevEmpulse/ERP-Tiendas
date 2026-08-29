# Exploration: Multi-Branch Support (store-branches)

## Current State

The schema is single-location-per-tenant end to end. `stores` (`migration.sql:6-10`)
is the only tenant boundary; `profiles.store_id` (`:12-19`) ties every user to exactly
one store with no finer-grained location concept. Every tenant-scoped table
(`clients`, `sales`, `product_price_rules`, `categories`, `products`, `sale_items`)
uses the identical RLS predicate `store_id = public.get_current_user_store_id()`,
backed by the `SECURITY DEFINER` helper `get_current_user_store_id()`
(`:41-48`, `SELECT store_id FROM profiles WHERE id = auth.uid()`). This is the exact
pattern a new `get_current_user_branch_id()` helper must replicate.

`stores` itself carries no address/location fields beyond `name` and
`thermal_paper_width` (`:6-10`, `:440-442`) — so there is no existing precedent to
mirror for a `branches.address` field; none is requested by the user either.

`on_auth_user_created` / `handle_new_user()` (`:246-311`) is the sole bootstrap path:
first-ever login either (a) matches a `preload_employee()`-created dummy profile by
email and re-links it, or (b) checks `allowed_admins`, creates a new `stores` row,
and creates the `admin` profile. Neither path creates or references any location
concept today. `preload_employee()` (`:163-210`) takes `(p_email, p_name, p_role,
p_store_id)` and inserts a profile with no branch reference.

`src/proxy.ts` authorizes purely by role (`admin`/`employee`/`superadmin`) against
route prefixes (`/admin`, `/employee`, `/superadmin`); it has no concept of location
and does not need one — branch is a data-scoping concern inside `/admin/*`, not a
routing concern, since admins and employees already share the same route roots.

No branch/sucursal/location concept exists anywhere in `src/components/admin/`
(grep for `branch|sucursal|location` across that directory returns zero matches
besides incidental `store_id`/`storeId` prop names in `StockView.tsx`,
`SaleModal.tsx`, `ClientManager.tsx`, `UserManager.tsx`). `AdminSidebar.tsx` has no
location selector of any kind. `UserManager.tsx:215-219` is the one call site of
`preload_employee`, currently passing only `p_role: 'employee'` and `p_store_id`.

The paused `stock-phase2-quantities-movements` change (`design.md`, section 14)
designed stock as a single `products.stock_quantity int` column plus an
append-only `stock_movements` ledger, both scoped only by the existing
`store_id` predicate, with:
- `apply_sale_item_stock()` trigger on `sale_items` INSERT/DELETE, resolving
  only `product_id` (no branch concept).
- `adjust_product_stock(p_product_id, p_delta, p_reason, p_note)` RPC, scoped
  only by `product_id`.
- `log_product_opening_stock()` trigger on `products` AFTER INSERT, logging
  opening stock the moment a product row is created with `stock_quantity > 0`.
- `StockView.tsx` redesigned as a two-tab UI ("Productos" / "Precios
  Especiales") with a single Stock column per product.

All of this assumed one stock number per product per store — exactly the
assumption this change invalidates.

`openspec/specs/product-catalog/spec.md` and `sale-line-items/spec.md` (Phase 1,
archived) define the catalog and `sale_items` as store-scoped only; neither
requirement text mentions branches, so nothing there is technically violated by
this change — but both should note the catalog's store-wide (not branch-scoped)
nature was a deliberate choice once branches exist, since "catalog is shared,
stock is branch-scoped" is now an explicit architectural split rather than an
implicit default.

## Affected Areas

- `migration.sql` — new section: `branches` table, `profiles.branch_id` column
  + CHECK constraint, `get_current_user_branch_id()` helper, branch-aware RLS
  predicate additions, `preload_employee()` signature change, `handle_new_user()`
  update (auto-create default branch on new store), possibly
  `update_employee_user()` (reassigning an employee's branch).
- `src/components/admin/UserManager.tsx` — `preload_employee` RPC call (`:215-219`)
  needs a required `p_branch_id` param and a branch-select control when inviting
  an employee.
- `src/components/admin/AdminSidebar.tsx` and its parent shell — needs a minimal
  branch selector control and "current viewing branch" state, held the same way
  `storeId`/`storeName` are already threaded as props today.
- `src/components/admin/StockView.tsx` — the direct near-term consumer once
  Phase 2 resumes; not modified in this change, but its eventual per-branch stock
  column depends on the schema and RLS this change delivers.
- `src/proxy.ts` — reviewed, no change needed (see Current State).
- `docs/authentication-and-roles.md`, `docs/database.md` — need a `branches`
  table entry, an updated role/branch relationship description, and an updated
  RLS policy table.
- `openspec/specs/product-catalog/spec.md`, `sale-line-items/spec.md` — small
  delta notes stating the catalog stays store-wide (not branch-scoped) by design,
  and that `sales`/`sale_items` branch-scoping (if added) does not change existing
  per-sale RLS semantics.
- `openspec/changes/stock-phase2-quantities-movements/design.md` — not modified
  by this change, but every decision below in "Interaction with Paused Phase 2"
  is the exact list `sdd-design` for Phase 2 must revisit once this change lands.

## Approaches

### Fork 1 — RLS scoping pattern for branch-scoped tables

1. **Two-tier RLS: store-wide tables unchanged, branch-scoped tables get a
   combined predicate** — `categories`/`products` keep the verbatim
   `store_id = get_current_user_store_id()` policy; new/future branch-scoped
   tables (`branch_stock`, later `sales`) use
   `store_id = get_current_user_store_id() AND (get_current_user_role() IN
   ('admin','superadmin') OR branch_id = get_current_user_branch_id())`.
   - Pros: matches the user's explicit requirement ("catalog stays store-wide,
     only stock is branch-scoped"); admin gets unrestricted store-wide access
     with no extra RPC; employee is hard-restricted at the DB layer, not just
     the UI.
   - Cons: two RLS predicate shapes now exist in the codebase to keep straight.
   - Effort: Low — directly extends the existing helper-function convention.

2. **Denormalize `branch_id` onto every tenant table, including catalog** —
   force `categories`/`products` to also carry `branch_id` and scope everything
   uniformly.
   - Pros: one RLS shape everywhere.
   - Cons: directly contradicts the user's explicit requirement that the catalog
     is shared across a store's branches; would force duplicate catalog rows per
     branch or a nullable-branch escape hatch that reintroduces the same
     two-tier logic anyway, just less honestly. Rejected.
   - Effort: Medium, and wrong.

3. **No helper function — inline `(SELECT branch_id FROM profiles WHERE id =
   auth.uid())` subquery in every branch-scoped policy** instead of a
   `get_current_user_branch_id()` function.
   - Pros: one fewer function to maintain.
   - Cons: breaks the project's own established convention
     (`get_current_user_store_id()`, `get_current_user_role()`); repeats the
     same subquery text across every future branch-scoped table, more
     error-prone and harder to audit with `get_advisors`. Rejected.
   - Effort: Low, but against convention.

**Recommendation: Approach 1.**

### Fork 2 — Admin's "no branch" vs "current branch" enforcement

1. **`profiles.branch_id` NULL for admin; RLS allows all branches in-store for
   admin; "selected branch" is pure client-side UI state (Recommended)** —
   admin RLS ceiling is store-wide regardless of what the UI selector currently
   shows; the selector only decides which branch's rows a given query/write
   targets, not what the DB permits.
   - Pros: matches the user's literal requirement ("admin sees and manages
     every branch from one account with a selector"); no extra RPC or
     server-side "current branch" state to keep in sync; a future cross-branch
     admin report is trivial (`WHERE store_id = ...` with no branch filter).
   - Cons: an admin-side UI bug could target the wrong branch — no DB-level
     safety net beyond the store boundary.
   - Effort: Low.

2. **Give admin a `current_branch_id` too, enforced server-side, with a
   "switch branch" RPC that updates it before every write** — RLS restricts
   admin to their currently-selected branch, same as an employee.
   - Pros: defense-in-depth against a UI bug.
   - Cons: actively defeats the stated requirement — a cross-branch admin view
     (e.g. "total stock across all my branches") would need a privilege escalation
     path every time; adds an extra RPC and server round-trip to every branch
     switch for a UX the user explicitly described as free-roaming. Rejected for
     this phase; note as a possible future hardening only if an audit
     requirement demands admin least-privilege per branch.
   - Effort: Medium.

**Recommendation: Approach 1.**

## Recommendation

1. **`branches` table** — mirrors `categories` exactly: `id`, `store_id uuid
   NOT NULL REFERENCES stores(id) ON DELETE CASCADE`, `name text NOT NULL CHECK
   (btrim(name) <> '')`, `is_active boolean NOT NULL DEFAULT true`,
   `created_at`/`updated_at timestamptz`. No address/contact field — `stores`
   itself has none, so there is no precedent to mirror and none was requested.

2. **`profiles.branch_id`** — `uuid NULL REFERENCES branches(id) ON DELETE
   RESTRICT` (not `SET NULL`: an employee must never silently lose their
   branch via a branch hard-delete; force reassignment first, matching the
   soft-delete-first convention already used for categories/products).
   Enforce the employee/admin split with a CHECK constraint:
   `CHECK (role <> 'employee' OR branch_id IS NOT NULL)`. Admins and
   superadmins keep `branch_id NULL` and float across branches per Fork 2.

3. **`get_current_user_branch_id()`** — identical shape to
   `get_current_user_store_id()`: `SECURITY DEFINER`, `SET search_path =
   public`, `SELECT branch_id FROM profiles WHERE id = auth.uid()`.

4. **`sales.branch_id`** — add it **additively and nullable now** (schema-only,
   in this change), to avoid the exact "costly migration later" trap the user
   flagged. Whether the *writers* (`sales-form.tsx`, `SaleModal.tsx`) get a
   one-line change to populate it from the acting user's resolved branch (own
   `branch_id` for an employee, selected branch for an admin) is a real scope
   fork that **must be an explicit `sdd-propose` decision**, not decided here:
   leaving the column unpopulated recreates Phase 1's own "dead column, empty
   in every store" mistake (`stock-phase2/exploration.md` risk #1), but
   populating it is a trivial, mechanical, low-risk addition arguably within
   "minimal branch selector" scope already granted by the task. Flagging, not
   deciding.

5. **Bootstrap**: `handle_new_user()` must insert a default branch (e.g.
   `'Sucursal Principal'`) in the same transaction as the new `stores` row,
   before/alongside the admin profile insert, so no store is ever branchless.
   `preload_employee()` signature changes to `(p_email, p_name, p_role,
   p_store_id, p_branch_id)`, with `p_branch_id` required when `p_role =
   'employee'` (mirrors the new CHECK constraint) and optional/ignorable for
   `p_role = 'admin'`. `UserManager.tsx:215-219` must be updated in lockstep or
   employee invites break outright.

6. **Backward compatibility — genuinely unknown, must be confirmed by the
   user, not assumed.** Unlike Phase 1/2's `products`/`stock_movements` (new
   tables, verifiably empty), `stores`/`profiles`/`sales` are original,
   pre-Phase-1 tables with Google OAuth, superadmin whitelisting, employee
   preload, and thermal-printer settings already built — this reads like an
   app with real usage, not a pre-launch skeleton, but this could not be
   verified from static repo files alone. **Assumption to confirm before
   `sdd-propose` finalizes scope**: if any real rows exist, every existing
   store needs a backfilled default branch, and every existing employee
   profile needs `branch_id` backfilled to that branch, before the
   `NOT NULL`-for-employees CHECK constraint can be added — otherwise the
   migration fails outright on the first existing employee row.

7. **Interaction with paused Phase 2 (`stock-phase2-quantities-movements`) —
   exact deltas required, not redesigned here**:
   - `products.stock_quantity` (design.md 14.1) — **removed entirely**,
     replaced by a new `branch_stock` table keyed `(branch_id, product_id)`
     with `current_stock` and `min_stock` columns (per the user's framing;
     note `min_stock` was not in the original Phase 2 scope — Phase 2's
     proposal explicitly deferred thresholds/low-stock alerts to Phase 7 — so
     `sdd-propose` for the Phase 2 rework must state `min_stock` ships as a
     bare column with zero alerting logic, to avoid silent scope creep into
     Phase 7).
   - `stock_movements.product_id` — needs a `branch_id NOT NULL` column added
     (denormalized, same convention as the existing `store_id` denormalization).
   - `stock_movements`/`branch_stock` RLS — the plain `store_id =
     get_current_user_store_id()` predicate becomes the Fork-1 combined
     predicate above.
   - `apply_sale_item_stock()` trigger — must resolve which branch a
     `sale_items` row belongs to. The natural fix (denormalize `branch_id`
     onto `sale_items` too, mirroring how `store_id` is already denormalized
     there) depends on `sales.branch_id` existing, which is why item 4 above
     matters even schema-only.
   - `adjust_product_stock(p_product_id, p_delta, ...)` RPC — becomes
     `adjust_branch_stock(p_branch_id, p_product_id, p_delta, p_reason,
     p_note)`, scoped by the `(branch_id, product_id)` pair.
   - `log_product_opening_stock()` trigger — no longer fires on `products`
     insert, since products no longer carry any stock column; "opening stock"
     becomes an explicit `branch_stock` upsert per branch, meaning a newly
     created product now starts with **zero branches stocked** (a new state
     that didn't exist under the single-column model) until an admin
     explicitly stocks it into one or more branches. This is a real UX change
     Phase 2's rework must design for, not just a schema rename.
   - `StockView.tsx` design — the Stock column/cell and "Ajustar stock" action
     must target `(selected_branch_id, product_id)` instead of a bare
     `product_id`; the product identity form (name/category/prices/barcode)
     stays store-wide and unaffected.
   - The RLS verification plan (cross-tenant probes) gains a parallel
     cross-**branch** probe: an employee of branch A must get RLS-blocked
     reads/writes on branch B's `branch_stock`/`stock_movements`, even within
     the same store.

8. **Explicitly out of scope for this change** (as instructed): stock
   transfers between branches (name it as a future capability —
   `branch-stock-transfer` — pending-transfer accept/reject flow between a
   source and destination branch; do not design the flow); cash register
   (Phase 3, and note `stores.thermal_paper_width` being store-level rather
   than branch-level printer settings is a related future question, not
   addressed here); the redesigned Phase 2 stock schema itself (separate
   change, resumes after this one); any UI beyond a minimal branch
   selector/switcher and the branch CRUD + employee-branch-assignment needed to
   make branches usable at all.

## Risks

- **Unconfirmed production data.** If `stores`/`profiles`/`sales` hold real
  rows, this change requires a backfill migration (default branch per store +
  backfilled `profiles.branch_id`) before the employee `NOT NULL` CHECK can be
  added, or the migration fails on `sdd-apply`. Must be confirmed with the user
  before `sdd-propose`, not discovered at apply time.
- **`sales.branch_id` write-path scope is undecided** (item 4 above). Leaving
  it schema-only repeats Phase 1's "dead column" pattern; populating it pulls
  a code change into a change framed as schema/RLS/selector-only. Needs an
  explicit `sdd-propose` decision.
- **`preload_employee()` is a breaking signature change** — `UserManager.tsx`
  is its only call site today, but it must be updated in the same PR/migration
  window or employee invitations break in production between the migration
  landing and the UI update landing.
- **`min_stock` scope creep** — including it in `branch_stock` now (per the
  task's explicit column list) must be bounded to "plain column, no alerting"
  in the Phase 2 rework, or it silently absorbs Phase 7's stated scope.
- **New "zero branches stocked" product state** — a product can now exist in
  the catalog with no stock row in any branch, a state the single-column
  model never had (NULL vs. integer was the only distinction before). Phase
  2's rework must design the empty-state UI explicitly.
- **Two RLS predicate shapes now coexist** (store-only vs. store+branch
  combined) — must be documented clearly in `docs/database.md` so future
  phases don't default to the wrong one for a new table.

## Ready for Proposal

Yes, with two items the user should resolve before `sdd-propose` finalizes
scope: (1) confirm whether real data exists in `stores`/`profiles`/`sales`
(determines whether a backfill migration is mandatory), and (2) whether
`sales.branch_id` gets its writers updated in this change or ships
schema-only with population deferred. Both are real forks with concrete
consequences, not unilateral calls to make silently.

## Key Learnings

1. `stores` has no address/contact fields today, so a new `branches` table
   has no existing precedent to mirror beyond `categories`' name/is_active shape.
2. `preload_employee()` and `handle_new_user()` are the only two functions that
   create `profiles` rows, so both must gain branch-awareness together to
   avoid orphaned or branch-less employee accounts.
3. Phase 2's `design.md` assumed one stock column per product per store; every
   trigger, RPC, and RLS policy in that design must be re-keyed to
   `(branch_id, product_id)` once this change lands.
4. `src/proxy.ts` needs no changes for branches — branch scoping is a
   data-access concern inside existing `/admin`/`/employee` routes, not a
   routing concern.
5. Whether `stores`/`profiles`/`sales` currently hold real production data
   could not be determined from static repository files and must be confirmed
   by the user before backfill scope is finalized.
