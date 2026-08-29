# Tasks: Multi-Branch Support (store-branches)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950–1050 (migration.sql ~220; BranchManager.tsx new ~380; UserManager.tsx ~130; admin/page.tsx ~150 combined; SaleModal/sales-form/salesHelper/pass-through chain ~90; AdminSidebar ~10; docs ~85) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 (see Work Units) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `migration.sql` §14.1–14.9 + rollback; `UserManager.tsx` branch selects + RPC parity (coupled: DROP breaks stale UI) | PR 1 | N/A (`test_command: ""`) — `execute_sql` CHECK/RLS/helper/function probes (task 1.6) | Supabase dev branch; NO ACTION acceptance probe (task 1.5) + manual invite/reassign (task 2.5) | Rollback SQL block (task 1.3) + revert `UserManager.tsx` together |
| 2 | `BranchManager.tsx` (new) + `AdminSidebar.tsx` entry + admin branch selector state in `admin/page.tsx` | PR 2 | N/A — manual create/rename/deactivate/reactivate (task 3.5) | Admin UI on dev branch, branches table already live from PR 1 | Revert `BranchManager.tsx`, sidebar entry, selector state independently of PR 1 |
| 3 | `branch_id` attribution on all 4 sales-writer paths + pass-through chain; final build/advisors gate | PR 3 (needs PR 2's `selectedBranchId`) | N/A — `SELECT id, branch_id FROM sales ORDER BY created_at DESC LIMIT 8` (task 4.6) | 4 real sales on dev branch: employee, admin single, admin split, admin edit | Revert sales-writer files together; `sales.branch_id` stays nullable, no data loss |
| 4 | `docs/database.md`, `docs/authentication-and-roles.md` | PR 4 | N/A — structural readback | N/A (docs only) | Revert docs files independently |

## Phase 1: Schema (`migration.sql`)

- [x] 1.1 Add §14.1–14.5: `branches` table + RLS (read-all, admin-write), `profiles.branch_id` (no CHECK yet), `get_current_user_branch_id()`, `sales.branch_id`.
- [x] 1.2 Add §14.6–14.7: `DROP`+`CREATE` `preload_employee`/`update_employee_user` with `p_branch_id`.
- [x] 1.3 Add §14.8 (`handle_new_user` creates "Sucursal Principal"), §14.9 (employee-branch CHECK, last), and the rollback block.
- [x] 1.4 Applied 14.1→14.9 **directly to production** (user overrode the dev-branch convention for this project, "por ahora") in two steps via `apply_migration`/`execute_sql`: 14.1–14.8 first, then a backfill (see 1.4a), then 14.9 last.
- [x] 1.4a **Unplanned backfill required.** Production had real data (3 stores, 4 profiles incl. 1 employee, 0 sales) — contrary to the earlier "no production data" assumption. Created "Sucursal Principal" for each of the 3 existing stores and backfilled the one existing employee's `branch_id` before applying the 14.9 CHECK constraint.
- [x] 1.5 [VERIFY] NO ACTION probe: throwaway store+branch+employee created; `DELETE` on the referenced branch failed with `profiles_branch_id_fkey` violation (confirmed RESTRICT-equivalent protection); `DELETE` on the throwaway store succeeded and cascaded to both the branch and the profile in one statement (confirmed NO ACTION, not RESTRICT). Throwaway rows and the dummy `auth.users` row cleaned up; real row counts (3 stores/4 profiles/3 branches) confirmed unchanged after cleanup.
- [x] 1.6 [VERIFY] CHECK constraint confirmed rejecting an employee insert with `branch_id IS NULL` (caught as `check_violation`). `branches` RLS confirmed: read-all (`store_id = get_current_user_store_id()`) + admin-write (`role IN ('admin','superadmin')`) policies present exactly as designed. `preload_employee`/`update_employee_user`/`get_current_user_branch_id` confirmed as single signatures each (old overloads correctly dropped, not left coexisting).
- [x] 1.7 Ran `get_advisors(security)`: no new class of finding. `get_current_user_branch_id` shows the same pre-existing "anon/authenticated can execute SECURITY DEFINER" WARN already accepted for `get_current_user_store_id`/`get_current_user_role`; no RLS-disabled or search-path findings on `branches` or `sales.branch_id`.

## Phase 2: `UserManager.tsx` (same PR as Phase 1)

- [x] 2.1 Add `Branch` state + load-effect (active branches); add `branch_id` to `UserProfile` and both profile selects.
- [x] 2.2 Add required branch `Select` to invite dialog; `preload_employee` call gains `p_branch_id`.
- [x] 2.3 Add branch `Select` to edit dialog (employee only); `openEdit` sets it; `update_employee_user` call gains `p_branch_id`.
- [x] 2.4 Add "Sucursal" column to the members table.
- [ ] 2.5 [VERIFY] Invite an employee end-to-end; reassign an existing employee; confirm via `get_current_user_branch_id()`. **Schema-side prerequisite done (1.4-1.7). Needs a manual pass by the user logged in as a real admin — the orchestrator has no Google OAuth credentials for the real admin/employee accounts to drive this through the browser.**

## Phase 3: Admin Branch Selector + `BranchManager.tsx`

- [x] 3.1 Create `BranchManager.tsx`: list/create/rename/deactivate/reactivate; guard against deactivating the last active branch.
- [x] 3.2 `AdminSidebar.tsx`: add `'branches'` to `AdminSection` + a `menuItems` entry.
- [x] 3.3 `admin/page.tsx`: add `branches`/`selectedBranchId`/`refreshBranchesKey` state + load effect + `localStorage` default/persistence.
- [x] 3.4 `admin/page.tsx`: header branch `Select` control + `'branches'` case rendering `<BranchManager>`.
- [ ] 3.5 [VERIFY] Create/rename/deactivate/reactivate a branch; selector updates and excludes inactive branches. **Dev server smoke test done: app compiles, boots, and the unauthenticated login page renders with no console errors. Needs a manual pass by the user logged in as admin — same credential limitation as 2.5.**
- [x] 3.5a **Bug found and fixed during user's manual testing**: the header branch selector and both `UserManager.tsx` branch selects showed the raw branch UUID instead of its name. Cause: this project's `Select` wrapper (`src/components/ui/select.tsx`) is built on `@base-ui/react/select`, not Radix — Base UI's `Select.Value` does not auto-resolve the matching `SelectItem`'s label like Radix does; it needs an explicit `children` render function `(value) => label`. No prior code in the repo used `SelectValue` before this change, so there was no existing pattern to copy. Fixed in all 3 call sites (`admin/page.tsx` header selector, `UserManager.tsx` invite + edit dialogs) and documented with a comment on the `SelectValue` wrapper.

## Phase 4: Sales-Writer Branch Attribution

- [x] 4.1 `employee/page.tsx` + `employee-dashboard.tsx`: thread `profile.branch_id`.
- [x] 4.2 `sales-form.tsx`: `branchId = profile.branch_id` on all 4 insert objects.
- [x] 4.3 `salesHelper.ts`: add `branch_id` to `Sale`/`GroupedSale`, carried through `groupSales`.
- [x] 4.4 `SaleModal.tsx`: add `branchId` prop; `resolvedBranchId = saleToEdit?.branch_id ?? branchId` on all 4 inserts.
- [x] 4.5 `admin/page.tsx`: add `branch_id` to the sales select; pass `branchId={selectedBranchId}` through `DashboardView`/`HistoryView` → `SalesHistory` → `SalesTable` → `SaleModal`.
- [ ] 4.6 [VERIFY] 4 writer paths (employee, admin single/split, admin edit) all produce non-null `branch_id`; employee still reads every store sale, including legacy NULL-branch rows. **Needs a manual pass logged in as admin + employee — same credential limitation as 2.5. Verify with `SELECT id, branch_id FROM sales ORDER BY created_at DESC LIMIT 8` after each test sale (production currently has 0 sales rows).**
- [x] 4.7 `npm run build` passes (verified independently by the orchestrator too); `get_advisors(security)` ran — no new finding class introduced by this change (task 1.7).

## Phase 5: Docs

- [x] 5.1 `docs/database.md`: `branches` entry, `profiles.branch_id`, `sales.branch_id`, both RLS shapes + "which shape for a new table" rule.
- [x] 5.2 `docs/authentication-and-roles.md`: role/branch matrix + `get_current_user_branch_id()`.

## Continuation note

All code-level tasks (migration.sql section 14 DDL + rollback, all 12 application
files, both docs) are implemented and `npm run build` passes. All DB-side schema
tasks (1.4–1.7) are done: the orchestrator applied section 14 **directly to
production** (user override of the dev-branch convention), discovered and
backfilled real pre-existing data (3 stores, 1 employee) that the earlier
"no production data" assumption had missed, ran the NO ACTION acceptance probe,
the CHECK/RLS/function probes, and `get_advisors` (no new finding class).

Three tasks remain unchecked (2.5, 3.5, 4.6) — all require driving the app as a
real, authenticated admin/employee user (invite an employee, reassign a branch,
create/deactivate a branch, record a sale from each of the 4 writer paths). The
orchestrator has no Google OAuth credentials for the real accounts and only
smoke-tested the unauthenticated login page (compiles, boots, no console errors).
**The user should manually click through these three flows** and, for 4.6, spot
check with `SELECT id, branch_id FROM sales ORDER BY created_at DESC LIMIT 8`.
