# Exploration: granular-roles (admin | encargado | caja | stock role model)

## Current State

**Role storage**: `profiles.role text CHECK (role IN ('admin', 'employee', 'superadmin'))`
(`migration.sql:214-215`). Read via `SECURITY DEFINER` helper `get_current_user_role()`
(`migration.sql:50-57`), unchanged since section 3 — no update needed to the helper
itself, only to every consumer's allowed-value list.

**`superadmin` is confirmed as a 5th, cross-store platform tier**, not part of the
store-level role ladder:
- Whitelist-gated signup only (`allowed_admins` table, section 8.2; `handle_new_user()`
  never assigns `superadmin`, only `admin` for whitelisted new stores or the preloaded
  role for invited profiles).
- Every `superadmin` RLS policy (`migration.sql:397-417`) grants **full, store_id-unscoped**
  access to `allowed_admins`, `profiles`, `stores` — i.e., cross-tenant reach, unlike
  every other role which is always `store_id`-scoped.
- Every branch/stock policy that lists `'admin'` also lists `'superadmin'` alongside it
  (`IN ('admin', 'superadmin')`, sections 14.2, 15.6, 15.9) — the established pattern is
  "wherever admin can act, superadmin can too, at both scopes."
- **Conclusion**: `superadmin` sits *above* this change's 4-role list and is untouched by
  it, except that every new predicate this change adds for `admin`-level access must keep
  including `superadmin` alongside it, per existing convention.

**Real production employee row**: per `store-branches/state.yaml`
(`production_backfill_performed`), production held 4 real profiles, 1 with
`role='employee'`, backfilled with a real `branch_id`. This is a live account
(`matiasbangher06@gmail.com`) — any constraint/UI change here is a live-data
compatibility concern, not a greenfield one. Row counts should be re-verified by the
orchestrator before `sdd-apply`.

**`profiles_employee_branch_check`** (`migration.sql:717-719`):
`role <> 'employee' OR branch_id IS NOT NULL`. This is the only DB-level enforcement
that a branch-scoped role actually has a branch; nothing currently prevents
`admin`/`superadmin` from also having a non-null `branch_id` (the app just never sets
one).

**Route authorization (`src/proxy.ts`)**: role-based, not RLS-based.
- `isProtectedRoute` = prefix match on `/admin`, `/employee`, `/superadmin`.
- Login/root redirect: `superadmin` → `/superadmin`, `admin` → `/admin`, everything else
  → `/employee`.
- `/admin/*` gate: `role !== 'admin'` → redirected away — **binary, no encargado
  carve-out today**.
- `/employee/*` gate: `role !== 'admin' && role !== 'employee'` → redirected away (note
  admin can also reach `/employee` today, an existing quirk, not a blocker).
- `src/app/admin/page.tsx` independently re-checks `profileData.role !== 'admin'`
  client-side and redirects to `/login` on failure — a second admin-only gate,
  hardcoded to the literal string `'admin'`.
- `src/app/employee/page.tsx` independently re-checks
  `role !== 'employee' && role !== 'admin'` — same pattern, hardcoded.

**Admin UI surface** (`src/components/admin/*`), all reached only via
`/admin/page.tsx`'s `renderActiveView` switch:
- `DashboardView`, `HistoryView`, `SaleModal` — already branch-aware: admin page already
  carries `selectedBranchId` state + a branch `<Select>` in the header and passes
  `branchId={selectedBranchId}` into these views. Directly reusable for encargado
  (locked to one branch instead of admin's free choice).
- `StockView` — admin-only today, already takes `branchId`/`branchName` props; no
  employee-side equivalent exists at all today (confirmed gap — a future `stock` role
  needs a *new* UI, not a relaxed existing one).
- `StaffManagementView` → `UserManager` — admin-only; invites are hardcoded to
  `p_role: 'employee'`; edit/delete route through `update_employee_user`/
  `delete_employee_user` RPCs only, never a direct `profiles` table write from the UI.
- `BranchManager`, `StoreSettingsView` — store-wide, admin-only; consistent with the
  schema having no branch-scoping concept to restrict *to*.
- `ClientManager` — store-wide (`clients` has no `branch_id` column at all), so any
  encargado access would technically be store-wide regardless of UI decision — this is
  a policy question, not a technical one.
- `ProductImportDialog`/`ProductExportButton` — operate on `products`, store-wide, no
  branch scoping.

**Employee UI surface** (`src/components/employee/*`): a single `sales-form.tsx` shown
to any `/employee` visitor regardless of role — already shaped exactly like a `caja`
(point-of-sale) tool. No stock-adjustment view exists under `/employee` today.

**RLS/authorization surface referencing role** (exhaustive catalog):

| # | Location | Table/Function | Current predicate | New-role impact |
|---|----------|-----------------|--------------------|------------------|
| 1 | `:79-83` | `profiles` policy "Admins can manage profiles in the same store" | `id = auth.uid() OR role = 'admin'` | Must add encargado (branch-scoped, target-role-restricted); **currently the only escalation guard is `role='admin'`, so widening this predicate without a target-row role restriction is a privilege-escalation risk** |
| 2 | `:397-401` | `allowed_admins` policy | `role = 'superadmin'` | Untouched |
| 3 | `:405-409` | `profiles` policy "Superadmins can do everything" | `role = 'superadmin'` | Untouched |
| 4 | `:413-417` | `stores` policy "Superadmins can do everything" | `role = 'superadmin'` | Untouched |
| 5 | `:554-560` | `branches` policy "Admins can manage branches" | `role IN ('admin','superadmin')` | Untouched (encargado explicitly excluded per user's decision) |
| 6 | `:850-866` | `branch_stock` policy "manage in their branch" | `role IN ('admin','superadmin') OR branch_id = get_current_user_branch_id()` | Branch-id fallback already covers any branch-scoped role automatically — **no RLS change needed here** |
| 7-8 | `:870-890` | `stock_movements` SELECT + INSERT policies | same predicate as #6 | Same — no change needed |
| 9 | `:592-599` | `preload_employee()` | validates `p_role IN ('admin','employee')`; caller must be `role='admin'` in `p_store_id` | Must expand role list to `admin/encargado/caja/stock` (+legacy `employee`?) and add an encargado branch-scoped caller path — **core of the encargado permission matrix**, see below |
| 10 | `:642-645` | `update_employee_user()` | caller must be `role='admin'` in `v_store_id` | Same expansion needed |
| 11 | `:331-334` | `delete_employee_user()` | caller must be `role='admin'` in `v_store_id` | Same expansion needed |
| 12 | `:994` | `adjust_branch_stock()` | rejects unless `role IN ('admin','superadmin')` | **Named follow-up, not to be redesigned here**: once `stock`/`encargado` exist they need branch-scoped access to this RPC |

**Tables with NO role predicate at all today** (RLS is `store_id`-only): `clients`,
`sales`, `categories`, `products`, `sale_items`, `product_price_rules`. This means
**any authenticated profile in the store can already write directly to these tables
via the Supabase client, bypassing whatever the UI shows them** — role separation for
these tables today is UI/route-only, not RLS-enforced. This is a pre-existing gap, but
it directly matters here: `caja`/`stock` exclusivity ("not combinable permissions")
**cannot be achieved by UI alone** if it's meant to be a real security boundary.

## Affected Areas

- `migration.sql` — new numbered section: `profiles_role_check` constraint,
  `profiles_employee_branch_check` generalization, RLS policy #1 rewrite,
  `preload_employee`/`update_employee_user`/`delete_employee_user` role-list +
  encargado-branch-scoped rewrites, and (named follow-up only) `adjust_branch_stock`
  role-list widening.
- `src/proxy.ts` — `isProtectedRoute`, login/root redirects, and a new `/encargado`
  access-control block; `/employee` gate must accept `caja`/`stock` (and legacy
  `employee`).
- `src/app/admin/page.tsx` — hardcoded `role !== 'admin'` gate; `Profile.role` type union.
- `src/app/employee/page.tsx` — hardcoded `role !== 'employee' && role !== 'admin'` gate.
- `src/components/admin/UserManager.tsx` — hardcoded `p_role: 'employee'` invite call,
  binary role badge rendering, branch-select-visibility condition (`role === 'employee'`),
  needs a role-select for the 3 assignable roles with caller-scoped options.
- `src/components/admin/AdminSidebar.tsx` — `menuItems` list needs per-role filtering
  (encargado excludes `branches`, `settings`; possibly `clients`).
- `src/components/admin/BranchManager.tsx`, `StoreSettingsView.tsx` — must stay
  admin/superadmin-only.
- `src/components/admin/StockView.tsx` — reusable as-is for encargado (already
  branch-parameterized); needs a new parallel component or reuse under `/employee` for
  the `stock` role.
- `src/components/employee/employee-dashboard.tsx`, `sales-form.tsx` — need role-based
  branching (caja → existing form; stock → new stock-adjustment view, not yet built).
- New route surface: dedicated `/encargado` route tree (see Approaches).

## Investigation Answers

**1. `superadmin` fit** — confirmed 5th tier, cross-store, whitelist-driven, untouched
by this change except that every new `admin`-level predicate must keep pairing it with
`superadmin` (existing convention, not new).

**2. Does `employee` survive?** — Recommend **keep `role = 'employee'` as a valid,
non-assignable legacy value** rather than a forced migration:
- `preload_employee()`'s new-invite validation drops `'employee'` from the *assignable*
  list (`admin | encargado | caja | stock`), so no new employee rows can ever be created.
- Existing `employee` rows keep working with **no functional change** — map legacy
  `employee` to `caja`-equivalent access everywhere a new role branch is added (their
  current `sales-form.tsx` is already caja-shaped, so this preserves exact current
  behavior for the one real account).
- `UserManager`'s edit flow gains a role dropdown so an admin can voluntarily reassign
  a legacy `employee` to `caja`/`stock`/`encargado` at their own pace — no forced
  migration script, no unreviewed default guess.
- Rejected alternative: forced backfill (e.g., "default all `employee` rows to `caja`")
  — makes a business decision inside a migration script instead of letting a human
  decide, and needlessly risks the one real production account on an unreviewed
  assumption.

**3. RLS impact scope** — catalogued exhaustively above (8 RLS policies + 4
`SECURITY DEFINER` role checks = 12 role-gated surfaces; 6 additional tables with no
role predicate at all, flagged as a pre-existing/orthogonal gap).

**4. encargado's employee-management permission matrix** — proposed for `sdd-propose`
to formalize:

| Caller role | May assign role... | Scope |
|---|---|---|
| `superadmin` | any | cross-store (unchanged, out of scope) |
| `admin` | `encargado`, `caja`, `stock` (whether `admin` may still preload another `admin` is an **open question for propose**) | own store, any branch |
| `encargado` | `caja`, `stock` only — **never** `encargado` or `admin` | own branch only (`p_branch_id` must equal caller's own `branch_id`) |
| `caja` / `stock` | none | — |

This requires `preload_employee`/`update_employee_user`/`delete_employee_user` to
branch on caller role: `admin` keeps today's any-branch-in-store check; `encargado`
adds a same-branch-as-caller check plus a target-role allowlist (`caja`/`stock` only).
The `profiles` RLS policy #1 above needs the equivalent `WITH CHECK` tightening if any
of this is ever done via direct table write instead of the RPCs (today it isn't, but
the RLS policy currently would *allow* it — a latent escalation path, worth closing in
design/spec).

**5. UI/routing structure** — two viable approaches, compared below. Recommendation:
**dedicated `/encargado` route tree** reusing existing presentational components, **not**
role-branching inside `/admin`.

**6. Backward compatibility** — real row counts must be re-verified by the orchestrator
before apply (last known, from `store-branches/state.yaml`: 3 stores / 4 profiles [1
employee] / 3 branches / 0 sales at time of that change — likely stale after
`stock-phase2` and any manual usage since).

**7. `adjust_branch_stock` interaction** — confirmed as a required follow-up, explicitly
not redesigned here: its current unconditional `NOT IN ('admin','superadmin')` rejection
must become branch-scoped for `encargado`/`stock` once those roles exist. List as an
affected-area follow-up task, not an in-scope redesign.

## Approaches

1. **Role-aware `/admin/*` (single route tree, internal branching)** — extend
   `AdminPage`'s existing `renderActiveView` switch and `AdminSidebar` menu list to
   filter by `role`, lock `selectedBranchId` to the encargado's own branch, hide
   `BranchManager`/`StoreSettingsView`/product-catalog admin components.
   - Pros: reuses `AdminPage`'s existing auth/data-fetching/branch-selector plumbing
     directly, no duplicate page shell.
   - Cons: `AdminPage` is already 537+ lines with significant state; adding
     role-conditional rendering across all 8 sidebar sections increases the risk of an
     encargado reaching an admin-only view through an overlooked branch — what an
     encargado can reach becomes implicit in scattered conditionals rather than
     explicit in the route tree.
   - Effort: Medium.

2. **Dedicated `/encargado/*` route tree, reusing existing presentational components**
   — new `src/app/encargado/page.tsx` + a trimmed `EncargadoSidebar`, importing the
   *same* `DashboardView`/`HistoryView`/`SaleModal`/`StockView`/`StaffManagementView`
   components `/admin` already uses (parameterized with a restricted role-assignment
   list), forcing `branchId` to the encargado's own `branch_id` (no selector, since
   there's nothing to select).
   - Pros: what an encargado can reach is enumerable by reading one file (the new
     page's imports) rather than auditing conditionals scattered through the existing
     537-line admin page; matches the project's existing pattern of already-shared,
     branch-parameterized presentational components; mirrors `proxy.ts`'s existing
     per-prefix gate pattern (`/admin`, `/employee`, `/superadmin` already each get
     their own gate).
   - Cons: some duplicated auth-verification/data-fetching boilerplate between
     `/admin/page.tsx` and the new `/encargado/page.tsx` (mitigated by the components
     themselves, not the page shell, already being shared).
   - Effort: Medium — comparable to option 1, but the effort buys architectural clarity.

3. **Employee UI split (`caja` vs `stock`)** — keep the single `/employee/*` route
   (unlike encargado, there are only 2 leaf views here, not 8 sidebar sections).
   `employee-dashboard.tsx` switches between the existing `SalesForm` (caja, and legacy
   `employee`) and a new `StockAdjustmentView` (stock role) based on `profile.role`,
   mirroring the existing dispatch pattern already used in `AdminPage`.
   - Effort: Low-Medium (mostly building the new stock-adjustment view; the dispatch
     mechanism is a proven pattern already in this codebase).

## Recommendation

Adopt **Approach 2** for encargado (`/encargado/*` dedicated route tree, reusing
existing branch-parameterized components) and **Approach 3** for the employee split
(single `/employee/*` route with internal `caja`/`stock` dispatch). Combine with the
legacy-`employee`-as-`caja` mapping and the branch-scoped, target-role-restricted
permission matrix above. Treat `adjust_branch_stock`'s role-list widening as a named,
separately-tracked follow-up task in this change's task list rather than an in-scope
redesign.

Explicitly flag to `sdd-propose`, as open decisions requiring the user's input (not
resolved here):
(a) whether `admin` may still self-service-invite another `admin`;
(b) whether `encargado` gets `ClientManager` access (technically store-wide regardless,
    since `clients` has no `branch_id`);
(c) whether the pre-existing RLS gap on `clients`/`sales`/`categories`/`products`/
    `sale_items`/`product_price_rules` (no role predicate, UI-only enforcement) is in
    scope to close for `caja`/`stock` exclusivity to be a real security boundary, or
    explicitly deferred as a known limitation.

## Risks

- **Privilege-escalation surface in the `profiles` RLS policy** (#1): today's
  `role = 'admin'` predicate is the *only* guard against arbitrary role changes via
  direct table access (bypassing the RPCs); naively widening it to include `encargado`
  without also restricting *which* role values the target row may take would let an
  encargado promote a profile (including their own) to `admin` or `encargado` directly
  via the Supabase client.
- **The `caja`/`stock` "mutually exclusive roles, not combinable permissions" framing
  is a UI-only distinction today** unless RLS predicates are added to the 6
  role-blind tables — worth surfacing explicitly to the user in `sdd-propose` rather
  than silently treating it as already enforced.
- **Real production data**: 1 confirmed `employee` account and unverified current row
  counts across `profiles`/`stores`/`branches` — any CHECK-constraint or RLS change
  must be re-verified against live counts before apply.
- **`adjust_branch_stock` is currently a hard block for every non-admin role** — if this
  follow-up is not scheduled promptly after `granular-roles` ships, a newly-created
  `stock`/`encargado` profile will have no way to adjust stock at all despite the new
  role existing, a confusing half-shipped state.
- **Two independent, currently-hardcoded admin/employee gates exist** (`proxy.ts` route
  matcher and each page's own client-side re-check) — both must be updated
  consistently, or a role slipping through one but not the other becomes a real
  access-control bug, not just a UX inconsistency.

## Ready for Proposal

Yes. All 7 requested investigation points are answered with codebase evidence; the two
open-decision items in the Recommendation (self-invite-admin, `ClientManager`
visibility for encargado) and the one deferred-scope decision (closing the role-blind
RLS gap) should be surfaced as explicit questions in `sdd-propose` rather than assumed.

## Key Learnings

1. `superadmin` in this codebase is a cross-store, whitelist-gated platform tier with
   store_id-unscoped RLS policies, structurally separate from any per-store role ladder.
2. Six tenant tables (`clients`, `sales`, `categories`, `products`, `sale_items`,
   `product_price_rules`) enforce only `store_id` in RLS with no role predicate, making
   today's admin/employee split UI-only for those tables.
3. `branch_stock` and `stock_movements` RLS already use a branch-id-equality fallback
   that transparently covers any future branch-scoped role without modification.
4. The admin dashboard's `DashboardView`/`HistoryView`/`SaleModal`/`StockView`
   components are already branch-parameterized via props, making them directly
   reusable for a new branch-locked route tree.
