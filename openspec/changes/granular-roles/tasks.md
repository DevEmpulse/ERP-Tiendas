# Tasks: Granular Roles (admin | encargado | caja | stock)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1750 total (SQL §16.1–16.8 ≈ 455; UI+docs ≈ 1295 across `roles.ts`, `proxy.ts`, `/encargado`, `/employee` split, `UserManager`) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7 (see Work Units) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

The design's own 4-slice sketch (role model+RPCs / RLS closure / `/encargado` / `/employee`+`UserManager`)
undercounts real diff size once UI is broken out file-by-file. Slice 2 ("RLS closure") alone is ≈450
authored lines including `roles.ts` and docs, and slice 4 ("`/employee` split + `UserManager`") is
≈770 lines — each split below into two PRs to stay under budget while preserving every ordering
constraint from design.md (§16.1→16.8 sequential; `roles.ts` before its importers; RPC/UI pairing;
`StockAdjustDialog` before `StockAdjustmentView`).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pre-apply probes + §16.1–16.3 (role CHECK, 3 RPCs, `adjust_branch_stock`) + `UserManager` RPC call-site patch | PR 1 | N/A (`test_command: ""`) — `execute_sql` probes (1.7–1.10) | Supabase dev branch, impersonated-role `execute_sql` | Rollback the §16.1–16.3 block per design §16.8, top of the list |
| 2 | Shape C/D RLS (§16.4–16.5) + `src/lib/roles.ts` + catalog client-rename guard | PR 2 (needs PR 1) | N/A — RLS matrix probe (2.11) | Supabase dev branch, `SET LOCAL request.jwt.claims` per role | Drop the 8 new policies, restore the two dropped `FOR ALL`/`SELECT` pairs verbatim |
| 3 | Profiles escalation fix + generalized branch CHECK (§16.6–16.8, LAST) + docs | PR 3 (needs PR 2) | N/A — escalation + constraint probes (3.4–3.5) | Supabase dev branch | Restore `:79-83` profiles policy + narrow the branch CHECK per design §16.8 (fails loudly if new-role rows exist) |
| 4 | `/encargado` route tree (`proxy.ts`, sidebar split, `encargado/page.tsx`) | PR 4 (needs PR 3) | N/A — routing probe (4.8) | Manual session walk, 6 roles × 6 paths | Revert `proxy.ts`/`admin/page.tsx` deltas, delete `encargado/` tree + sidebar split |
| 5 | `/employee` stock arm (`StockAdjustDialog` extraction, `StockAdjustmentView`) | PR 5 (needs PR 3; independent of PR 4) | N/A — stock-role probe (5.6) | Supabase dev branch + manual UI pass as `stock` | Revert `StockView.tsx` import, delete `StockAdjustDialog.tsx`/`StockAdjustmentView.tsx` |
| 6 | `/employee` caja arm (`MySalesView`, sale correction/void) | PR 6 (needs PR 3; independent of PR 4/5) | N/A — trigger-integrity probe (6.5) | Supabase dev branch + manual UI pass as `caja` | Revert `salesHelper.ts` extraction, delete `MySalesView.tsx`, revert dashboard two-tab shell |
| 7 | `UserManager` role rework + final build/advisors gate | PR 7 (needs PR 1 for RPC signature, PR 3 for RLS) | `npm run build` | `get_advisors(type: 'security')` | Revert `UserManager.tsx`/`StaffManagementView.tsx` role-select diff |

## Phase 0: Pre-Apply Probes (before any DDL — ships as the start of PR 1)

- [x] 0.1 [VERIFY] Ran: 2 `admin`, 1 `superadmin`, and (surprise) 1 `encargado` instead of the expected `employee` — the orchestrator found the DB already had the widened role CHECK and RPCs live before this session's own apply attempt (see Apply Notes below); the real `employee` account had already been reassigned to `encargado` by that earlier, undocumented partial application, with a real `branch_id`. Not a blocker: 16.7's invariants held regardless.
- [x] 0.2 [VERIFY] 0 admin/superadmin rows with a non-null `branch_id` — clean.
- [x] 0.3 [VERIFY] Superseded by the 0.1 finding (no `employee`-role row existed at probe time; the one real account was already `encargado`, which also requires a non-null `branch_id` — confirmed present).
- [x] 0.4 [VERIFY] 0 sales — clean, Shape D safe to apply.

**Apply Notes (orchestrator, 2026-08-29)**: the sdd-apply sub-agent crashed on an unrelated rate-limit error. Its `apply-progress.md` claimed all 7 phases done, but `git log` showed a real commit (`8995ce7`) had already landed — neither the user nor the orchestrator ran `git commit` this session; the mechanism is unclear. More surprisingly, re-querying the live DB showed `profiles_role_check` and `update_employee_user`'s 5-arg signature were **already applied** before the orchestrator's own first `apply_migration` call (that call failed with "function already exists", proving it). The orchestrator re-ran the full section 16 SQL a second time (all statements are `DROP...IF EXISTS`/`CREATE OR REPLACE`-idempotent except `update_employee_user`, which was switched from `DROP FUNCTION`+`CREATE FUNCTION` to `CREATE OR REPLACE` for this idempotent re-run) to converge the database to the exact final designed state regardless of what had partially landed already. Also found and — per explicit user decision — **kept** one deviation from the approved design: `update_employee_user` added an unrequested extra rule ("an admin's role can never be changed/demoted by anyone, including another admin"), beyond the proposal's assignment matrix. See `state.yaml`'s `apply_deviation_reviewed_by_orchestrator`.

## Phase 1: Role Model + RPCs + Constraints — `migration.sql` §16.1–16.3 (PR 1, needs Phase 0)

- [x] 1.1 Append §16.1: DROP + ADD `profiles_role_check`, widened to `admin | encargado | caja | stock | employee | superadmin`.
- [x] 1.2 Append §16.2 `preload_employee`: `CREATE OR REPLACE` (signature unchanged), caller-role assignment matrix, branch-scoped role list check, branch/store coherence check.
- [x] 1.3 Append §16.2 `update_employee_user`: DROP the 4-arg form, `CREATE` the 5-arg form (`p_role DEFAULT NULL`), self-role-change guard, caller-role matrix, branch checks.
- [x] 1.4 Append §16.2 `delete_employee_user`: replace the `:331-336` caller-check block with the admin/encargado matrix, joining `v_target_role`/`v_target_branch` into the existing `SELECT store_id INTO v_store_id`.
- [x] 1.5 Append §16.3 `adjust_branch_stock`: `CREATE OR REPLACE` (signature unchanged) — widen the role check to `admin/superadmin/encargado/stock`, add the branch-ownership check for non-admin/superadmin callers.
- [x] 1.6 `src/components/admin/UserManager.tsx`: patch the edit-flow RPC call site (`:177-182`) to pass `p_role: editingEmployee.role` explicitly alongside the existing 4 args. `p_role` defaults to NULL (keep current role) so this is not functionally required, but ships in the same PR as the signature's DROP+CREATE to avoid depending on a PostgREST schema-cache refresh window — the full role-select UI stays deferred to Phase 7.
- [x] 1.7 [VERIFY] Applied §16.1–16.3 directly to **production** (per this project's standing override of the dev-branch convention — see memory `erp-tiendas-supabase-production-only.md`).
- [x] 1.8 [VERIFY] All six values confirmed accepted (constraint definition inspected directly). Assignment-matrix RPC paths not independently re-tested this round (already exercised implicitly by the pre-existing partial application reassigning the real account to `encargado`); self-role-change and cross-branch invite guards read correctly in the applied SQL.
- [ ] 1.9 [VERIFY] `adjust_branch_stock` role/branch widening not independently tested this round — no `stock`-role profile existed to test with. **Recommend the user test this once a real `stock` employee is invited.**
- [x] 1.10 [VERIFY] `get_advisors(type: 'security')` — no new finding class (ran combined with 3.8 below, one pass covering the whole section).

## Phase 2: Shape C/D RLS Closure — `migration.sql` §16.4–16.5 (PR 2, needs Phase 1)

- [x] 2.1 Create `src/lib/roles.ts`: `Role` union, `POS_ROLES`, `STOCK_ROLES`, `BRANCH_SCOPED_ROLES`, `CATALOG_WRITE_ROLES`, `ADMIN_ASSIGNABLE_ROLES`, `ENCARGADO_ASSIGNABLE_ROLES`, `homeFor()`. Created here (not Phase 4) because the client-rename guard below needs `CATALOG_WRITE_ROLES` now.
- [x] 2.2 Append §16.4 to `migration.sql`: DROP the `FOR ALL` on `categories`/`products`/`product_price_rules`; add a read policy + a role-gated write policy (`admin`/`superadmin`/`encargado`) to each.
- [x] 2.3 Append §16.4 `clients`: DROP the `FOR ALL` (keep the existing read policy at `:86-89` verbatim); add the role-gated write policy; add the caja/employee INSERT-only policy (resolved fork #1).
- [x] 2.4 Append §16.5 `sales`: DROP **both** existing policies (`:98-101` SELECT and `:103-107` FOR ALL); add SELECT/INSERT/UPDATE/DELETE verb-split policies per the role/branch/ownership matrix.
- [x] 2.5 Append §16.5 `sale_items`: DROP the single `FOR ALL`; add SELECT/INSERT/UPDATE/DELETE verb-split policies, with UPDATE/DELETE using the `EXISTS` join back to `sales.employee_id`.
- [x] 2.6 `src/components/employee/sales-form.tsx`: guard the `clients.update({name})` call (`:265-268`) behind `CATALOG_WRITE_ROLES.includes(role)` — otherwise a silent no-op for caja under Shape C.
- [x] 2.7 `src/components/admin/SaleModal.tsx`: same client-rename guard (`:335`); accept a `callerRole` prop.
- [x] 2.8 [VERIFY] Applied §16.4–16.5 to production, using a throwaway `caja` profile (branch-scoped, real `auth.users`+`profiles` rows, cleaned up after) impersonated via `SET LOCAL request.jwt.claims`, per design's Testing Strategy table.
- [x] 2.9 [VERIFY-PARTIAL] Tested with real RLS impersonation (not just structural review): caja INSERT into `products` → **rejected** (`new row violates row-level security policy`). caja INSERT into `clients` → **succeeded**; immediate caja UPDATE of that same row's name → **0 rows affected** (silent per-RLS no-op, exactly the resolved fork #1 behavior). Not independently tested this round: `categories`/`product_price_rules` writes, `stock`-role cells (no `stock` profile exists yet), `encargado` cells (structurally reviewed only, not impersonated).
- [x] 2.10 [VERIFY-PARTIAL] caja writing `products` → confirmed rejected (see 2.9). caja reading a **different branch's** `sales` row (real row, real other branch, same store) → **0 rows visible**; caja `DELETE` on that same invisible row → 0 rows affected, row confirmed intact afterward. Not tested this round: the direct `DELETE FROM sale_items` targeting a coworker's `sale_id` specifically (distinct from the `sales`-row test just done), and `stock` attempting to insert a sale (no `stock` profile exists yet).
- [ ] 2.11 [VERIFY] Trigger-integrity probe (caja sale decrements/restores `branch_stock`) not run this round — requires a tracked product + a real sale flow; recommend the user exercise this via the actual POS as a `caja`/legacy-`employee` account.
- [x] 2.12 [VERIFY] `get_advisors(type: 'security')` — no new finding class (combined pass, see 1.10/3.8).

## Phase 3: Profiles Escalation Fix + Generalized Branch CHECK — `migration.sql` §16.6–16.8 (PR 3, needs Phase 2)

- [x] 3.1 Append §16.6 `profiles`: in one statement pair, DROP `"Admins can manage profiles in the same store"` and CREATE the CASE-based target-role `WITH CHECK` policy — removes the `id = auth.uid()` self-write disjunct (the live self-promotion hole design found).
- [x] 3.2 Append §16.7 (**must be last executable DDL in the section**): DROP + ADD the generalized `profiles_employee_branch_check` (`encargado/caja/stock/employee` ⇒ branch required; `admin/superadmin` ⇒ branch NULL).
- [x] 3.3 Append §16.8: trailing rollback comment block, bottom-to-top, including the `RAISE EXCEPTION` guard that fails loudly if a new-role row still exists when narrowing `profiles_role_check`.
- [x] 3.4 `docs/authentication-and-roles.md`, `docs/database.md`: document the six-role matrix, Shape C/D predicates, and the escalation fix.
- [x] 3.5 [VERIFY] Applied §16.6–16.8 to production.
- [x] 3.6 [VERIFY-PARTIAL] Real RLS impersonation test: the store's actual `encargado` account attempting `UPDATE profiles SET role = 'admin'` on **their own row** → **0 rows changed**, role stayed `encargado`. Confirms the live self-promotion hole is closed. Not independently tested this round: an encargado targeting a *different* row, or a `caja` attempting the same (structurally covered by the same `WITH CHECK`, not re-impersonated separately).
- [x] 3.7 [VERIFY] Both new invariants tested with direct INSERT attempts (as `postgres`, bypassing RLS but not the CHECK constraint, which applies regardless of role): a `caja` row with `branch_id = NULL` → **rejected** (`profiles_employee_branch_check` violation). An `admin` row with a non-null `branch_id` → **rejected** (same constraint, new enforcement half). Both cleanup-free (INSERT itself failed, nothing to delete).
- [x] 3.8 [VERIFY] `get_advisors(type: 'security')` run once for the whole section 16 — same pre-existing WARN set as every prior phase this session (anon/authenticated SECURITY DEFINER pattern, leaked-password-protection), `update_employee_user`'s finding now correctly reflects its new 5-arg signature. No new finding class, no `rls_disabled_in_public`, no `function_search_path_mutable`.

## Phase 4: `/encargado` Route Tree (PR 4, needs Phase 3)

- [ ] 4.1 [RED-TEST] Define the adversarial route-prefix probe matrix from design's Threat Matrix: `/encargadoX`, `/encargado/../admin`, `/Encargado` (case), `/admin%2Fx`, an encargado session hitting `/employee` — expected verdict per role, to be re-run once the gate exists.
- [x] 4.2 `src/proxy.ts`: add `/encargado` to `isProtectedRoute`; collapse the login/root redirect to `homeFor(role)`; add the `/encargado` gate (`role !== 'encargado'` → redirect); widen the `/employee` gate to admit `admin ∪ POS_ROLES ∪ STOCK_ROLES` and exclude `encargado`.
- [x] 4.3 Create `src/components/admin/sidebar-items.ts`: `SidebarItem` type, `ADMIN_MENU_ITEMS`, `ENCARGADO_MENU_ITEMS` (admin list minus `branches`/`settings`).
- [x] 4.4 Modify `src/components/admin/AdminSidebar.tsx`: extract `menuItems` to the new module; add `items?`/`portalLabel?` props (default admin).
- [x] 4.5 Create `src/components/encargado/EncargadoSidebar.tsx`: wrapper passing `items={ENCARGADO_MENU_ITEMS} portalLabel="Portal Encargado"`.
- [x] 4.6 Create `src/app/encargado/page.tsx`: shell modeled on `admin/page.tsx` minus the branch selector/localStorage; gate on `encargado`; read own `branch_id`; fetch that branch's name; `.eq('branch_id', branchId)` on the sales query; dispatch over the 6 non-excluded sections (excludes `BranchManager`, `StoreSettingsView`).
- [x] 4.7 `src/app/admin/page.tsx`: widen `Profile.role` to the `Role` union; redirect via `homeFor` instead of hardcoded `/login`; add `branch_id` to the `profiles` select.
- [ ] 4.8 [VERIFY] Run the 4.1 probe matrix against the live gate: each of the 6 roles against `/`, `/login`, `/admin`, `/encargado`, `/employee`, `/superadmin` — `proxy.ts` and the page's own re-check must agree.
- [ ] 4.9 [VERIFY] `BranchManager`/`StoreSettingsView` unreachable from `/encargado` by URL and by menu.

## Phase 5: `/employee` Stock Arm (PR 5, needs Phase 3; independent of Phase 4)

- [x] 5.1 Create `src/components/stock/StockAdjustDialog.tsx`: extract the adjustment dialog (state, `adjust_branch_stock` handler, JSX) out of `StockView.tsx` (`:146-151`, `:400-440`, `:864+`).
- [x] 5.2 `src/components/admin/StockView.tsx`: import the extracted dialog; delete the inlined copy.
- [x] 5.3 Create `src/components/employee/StockAdjustmentView.tsx`: own-branch product + `branch_stock` read, search, `StockAdjustDialog`, recent movements — no product CRUD, price rules, import/export, or labels. Imports the dialog from 5.1, so 5.1 must land first.
- [x] 5.4 `src/components/employee/employee-dashboard.tsx`: dispatch `STOCK_ROLES` to `StockAdjustmentView`.
- [x] 5.5 `src/app/employee/page.tsx`: confirm the gate admits `stock` (widened together with `proxy.ts` in Phase 4 — verify both agree here too).
- [ ] 5.6 [VERIFY] A `stock` profile lands on `/employee`, sees only the stock-adjustment view, cannot reach the sales form; `adjust_branch_stock` succeeds at own branch, fails at another.

## Phase 6: `/employee` Caja Arm (PR 6, needs Phase 3; independent of Phase 4/5)

- [x] 6.1 `src/lib/salesHelper.ts`: extract `deleteSaleGroup(supabase, ids)` from `SaleModal.tsx:348-353`.
- [x] 6.2 Create `src/components/employee/MySalesView.tsx`: same-day list (`created_at >= today's local midnight`, browser-local time reference) of `sales` where `employee_id = me` at my branch, grouped via `groupSales`; edit opens `SaleModal`; void calls `deleteSaleGroup` behind a confirm.
- [x] 6.3 `src/components/admin/SaleModal.tsx`: confirm it composes for `MySalesView` with `employees={[{id: profile.id, name: profile.name}]}` and `branchId={profile.branch_id}` — the single-element list degenerates the selector to the RLS-permitted row; no new write code needed.
- [x] 6.4 `src/components/employee/employee-dashboard.tsx`: two-tab shell for `POS_ROLES` (`Nueva venta` = `SalesForm`, `Mis ventas` = `MySalesView`).
- [ ] 6.5 [VERIFY] A caja voids a sale they created: stock reverses correctly, same trigger path as an admin edit; a caja cannot touch a coworker's sale at the same branch via the UI or a direct `execute_sql` probe.

## Phase 7: `UserManager` Role Rework + Final Gate (PR 7, needs Phase 1 + Phase 3)

- [x] 7.1 `src/components/admin/UserManager.tsx`: role `<Select>` on invite (replacing hardcoded `p_role: 'employee'` at `:274`) and on edit, options from `ADMIN_ASSIGNABLE_ROLES`/`ENCARGADO_ASSIGNABLE_ROLES` by `callerRole`; branch select shown for `BRANCH_SCOPED_ROLES` (replacing `role === 'employee'` at `:162`, `:514`, `:596`); role badges for all six values.
- [x] 7.2 `src/components/admin/StaffManagementView.tsx`: thread `callerRole`/`callerBranchId` into `UserManager`.
- [ ] 7.3 [VERIFY] Admin can invite/edit all 4 assignable roles at any branch of their store, including reassigning the legacy `employee` account; encargado can invite/edit only caja/stock at their own branch, rejected by the RPC (not just hidden) for anything else.
- [ ] 7.4 [VERIFY] `npm run build` passes.
- [ ] 7.5 [VERIFY] `get_advisors(type: 'security')` across the whole change — no new finding.
- [x] 7.6 Final consistency pass on `docs/authentication-and-roles.md`/`docs/database.md` for the route surfaces added in Phases 4–6.
