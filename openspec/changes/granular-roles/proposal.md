# Proposal: Granular Roles (admin | encargado | caja | stock)

## Intent

`profiles.role` admits exactly three values today —
`CHECK (role IN ('admin','employee','superadmin'))` (`migration.sql:215`) — so a store
owner has one lever: full admin, or a point-of-sale terminal. There is no way to put
someone in charge of one sucursal, and no way to give a stockroom person inventory
access without also handing them the register, the client list, and the price catalog.
`store-branches` shipped the branch primitive this needs (`profiles.branch_id`,
`get_current_user_branch_id()`, Shape B RLS); the roles that were deferred there are now
unblocked.

Worse, the existing admin/employee split is **not a security boundary at all** for most
data. `clients`, `sales`, `categories`, `products`, `sale_items` and
`product_price_rules` all carry a single `FOR ALL` policy whose only predicate is
`store_id = public.get_current_user_store_id()` (`migration.sql:91-107`, `:434-437`,
`:498-513`). Any authenticated profile in the store can write to every one of them
directly through the Supabase client, regardless of what the UI renders. Adding
`caja`/`stock` as *mutually exclusive* roles is meaningless while that holds, so
closing this gap is core scope here, not a follow-up.

## Scope

### In Scope

**A. Role model**

- `profiles_role_check` widens to
  `admin | encargado | caja | stock | employee | superadmin`.
  `encargado`/`caja`/`stock` are newly assignable; `employee` becomes a **valid but
  non-assignable legacy value**; `superadmin` is untouched.
- **Legacy `employee` maps to `caja`-equivalent access everywhere a role branch
  exists.** No forced migration of the one real production account
  (`matiasbangher06@gmail.com`). `UserManager`'s edit flow gains a role select so an
  admin can reassign it deliberately, at their own pace.
- `profiles_employee_branch_check` (`migration.sql:717-719`) generalizes from
  `role <> 'employee'` to *every* branch-scoped role: `encargado`, `caja`, `stock`,
  `employee` all require a non-null `branch_id`; `admin`/`superadmin` stay NULL.

**B. Who may assign which role, to whom**

| Caller | May assign | Branch scope |
|---|---|---|
| `superadmin` | any | cross-store (unchanged) |
| `admin` | `admin`, `encargado`, `caja`, `stock` | any branch in own store |
| `encargado` | `caja`, `stock` only | **own branch only** |
| `caja` / `stock` | none | — |

Enforced in `preload_employee()`, `update_employee_user()` and
`delete_employee_user()`, whose caller checks are all literally
`role = 'admin' AND store_id = …` today (`:596-599`, `:642-645`, `:331-336`), and —
newly — in the `profiles` RLS policy itself (see D).

**C. Route surfaces**

- **New `/encargado/*` route tree** (exploration Approach 2): one page importing the
  existing branch-parameterized `DashboardView` / `HistoryView` / `SaleModal` /
  `StockView` / `StaffManagementView` / `ClientManager`, with `branchId` **locked** to
  the encargado's own `branch_id` — no selector, there is nothing to select. Excludes
  `BranchManager` and `StoreSettingsView` (store-wide, admin/superadmin only).
  Includes full `ClientManager` access, unfiltered (`clients` has no `branch_id`).
- **`/employee/*` internal dispatch** (Approach 3): one route, branching on
  `profile.role` between the existing `SalesForm` (`caja` + legacy `employee`) and a
  **new stock-adjustment view** for `stock` — this view does not exist today. It
  reuses `StockView`'s adjustment dialog scoped to the user's own branch, **without**
  product-catalog editing (that stays admin/encargado).

**D. Role-aware RLS on the six role-blind tables**

Two new predicate shapes, extending `store-branches`' documented Shape A/Shape B
vocabulary:

- **Shape C (store-wide, role-gated write)** — `categories`, `products`,
  `product_price_rules`, `clients`: read for every role in the store; write for
  `admin`/`superadmin`/`encargado`.
- **Shape D (branch-scoped, verb-split)** — `sales`, `sale_items`: `FOR ALL` splits
  into per-verb policies so INSERT and UPDATE/DELETE can differ by role.
  `admin`/`superadmin` full store-wide; `encargado` full at own branch; `caja` (and
  legacy `employee`) SELECT + INSERT + **UPDATE/DELETE restricted to sales they
  themselves created** (`employee_id = auth.uid()`), all scoped to their own branch;
  `stock` read-only at own branch, no write of any kind.
  **New UI requirement**: today's `sales-form.tsx` (employee POS) is create-only —
  there is no edit/void affordance anywhere under `/employee/*`. This capability must
  be built, not just unlocked at the RLS layer: a caja needs a way to find one of
  their own recent sales and correct or void it. Scope this narrowly (their own
  branch's recent sales, not the admin's full `SalesTable`/`SaleModal` reused
  verbatim) — `sdd-design` decides the concrete UI, but it is real, new scope, not a
  side effect of the RLS change.

`branch_stock` and `stock_movements` need **no change** — Shape B's
`role IN ('admin','superadmin') OR branch_id = get_current_user_branch_id()`
(`:851-890`) already covers any new branch-scoped role by falling through to the
branch comparison.

**E. `profiles` privilege-escalation fix**

Policy `"Admins can manage profiles in the same store"` (`:79-83`) guards role changes
with nothing but `get_current_user_role() = 'admin'`. Widening it to admit `encargado`
without constraining the **target row's** role would let an encargado promote anyone
— including themselves — to `admin` by direct table write. Its `WITH CHECK` must
therefore validate the target role against the same matrix as (B), and restrict an
encargado to rows in their own branch. Today this path is unused (the UI only calls
the RPCs), but closing the data-access gap means it must actually hold.

**F. Named follow-up task, minimal:** `adjust_branch_stock()` hard-rejects
`role NOT IN ('admin','superadmin')` (`:994-996`), which would leave every new
`stock`/`encargado` profile unable to adjust stock at all. Widen the role list and add
the branch-ownership check the function already performs for `p_branch_id`. **No other
redesign of that RPC.**

### Out of Scope

- Cash register / caja session UI beyond the role's name and its existing sales-entry
  access — Phase 3.
- Barcode scanning at POS — Phase 4. Analytics/reporting — Phase 7.
- Any `adjust_branch_stock` change beyond the role-list + branch-check widening in (F).
- `superadmin` behaviour, `allowed_admins`, and the `branches` write policy
  (`:555-560`) — encargado is deliberately excluded from branch CRUD.
- A forced migration of the existing `employee` row.
- Permission *combinations*: `caja` and `stock` stay mutually exclusive, one value in
  one column.

## Capabilities

### New Capabilities

- `granular-roles`: the six-value role ladder, the legacy-`employee` compatibility
  rule, the branch requirement per role, the who-may-assign-what matrix enforced in
  all three employee RPCs, and the `/encargado` + `/employee` route gating.
- `role-aware-data-access`: Shape C and Shape D predicates, replacing the store-only
  RLS on the six previously role-blind tenant tables, plus the target-role `WITH CHECK`
  on `profiles`.

### Modified Capabilities

- `branch-scoped-access`: *Sales RLS Remains Store-Wide* changes — `sales` becomes
  branch-scoped for `encargado`/`caja`/`stock` under Shape D. The employee branch CHECK
  generalizes to all four branch-scoped roles, and invite-time branch assignment now
  covers three assignable branch roles instead of one.
- `product-catalog`: catalog write access narrows from "any authenticated member of the
  store" to `admin`/`superadmin`/`encargado`; reads stay open to the whole store.
- `sale-line-items`: `sale_items` RLS gains the role/branch predicate; the
  `SECURITY INVOKER` stock triggers must keep working for every role permitted to
  insert a line.

## Approach

Append **section 16** to root `migration.sql` (15 is `stock-phase2`), ordered so a
partial apply never locks anyone out: widen `profiles_role_check` first, then the RPC
role lists, then the six tables' policies, then the `profiles` policy rewrite, and the
generalized branch CHECK **last** (mirroring 14.9's deliberate ordering).

Every new `admin`-level predicate keeps pairing `'admin'` with `'superadmin'`, per the
convention already established at `:556`, `:856`, `:876`, `:887`, `:994`. Every role
list that mentions `'caja'` also mentions `'employee'` — that pairing *is* the legacy
compatibility rule, expressed in SQL rather than in a migration script.

The UI reuses the existing components rather than duplicating them: they are already
`branchId`-parameterized props (`DashboardView`, `HistoryView`, `SaleModal`,
`StockView`), which is exactly what makes a branch-locked route tree cheap. A dedicated
`/encargado` page makes what an encargado can reach **enumerable from one file's
imports**, instead of scattering role conditionals through the 537-line admin page.

**Two independent gates must move together**: `src/proxy.ts`'s prefix matcher *and*
each page's own client-side re-check (`admin/page.tsx` re-checks
`role !== 'admin'`; `employee/page.tsx` re-checks `role !== 'employee' && role !== 'admin'`).
A role that passes one but not the other is an access-control bug, not a UX wrinkle.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `migration.sql` | Modified | New section 16: role CHECK, generalized branch CHECK, Shape C/D policies on 6 tables, `profiles` policy rewrite, 3 employee RPCs, `adjust_branch_stock` role widening, rollback block |
| `src/proxy.ts` | Modified | `isProtectedRoute` gains `/encargado`; login/root redirect maps `encargado`; `/admin` gate stays admin-only; `/employee` gate accepts `caja`/`stock`/`employee` |
| `src/app/encargado/page.tsx` | New | Branch-locked shell + `EncargadoSidebar`, importing existing views |
| `src/app/admin/page.tsx` | Modified | `Profile.role` union; hardcoded `role !== 'admin'` re-check |
| `src/app/employee/page.tsx` | Modified | Role re-check; dispatch caja vs stock |
| `src/components/employee/employee-dashboard.tsx` | Modified | Role-based view dispatch |
| `src/components/employee/StockAdjustmentView.tsx` | New | Own-branch stock adjustment, no catalog editing |
| `src/components/employee/sales-form.tsx` or a new sibling component | Modified/New | Caja gains a way to find and correct/void one of their own recent sales at their own branch — does not exist today |
| `src/components/admin/UserManager.tsx` | Modified | Role select on invite (replacing hardcoded `p_role: 'employee'`) and on edit; caller-scoped option list; role badges |
| `src/components/admin/AdminSidebar.tsx` | Modified | Extracted/filtered menu list reused by `EncargadoSidebar` |
| `docs/authentication-and-roles.md`, `docs/database.md` | Modified | Role matrix, Shape C/D predicates |
| `openspec/specs/product-catalog`, `sale-line-items` | Modified | Delta specs |
| `branch_stock` / `stock_movements` policies | Unchanged | Shape B already covers new branch-scoped roles |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Encargado self-promotes to `admin` via direct `profiles` write | High if unguarded | Target-role `WITH CHECK` mirroring the assignment matrix, added in the same statement that widens the policy — never widen first and constrain later |
| `proxy.ts` and the per-page re-check drift apart | Med | Enumerated as one task; verify each of the 4 roles against both gates after apply |
| New RLS blocks a path the UI relies on today (e.g. the POS creating a client, or `SECURITY INVOKER` stock triggers firing on a caja's `sale_items` insert) | High | Probe every write path per role on the dev branch before production; Shape B already falls through to branch equality for the trigger targets |
| `adjust_branch_stock` follow-up slips, leaving `stock` unable to adjust stock | Med | It is a named in-scope task (F) with its own success criterion, not a future change |
| Generalized branch CHECK rejects an existing row | Low | 4 profiles verified (2 admin, 1 employee w/ backfilled branch, 1 superadmin); CHECK applied last; re-verify counts immediately before apply |
| Cascade deletes on `sale_items` behave differently under verb-split policies | Med | FK cascade is not RLS-filtered, but `sdd-design` must state this explicitly and the admin delete path must be re-tested |
| SQL + new route tree + new stock view + UserManager rework far exceeds the 400-line budget | High | `sdd-tasks` slices: (1) role model + RPCs, (2) RLS closure, (3) `/encargado`, (4) `/employee` split + UserManager |

## Rollback Plan

Section 16 ships with an explicit `down` block, reversed bottom-to-top: restore
`profiles_employee_branch_check` to `role <> 'employee' OR branch_id IS NOT NULL`;
restore the six tables' single `FOR ALL` store-only policies verbatim from `:91-107`,
`:434-437`, `:498-513`; restore the `profiles` policy from `:79-83`; restore the
section-14 bodies of `preload_employee`/`update_employee_user` and the section-9
`delete_employee_user`; restore `adjust_branch_stock`'s `IN ('admin','superadmin')`
check; and narrow `profiles_role_check` back to `('admin','employee','superadmin')`
— **which requires reassigning any profile created with a new role first**, so the
down script must fail loudly rather than silently drop the constraint. Revert the UI
commits together with the SQL: a rolled-back schema with an `/encargado` route live
produces a route nobody can pass. Snapshot before applying to production.

## Dependencies

- **`store-branches` applied** — `branches`, `profiles.branch_id`,
  `get_current_user_branch_id()`, Shape B. Confirmed live.
- **`stock-phase2-quantities-movements` applied** — `branch_stock`,
  `stock_movements`, `adjust_branch_stock()`, `sale_items.branch_id`. Confirmed live.
- Production state verified directly (2026-08-29): 3 stores, 4 profiles (2 `admin`,
  1 `employee`, 1 `superadmin`), 4 branches, 26 products, **0 sales**. The zero-sales
  count is what makes tightening `sales` RLS safe — there are no pre-branch
  `branch_id IS NULL` rows to strand.
- Supabase dev branch for apply/verify; `execute_sql` and `get_advisors`.

## Success Criteria

- [ ] `profiles_role_check` accepts all six values; the generalized branch CHECK
      rejects an `encargado`/`caja`/`stock` profile with a NULL `branch_id` and accepts
      `admin`/`superadmin` with NULL.
- [ ] The existing `employee` account keeps working with **zero** behavioural change:
      same login redirect, same POS form, same data visibility as before.
- [ ] An admin can invite `admin`/`encargado`/`caja`/`stock` at any branch of their
      store, and can reassign the legacy `employee` account's role from the edit form.
- [ ] An encargado can invite only `caja`/`stock`, only at their own branch; attempts
      to assign `encargado`/`admin`, or to target another branch, are rejected by the
      **database**, not just hidden in the UI.
- [ ] A `caja` profile issuing a direct Supabase write to `products`, `categories`,
      `product_price_rules` or another branch's `sales` gets zero rows affected.
- [ ] A `stock` profile cannot insert into `sales`/`sale_items` at all, by any path.
- [ ] An encargado promoting any profile (including their own) to `admin` via a direct
      `profiles` update is rejected.
- [ ] `/encargado` is reachable only by `encargado`; `BranchManager` and
      `StoreSettingsView` are unreachable from it by URL as well as by menu.
- [ ] A `stock` user landing on `/employee` gets the stock-adjustment view and cannot
      reach the sales form; a `caja` user gets the sales form and cannot reach stock.
- [ ] A `stock` and an `encargado` profile can each successfully call
      `adjust_branch_stock` for their own branch, and are rejected for another branch.
- [ ] A sale created by a `caja` still decrements that branch's stock exactly once
      (the `SECURITY INVOKER` triggers still pass under the new policies).
- [ ] A `caja` can correct or void a sale they created themselves (stock reverses
      correctly on delete, same trigger path as an admin edit today), but cannot
      touch a sale created by a different employee, even at their own branch.
- [ ] `npm run build` passes; `get_advisors` reports no new security findings.

## Proposal question round — RESOLVED (user decision)

Six decisions already resolved in `state.yaml` were not re-opened: admin may still
invite another admin; encargado gets full `ClientManager`; the role-blind RLS gap is
closed here; `superadmin` untouched; legacy `employee` kept non-assignable; the
`adjust_branch_stock` widening stays minimal.

The five forks the RLS closure surfaced are now resolved:

1. **Caja creating a client mid-sale** → **Yes.** SELECT + INSERT on `clients`, no
   UPDATE/DELETE.
2. **Caja correcting or voiding their own sale** → **Yes — changed from the assumed
   default.** UPDATE/DELETE on `sales`/`sale_items` restricted to rows they themselves
   created (`employee_id = auth.uid()`), at their own branch. **This is new scope**: no
   edit/void UI exists anywhere under `/employee/*` today (see Scope D and Affected
   Areas).
3. **Caja's sales visibility: own branch or store-wide** → **Own branch only**,
   confirmed knowingly as a reversal of `store-branches`' "Sales RLS Remains
   Store-Wide" requirement, made safe by the current zero-sales production state.
4. **Stock role reading sales** → **Yes**, read-only, own branch.
5. **Encargado editing the store-wide catalog/prices** → **Yes**, full write access
   across the whole chain, same reasoning already approved for `ClientManager`.
