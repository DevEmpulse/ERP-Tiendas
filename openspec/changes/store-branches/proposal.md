# Proposal: Multi-Branch Support (store-branches)

## Intent

A store is one physical location today: `stores` is the only tenant boundary and
every tenant table scopes by `store_id` alone (`migration.sql:40-48`). Owners run
several sucursales, each with its own stock and (later) cash register, and each
employee works at exactly one. Without a branch primitive, stock cannot be counted
per location, and `stock-phase2-quantities-movements` is blocked — its design
assumed a single `products.stock_quantity` per store. This change adds the branch
entity, its access model, and only enough UI to make branches usable.

## Scope

### In Scope

- `public.branches` (per-store `name`, `is_active`, timestamps) + RLS — mirrors
  `categories`. No address/contact fields; `stores` itself has none.
- `profiles.branch_id uuid NULL REFERENCES branches(id) ON DELETE RESTRICT` plus
  `CHECK (role <> 'employee' OR branch_id IS NOT NULL)`. Admins and superadmins
  stay NULL and float across every branch of their store.
- `get_current_user_branch_id()` — SECURITY DEFINER helper, identical shape to
  `get_current_user_store_id()`.
- **Two-tier RLS contract** (documented, not yet applied to an existing table):
  store-wide tables keep `store_id = get_current_user_store_id()`; branch-scoped
  tables use that AND `(get_current_user_role() IN ('admin','superadmin') OR
  branch_id = get_current_user_branch_id())`. Phase 2 is its first consumer.
- `sales.branch_id uuid NULL REFERENCES branches(id)`, **populated on every insert**
  by `sales-form.tsx` and `SaleModal.tsx` (employee → own `branch_id`; admin →
  selected branch). Recorded for attribution; `sales` RLS stays store-wide.
- Bootstrap: `handle_new_user()` creates a default branch ("Sucursal Principal")
  in the same transaction as a new `stores` row. `preload_employee()` gains
  `p_branch_id`, required when `p_role = 'employee'`; its one call site
  (`UserManager.tsx:215-219`) is updated in lockstep with a branch select.
- Minimal admin UI: a branch selector holding client-side "currently viewing
  branch" state, plus branch create / rename / deactivate.
- Employee branch reassignment: `update_employee_user()` gains `p_branch_id`;
  the employee edit form gets a branch select. Fixing a mis-assigned employee
  no longer requires delete + re-invite.

### Out of Scope

Stock transfers between branches (future `branch-stock-transfer`); cash register
(Phase 3, including whether `stores.thermal_paper_width` becomes per-branch); the
Phase 2 stock redesign itself (`branch_stock`, `min_stock`, re-keyed triggers and
RPC) — a separate change that resumes after this one lands; branch management UI
beyond CRUD + selector; server-enforced "current branch" for admins; tightening
`sales` RLS to branch-only reads.

**Granular roles (encargado / caja / stock) — deferred to the next change.**
The user requested a 4-role model (admin, encargado de sucursal, caja, stock)
during this proposal's review. This is the "Phase 5: granular roles" item from
Phase 1's original roadmap, now explicitly sequenced to start immediately after
`store-branches` lands (branches must exist first, since `encargado` is
inherently branch-scoped). This change ships `admin`/`employee` exactly as
today, with `employee.branch_id` already in place as the foundation the next
phase builds on. Three product decisions were made now, for that phase to
consume rather than re-litigate:
1. **`encargado`** has full control of their own branch: sales, stock, caja,
   *and* employee management (invite/edit/deactivate) scoped to that branch —
   functionally an admin restricted to one branch.
2. **`caja` and `stock` are separate, exclusive roles**, not combinable
   permissions: `profiles.role` will admit exactly one of
   `admin | encargado | caja | stock`. A `caja` employee has no stock
   access and vice versa.
3. Both are deferred, not designed here — no `profiles.role` CHECK, RLS, or
   `/employee` navigation change happens in this change.

## Capabilities

### New Capabilities

- `store-branches`: per-store branch entity, lifecycle (create/rename/deactivate),
  guaranteed default branch per store, tenant-isolated RLS, admin branch selector.
- `branch-scoped-access`: `profiles.branch_id` with the employee/admin split,
  `get_current_user_branch_id()`, the two-tier RLS predicate contract, branch
  assignment at invite time, and branch attribution on `sales`.

### Modified Capabilities

- `product-catalog`: the RLS isolation requirement gains an explicit statement
  that categories and products stay **store-wide by design** now that branches
  exist — a deliberate architectural split, no longer an implicit default.
- `sale-line-items`: unchanged. `sale_items` semantics and per-sale RLS are not
  affected; only the parent `sales` row gains a nullable `branch_id`.

## Approach

Append **section 14** to root `migration.sql` (14 is unclaimed: Phase 2's design
reserved it but never applied, so the reworked Phase 2 takes 15). Additive and
ordered: create `branches` + RLS, add `profiles.branch_id` and its CHECK (no
backfill — the user confirmed zero production rows), add the helper, replace
`preload_employee()` and `handle_new_user()`, then add `sales.branch_id`.

The two-tier predicate ships as a helper plus written contract, not as a rewrite
of existing policies. Applying it to `sales` now would hide every pre-branch
(NULL `branch_id`) sale from employees and silently change what they can read —
a behavior change this change does not need.

UI threads the selected branch the same way `storeId`/`storeName` are already
threaded as props. `src/proxy.ts` needs no change: branch is data scoping inside
the existing `/admin` and `/employee` routes, not a routing concern.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `migration.sql` | Modified | New section 14: `branches`, `profiles.branch_id` + CHECK, helper, `preload_employee()`, `handle_new_user()`, `sales.branch_id` |
| `src/components/admin/UserManager.tsx` | Modified | Branch select on invite (`preload_employee` gains `p_branch_id`, `:215-219`) and on edit (`update_employee_user` gains `p_branch_id`) |
| `src/components/admin/AdminSidebar.tsx` + admin shell | Modified | Branch selector control and current-branch state |
| `src/components/admin/BranchManager.tsx` | New | Branch create / rename / deactivate |
| `src/components/admin/SaleModal.tsx` | Modified | Write `branch_id` on both insert paths (`:407`, `:425`) |
| `src/components/employee/sales-form.tsx` | Modified | Write `branch_id` on both insert paths (`:381`, `:400`) |
| `docs/database.md`, `docs/authentication-and-roles.md` | Modified | `branches` entry, role/branch matrix, both RLS predicate shapes |
| `src/proxy.ts` | Unchanged | Reviewed; no routing change needed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `preload_employee()` signature change breaks employee invites | High | Ship SQL and `UserManager.tsx` in the same window; verify an invite end-to-end after apply |
| Two RLS predicate shapes coexist; a future table picks the wrong one | Med | Document both in `docs/database.md` with an explicit "which shape for a new table" rule |
| Admin UI targets the wrong branch (no DB safety net above store level) | Med | Selector always shows one concrete active branch; accepted tradeoff of the admin-floats model |
| A missed `sales` insert path leaves `branch_id` NULL | Med | All four sites enumerated above; verify one sale as employee and one as admin |
| Phase 2 scope (`branch_stock`, `min_stock`) creeps in here | Med | Named in Out of Scope; no stock table or column is touched by this change |
| Combined SQL + 5 components + docs exceeds the 400-line review budget | Med | `sdd-tasks` forecasts; slice as schema → sales writers → branch UI if high |

## Rollback Plan

Reverse section 14 with a `down` script committed alongside it: drop the employee
CHECK, `alter table public.profiles drop column branch_id`, `alter table
public.sales drop column branch_id`, `drop function
public.get_current_user_branch_id()`, `drop table public.branches cascade`, and
restore the 4-argument `preload_employee()` and the pre-branch `handle_new_user()`
bodies. No existing policy is rewritten and no sales history is touched, so
rollback leaves the current POS fully functional. Revert the UI commits together
with the SQL — a rolled-back schema with branch-aware writers breaks every sale
insert.

## Dependencies

- Zero production rows in `stores`/`profiles`/`sales` (user-confirmed). If real
  data appears before apply, a backfill (default branch per store + backfilled
  `profiles.branch_id`) becomes mandatory *before* the CHECK constraint.
- Supabase MCP `execute_sql`; `get_advisors` run after apply.
- **Blocks `stock-phase2-quantities-movements`.** That change's design, specs, and
  tasks are reworked against this branch model only after this one lands.

## Success Criteria

- [ ] Every store has at least one branch; a newly registered store gets
      "Sucursal Principal" automatically in the same transaction.
- [ ] The CHECK rejects an `employee` profile without a `branch_id`; admin and
      superadmin profiles are accepted with `branch_id` NULL.
- [ ] `get_current_user_branch_id()` returns the employee's branch and NULL for
      an admin, and a cross-tenant read of `branches` returns zero rows.
- [ ] Inviting an employee requires choosing a branch and succeeds through
      `UserManager.tsx`; branch create/rename/deactivate work from the admin UI.
- [ ] Reassigning an existing employee's branch from the edit form succeeds and
      is reflected by `get_current_user_branch_id()` on their next request.
- [ ] Every new sale carries a non-null `branch_id` — from the employee POS and
      from both admin `SaleModal` paths (single and split payment).
- [ ] Employees still see their store's existing sales (no RLS regression);
      catalog reads are unchanged for every role.
- [ ] `npm run build` passes; `get_advisors` reports no new security findings.
- [ ] Phase 2 can resume: `branch_id`, the helper, and the documented branch-scoped
      RLS predicate are all available for `branch_stock`/`stock_movements`.

## Proposal question round — RESOLVED (user decision)

The two decisive forks (production data, `sales.branch_id` write path) were
resolved first. A second round covered the remaining business rules:

1. **Employees keep seeing all of their store's sales, not just their branch's.**
   `sales.branch_id` is written for attribution and future reporting; `sales` RLS
   is not tightened here. Tightening it is a real product decision (it also hides
   pre-branch NULL rows) and belongs in its own change. *(stands as proposed)*
2. **The branch selector has no "All branches" option in this slice.** Exactly one
   concrete active branch is always selected, defaulting to the first active one,
   so every admin-made sale has a branch. A consolidated cross-branch view is
   later work. *(stands as proposed)*
3. **Reassigning an existing employee to a different branch is included** (→
   moved into In Scope above): `update_employee_user()` gains `p_branch_id`, and
   the employee edit form gets a branch select.
4. **Deactivating a branch is soft and non-destructive.** `is_active = false`
   removes it from selectors and new assignments but does not touch employees
   already assigned to it, and `ON DELETE RESTRICT` prevents hard-deleting a
   branch any profile still references. *(stands as proposed)*

A fifth, larger question surfaced during this round and is resolved separately
under "Granular roles — deferred to the next change" above: a 4-role model
(`admin`/`encargado`/`caja`/`stock`) is wanted, but sequenced as the change
immediately following this one, not folded into it.
