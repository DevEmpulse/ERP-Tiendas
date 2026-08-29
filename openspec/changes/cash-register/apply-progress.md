# Apply Progress: Cash Register — Caja Sessions (Phase 3)

**Mode**: Standard (no strict TDD; repo has no test runner).
**Delivery**: `size:exception` — single PR, no chaining (user-accepted, ~1185-line forecast; actual diff is larger, see below).
**Run**: Single apply batch, all in-scope phases completed in one pass.

## Completed Tasks (21/26)

### Phase 1: Schema+RLS+RPC
- [x] 1.1 `cash_sessions` + `cash_movements` tables, closed-shape CHECK, partial unique index, coherence key (§17.1–17.2).
- [x] 1.2 RLS enable + SELECT/INSERT policies on both tables (§17.3).
- [x] 1.3 `sales.cash_session_id`, composite FK, BEFORE INSERT stale-attach trigger (§17.4–17.5).
- [x] 1.4 `close_cash_session` SECURITY DEFINER RPC (§17.6).
- [x] 1.5 Grants/revokes + commented rollback block (§17.7, §17.9).

### Phase 2: Shared Cash-Session Lib
- [x] 2.1 `src/lib/cashSession.ts` — `CashSession`/`CashMovement` types + `fetchOpenSession`/`openSession`/`closeSession`/`addCashMovement`.
- [x] 2.2 `src/lib/roles.ts` — `CASH_SESSION_ROLES` + `canOperateCashSession`.
- [x] 2.3 `pnpm run build` — clean.

### Phase 3: §17.8 + Bug Fix + Attribution
- [x] 3.1 Replaced the 4 Shape D policies (`sales` UPDATE/DELETE, `sale_items` UPDATE/DELETE) with the fail-closed closed-session clause; admin/superadmin arms unchanged; elided bodies written in full.
- [x] 3.2 `salesHelper.ts` — `cash_session_id` on `Sale`/`GroupedSale`, populated at both `groupSales` read sites; `deleteSaleGroup` now returns `{ deletedIds, error }` via `.select('id')` on the delete instead of `{ error }` only.
- [x] 3.3 `sales-form.tsx` — resolves the open session once per submit via `fetchOpenSession`, attaches to the single insert + all 3 combined-payment inserts.
- [x] 3.4 `SaleModal.tsx` — resolves+attaches on all inserts (combined ×3 + single), aborts the edit-mode delete-then-recreate when `deletedIds.length < ids.length`, adds a read-only one-line attribution indicator.
- [x] 3.5 `MySalesView.tsx` — void action aborts and surfaces "pertenece a una caja ya cerrada" on a short delete count; `cash_session_id` threaded through the select + mapper.

### Phase 4: Open/Close+Movements UI
- [x] 4.1 `src/components/shared/CashSessionPanel.tsx` — banner (opened_by/opened_at/running expected preview) + open/close/cash-in-out dialogs; null-branch placeholder.
- [x] 4.2 `employee-dashboard.tsx` — panel mounted above the tab strip; tab union widened to `'form' | 'my_sales' | 'cash'`, third tab renders the history view.
- [x] 4.3 `sidebar-items.ts` — new `'cash'` `AdminSection` + `ADMIN_MENU_ITEMS` entry ("Caja", `Wallet` icon); `ENCARGADO_MENU_ITEMS` inherits it automatically.
- [x] 4.4 `admin/page.tsx` (on `selectedBranchId`) + `encargado/page.tsx` (on `userProfile.branch_id`) — `case 'cash'` mounts panel + history view.

### Phase 5: History View+Docs
- [x] 5.1 `src/components/shared/CashSessionHistoryView.tsx` — per-session reconciliation (opening/expected/counted/discrepancy, colour-coded), expandable movements with post-close flag, "efectivo sin caja" per-branch-per-day counter.
- [x] 5.2 Mounted alongside the panel in both `admin/page.tsx` and `encargado/page.tsx`.
- [x] 5.3 `docs/database.md` (new tables §12–§13, RLS table rows, Forma D delta, closed-session immutability note) + `docs/features.md` (new "Caja" feature section).
- [x] 5.5 `pnpm run build` — clean (TS strict, 0 errors). `pnpm run lint` — clean on all new/touched cash-register files (fixed 3 new `react-hooks/set-state-in-effect` findings introduced by the new components; left pre-existing repo lint findings in `MySalesView.tsx`/`salesHelper.ts` untouched as out of scope).

## Remaining Tasks (5/26) — all require Supabase MCP access, unavailable to this apply run

- [ ] 0.1 Pre-apply probe: `execute_sql` confirming `sales` count is still 0.
- [ ] 1.6 DB verification: dup-open rejection, role/branch scoping, NULL-attach, RPC math + re-read stability, double-close, trigger degrade; `get_advisors`.
- [ ] 3.6 DB verification: closed/open scoping on `sales`/`sale_items`, admin exemption; manual closed-session edit-abort check.
- [ ] 4.5 Manual E2E: open → sale → cash-out → close with discrepancy; duplicate-open UX.
- [ ] 5.4 Manual: admin store-wide history vs. caja/encargado own-branch-only, read-only.

**These require the orchestrator** (Supabase MCP `execute_sql`/`get_advisors`, and a live dev branch) — this apply run had no Supabase MCP tools, per the task's explicit scope boundary.

## File Changes

| File | Action | Lines (diff) |
|---|---|---|
| `migration.sql` | Modified (append §17) | +485 |
| `src/lib/cashSession.ts` | Created | 186 |
| `src/lib/roles.ts` | Modified | +16 |
| `src/lib/salesHelper.ts` | Modified | +23/-3 |
| `src/components/employee/sales-form.tsx` | Modified | +20 |
| `src/components/admin/SaleModal.tsx` | Modified | +48/-4 |
| `src/components/employee/MySalesView.tsx` | Modified | +15/-3 |
| `src/components/shared/CashSessionPanel.tsx` | Created | 430 |
| `src/components/shared/CashSessionHistoryView.tsx` | Created | 324 |
| `src/components/employee/employee-dashboard.tsx` | Modified | +36/-8 |
| `src/components/admin/sidebar-items.ts` | Modified | +8 |
| `src/app/admin/page.tsx` | Modified | +19 |
| `src/app/encargado/page.tsx` | Modified | +20 |
| `docs/database.md` | Modified | +53 |
| `docs/features.md` | Modified | +32 |

Actual total ≈ 1697 changed lines (tracked-file diff 757 + ~940 lines of new files), above the ~1185 forecast — expected given the design's full elided-body writeout and the two new UI components; covered by the user's accepted `size:exception`.

## Deviations from Design

None. `close_cash_session` is `SECURITY DEFINER` per D2 (intentional, documented deviation from the original proposal wording, not from design.md). The 17.8 closed-session clause uses the fail-closed `EXISTS ... status = 'open'` form exactly as specified in D3, not the rejected fail-open `NOT EXISTS ... status = 'closed'` form.

## Issues Found / Notes

- Re-verified the live `migration.sql` Shape D policy text (`:1413–1547`) against design.md's citations before writing the §17.8 replacement — byte-for-byte match, no line-number drift.
- Fixed 3 new ESLint `react-hooks/set-state-in-effect` findings in the two new components (inline `eslint-disable-next-line` with rationale) so the new code doesn't add to the repo's existing (pre-session, untouched) lint backlog in `MySalesView.tsx`/`salesHelper.ts`.
- `git status` showed unrelated modifications to `openspec/changes/granular-roles/state.yaml`/`tasks.md` that this apply run did not make — left untouched as out of scope for the `cash-register` change.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `pnpm run build` — exit 0, TS strict, 0 errors, all 5 routes compiled (`/`, `/admin`, `/employee`, `/encargado`, `/superadmin`, `/login`). `pnpm run lint` on all new/touched cash-register files — exit 0. |
| Runtime harness command/scenario and exact result | N/A for this batch — the DB-side RLS/RPC harness (`execute_sql` open→sell→movement→close→re-read, per-role probes) and UI E2E require Supabase MCP access, which this apply run does not have. Deferred to orchestrator (tasks 0.1, 1.6, 3.6, 4.5, 5.4). |
| Rollback boundary | Section 17 is additive-only up to and including §17.7; §17.8 (last statement) is the only behavior-changing statement and has a full commented reverse block at §17.9. App-side changes are isolated to the listed files above and can be reverted independently of §17 being applied (all new `cash_session_id` reads/writes degrade gracefully to `null` if the column doesn't exist yet — though in practice §17 ships in the same PR). |
