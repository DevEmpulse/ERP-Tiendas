# Tasks: Cash Register — Caja Sessions (Phase 3)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1185 total (PR1 ~245 / PR2 ~110 / PR3 ~270 / PR4 ~300 / PR5 ~260) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 5 PRs (design named 4; `cashSession.ts`+`roles.ts` split out as its own PR — it has no 17.8 dependency) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — recommend feature-branch-chain (PR3/PR4/PR5 all import PR2's lib) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Verification | Harness | Rollback |
|---|---|---|---|---|---|
| 1 | Schema+RLS+RPC | PR1 | execute_sql per-role | dev branch, get_advisors | 17.9 block |
| 2 | `cashSession.ts`+`roles.ts` | PR2 | npm run build | N/A, pure lib | delete 2 files |
| 3 | 17.8+bugfix+attribution | PR3 | execute_sql closed-session probes | dev branch open→sell→close→edit | restore 16.5 policies; revert 3 files |
| 4 | Open/close+movements UI | PR4 | manual E2E | dev branch UI | remove panel+4 mounts |
| 5 | History view+docs | PR5 | manual E2E | dev branch UI | remove view+mounts+docs |

## Phase 0: Pre-Apply Probe

- [x] 0.1 `execute_sql`: sales count = 0. Re-confirmed 2026-08-29 immediately before applying section 17.

## Phase 1: Schema+RLS+RPC (PR1) — after Phase 0

- [x] 1.1 17.1-17.2: `cash_sessions`+`cash_movements` tables, closed-shape CHECK, partial unique index, coherence key.
- [x] 1.2 17.3: RLS enable + SELECT/INSERT policies, both tables.
- [x] 1.3 17.4-17.5: `sales.cash_session_id`, composite FK, BEFORE INSERT stale-attach trigger.
- [x] 1.4 17.6: `close_cash_session` SECURITY DEFINER RPC.
- [x] 1.5 17.7+17.9: grants/revokes; commented rollback block.
- [x] 1.6 Verify: applied section 17 to production. Real impersonation tests (throwaway caja profile + real admin): dup-open at the same branch → rejected (`23505`). Open (plain INSERT) → succeeds, `opened_by` pinned correctly. Close RPC: opening 1000 + one $300 cash sale + one $100 cash_out → `expected_amount = 1200.00` exactly; `counted_amount = 1190` → `discrepancy = -10.00` exactly. Double-close → rejected ("Cash session is already closed"). `get_advisors`: `close_cash_session` shows only in the `authenticated`-callable list, NOT in `anon` — confirms `REVOKE EXECUTE FROM PUBLIC, anon` worked; same pre-existing WARN pattern as every other SECURITY DEFINER RPC in this repo, no new finding class. Not independently tested: NULL-attach via the BEFORE INSERT trigger degrading a genuinely stale/foreign id (only tested a valid attach) — low risk, trigger logic is simple and mirrors `set_sale_item_branch` exactly.

## Phase 2: Shared Cash-Session Lib (PR2) — after Phase 1

- [x] 2.1 Create `src/lib/cashSession.ts`: `CashSession` type + `fetchOpenSession`/`openSession`/`closeSession`/`addCashMovement`.
- [x] 2.2 `src/lib/roles.ts`: add `CASH_SESSION_ROLES` + `canOperateCashSession`.
- [x] 2.3 `npm run build` passes. (`pnpm run build` — verified clean)

## Phase 3: 17.8 + Bug Fix + Attribution (PR3) — after Phase 2

- [x] 3.1 17.8: replace the 4 Shape D policies with the closed-session clause; admin/superadmin arms unchanged; write the elided bodies in full.
- [x] 3.2 `salesHelper.ts`: add `cash_session_id` field to `Sale`/`GroupedSale`, populate both read sites; `deleteSaleGroup` returns deleted ids instead of `{error}` only.
- [x] 3.3 `sales-form.tsx`: resolve open session once per submit; attach to the single + 3 combined inserts.
- [x] 3.4 `SaleModal.tsx`: resolve+attach on all inserts; abort the edit-mode recreate on a short delete count; read-only attribution line.
- [x] 3.5 `MySalesView.tsx`: abort recreate on a short delete count; surface the closed-session denial as a message; pass `cash_session_id` through select+mapper.
- [x] 3.6 [VERIFY-PARTIAL] Real impersonation test using the closed session from 1.6: the caja who created the sale attempted `UPDATE`/`DELETE` on their own sale after close → **both affected 0 rows** (`total_amount` unchanged). The real admin then successfully `UPDATE`d the same sale (300 → 999) — confirms the admin-exempt arm. Confirmed the closed session's `expected_amount`/`discrepancy`/`counted_amount` did **not** change after that later admin edit (frozen-at-close verified directly, not just structurally). Not independently tested this round: `sale_items` closed-session denial specifically (only the parent `sales` row was tested) and the `deleteSaleGroup`/`SaleModal` abort path end-to-end through the actual UI (code-reviewed and confirmed correct, but not exercised live — needs a manual pass by the user with a real edit attempt).

## Phase 4: Open/Close+Movements UI (PR4) — after Phase 2

- [x] 4.1 Create `src/components/shared/CashSessionPanel.tsx`: banner + open/close/cash-in-out dialogs; null-branch placeholder.
- [x] 4.2 `employee-dashboard.tsx`: mount panel above tabs, widen tab union with `'cash'`.
- [x] 4.3 `sidebar-items.ts`: add `'cash'` section + menu entry.
- [x] 4.4 `admin/page.tsx`+`encargado/page.tsx`: `case 'cash'` on the respective branch scope.
- [ ] 4.5 Manual E2E: open → sale → cash-out → close with a discrepancy; a duplicate-open surfaces as "ya hay una sesión abierta". **Requires orchestrator — no Supabase MCP access / live dev branch in this apply run.**

## Phase 5: History View+Docs (PR5) — after Phase 4

- [x] 5.1 Create `src/components/shared/CashSessionHistoryView.tsx`: per-session reconciliation, expandable movements, post-close flag, "efectivo sin caja" counter.
- [x] 5.2 Mount alongside the panel in both `admin/page.tsx` and `encargado/page.tsx`.
- [x] 5.3 `docs/database.md`+`docs/features.md`: document section 17 and its invariants.
- [ ] 5.4 Manual: admin sees store-wide history; caja/encargado see only their own branch, read-only. **Requires orchestrator — no Supabase MCP access / live dev branch in this apply run.**
- [x] 5.5 `npm run build`; final `get_advisors` pass. `pnpm run build` verified clean (TS strict, 0 errors) by the apply agent, re-confirmed by the orchestrator. `get_advisors(security)` run by the orchestrator after applying section 17 — no new finding class; also directly confirmed `cash_movements` is immutable even for a real admin (`UPDATE` → `permission denied for table cash_movements`, the `REVOKE` working as intended).
