# Exploration: QA Audit (P8) — Cross-Cutting Regression, Consistency, and Documentation Review

### Current State

**1. Unverified manual-testing debt (accumulated, real, named)**

`openspec/changes/pos-ui/tasks.md`:
- Every checkbox in T1–T6 (lines 28–98) is still `[ ]` unchecked in the file, even though `openspec/changes/pos-ui/state.yaml` (`phases.apply`, lines 49–89) records the work as fully applied and build-verified. This is checkbox/audit-trail drift, not necessarily undone work — `npm run build` passing and `/pos` being live in production are independently corroborated by the state.yaml apply note.
- The part of T6 that is genuinely unverified regardless of checkbox drift is the 12-item live E2E checklist, `tasks.md:87-97` (T6.7.1–T6.7.12): barcode scan-to-add, unknown-barcode toast, name search add, unlisted-product add, inline qty/price edit, oversell → stock warning → confirm → stock clamp, split payment across two `sales` rows sharing one `Ref:`, receipt modal output, encargado flow parity, and a DB-level check that every catalog line has non-null `product_id`. None of this requires Supabase access alone — it requires a live authenticated browser session with an actual (or simulated) barcode scanner.
- T7 (post-apply bugfix batch, admin-branch-selection + price-rule regression) is fully checked (`tasks.md:102-108`) and independently corroborated by grep evidence recorded in 7.4.

`openspec/changes/analytics/tasks.md` — unchecked items, correctly tagged `[VERIFY][ORCHESTRATOR]` or `[ORCHESTRATOR/USER]`:
- `1.11` — admin branch-switch recomputes Dashboard/History KPIs.
- `1.12` — encargado sees no misleading `$0` for other-branch staff; admin sees `caja`/`encargado` sellers.
- `3.7` — `caja`/`stock`/`employee` are redirected away from `/analytics`.
- `4.10`–`4.13` — admin branch filter recomputes all 4 panels; encargado sees own-branch only; low-stock panel filters correctly; refresh recomputes with no realtime push.
- `5.4` — PDF export reflects the currently displayed metrics.
- `7.15` — the "Stock mínimo" field in `StockAdjustDialog.tsx` actually surfaces a low-stock row once `current_stock <= min_stock`.

The SQL-level RLS impersonation tests (`2.10`, `7.16`, `6.2`) were already done live against production by the orchestrator and are checked/corroborated — those should NOT be re-run; only the browser-dependent UI items above are outstanding.

**2. Scope-mismatch bug class (profiles-vs-branch-scoped-table) — searched, not found elsewhere**

`EmployeeReport.tsx` is fixed (`src/components/admin/EmployeeReport.tsx:68-94, 130`): reads the caller's own `role`/`branch_id` first, scopes the `profiles` query to `callerBranchId` for non-admins, uses `SALES_REPORT_ROLES`.

Grepped every `.from('profiles')` call site in `src/` (14 hits). The two that combine `profiles` with a branch-scoped table in the same view:
- `admin/page.tsx:203-209` — branch-filtered `salesQuery` alongside an unfiltered store-wide `profiles` fetch. Safe: admin-only page (store-wide role by definition), used only to resolve `employee_id → name`, not to enumerate-then-aggregate per employee.
- `encargado/page.tsx:103-111` — fetches only the caller's own profile row. Not at risk.

No other occurrence of the bug class was found.

SQL views/functions: the only `CREATE VIEW` is `analytics_low_stock` (`migration.sql:2175`), correctly `WITH (security_invoker = true)`, driven from `branch_stock` (branch-scoped). All six analytics functions are `SECURITY INVOKER`. Only `analytics_branch_comparison` drives `FROM public.branches` (store-wide readable) and already carries the explicit hand-derived predicate. `analytics_cash_discrepancy` joins `profiles` only for display of `closed_by`'s name on rows already scoped by `cash_sessions`' own branch-scoped RLS — not a driving-table leak. No other view/function needs this treatment.

**3. RLS/SECURITY DEFINER advisory debt**

Every `SECURITY DEFINER` function in `migration.sql`: `handle_new_user()`, `delete_employee_user(p_employee_id)`, `update_employee_user(...)` (two overloads), `get_current_user_store_id()`, `get_current_user_role()`, `get_current_user_branch_id()`, `preload_employee(...)`, `close_cash_session(...)`.

Only `close_cash_session` has an explicit `REVOKE EXECUTE ... FROM PUBLIC, anon` followed by a scoped `GRANT ... TO authenticated` — the pattern later reused consistently for every stock-phase2/analytics function. **`delete_employee_user`, `update_employee_user`, `preload_employee`, and the three `get_current_user_*` helpers have no such explicit revoke anywhere in the file.** Since Postgres grants `EXECUTE` to `PUBLIC` by default and Supabase's PostgREST exposes `public` schema functions as RPC endpoints, these remain directly callable by `anon`/`authenticated` at the SQL level, relying entirely on internal `auth.uid()`-based checks rather than a revoke-based defense-in-depth layer. For an unauthenticated `anon` caller, `auth.uid()` is `NULL`, so the internal `EXISTS (... id = auth.uid() ...)` check fails closed — no confirmed exploit path from the SQL text alone — but this is undocumented drift against the precedent this codebase established from stock-phase2 onward, worth an explicit revoke, ahead of the read-only helpers.

**4. Cross-role UI consistency**

Grepped every `role === '<literal>'` occurrence outside `roles.ts`. All hits are either correctly using `roles.ts` constants or legitimate role-specific branches consistent with the current 4-role model. `UserManager.tsx`'s `role === 'employee'` branches (:806, :811-822) are intentional legacy handling: `'employee'` is excluded from `*_ASSIGNABLE_ROLES` for *new* profiles, but an already-`employee` profile must still show its own current role in its edit dropdown. No stale role check left over from before granular-roles was found.

**5. Dead code / orphaned artifacts**

`grep -r "sales-form" src/` → 1 hit, `PosShell.tsx:140`, a comment only — confirmed clean. `grep -r "CashDiscrepancyPanel|fetchCashDiscrepancy|CashDiscrepancyRow" src/` → 0 hits. `analytics_cash_discrepancy` SQL function remains unused in production — documented, accepted debt, not a new finding.

**6. Documentation staleness**

`docs/database.md`:
- **Duplicate, contradictory `profiles` table sections.** Lines 16-24 document the pre-granular-roles schema (`role CHECK in ('admin', 'employee', 'superadmin')`), while a second section at lines 229-237 documents the actual current 6-role CHECK. The old section was never removed.
- **Stale/self-contradicting `sales.branch_id` claim.** Line 53 says RLS stays store-wide for `sales` — directly contradicted by the correct RLS table further down the same file (line 250, Shape D, branch-and-verb-split).
- **Dead-file reference.** Line 150 still names `sales-form.tsx` as one of "the four points of sale" — that file is deleted; the doc was never updated to name `/pos`.
- **Missing entirely**: migration.sql sections 18–19 (all 6 analytics objects) have zero mention anywhere in `docs/database.md`.

`docs/features.md`:
- Section 1 (lines 7-21) still describes `sales-form.tsx` as (co-)owning sale entry — the file is deleted and `/pos` is completely unmentioned.
- Lines 88-89, "Desglose por Medio de Pago" claim — confirmed still false by direct read of `KpiCards.tsx` (zero matching code). Same stale claim the `analytics` exploration already flagged, still unfixed.
- `/analytics` (product ranking, branch comparison, low-stock, sales trend, category comparison, PDF export) has no section at all.

**7. Build/lint health**

The exploration agent had no Bash access this run and could only reconstruct this from `analytics/state.yaml`'s prior notes (2026-08-30): build passes with 0 TypeScript errors; lint has pre-existing warnings in `ProductImportDialog.tsx`, `MySalesView.tsx`, `StockAdjustmentView.tsx`, `employee-dashboard.tsx`, `ProductPicker.tsx`, `CashSessionStatusBadge.tsx`, `StockAdjustDialog.tsx` (all `react-hooks/set-state-in-effect`), and one `@typescript-eslint/no-explicit-any` in `salesHelper.ts`. The orchestrator re-ran both independently — see `key_findings.build_lint_reverified` in state.yaml for the actual current result.

**8. Data-integrity spot checks (schema-only)**

FK `ON DELETE` behavior is consistent everywhere except: `profiles.branch_id` and `sales.branch_id` reference `branches(id)` with no `ON DELETE` clause (defaults to `NO ACTION`), while the composite FKs from `branch_stock`, `stock_movements`, `cash_sessions`, `cash_movements` all use `ON DELETE CASCADE` against `branches (store_id, id)`. If a branch with zero linked profiles/sales but real stock/cash history were ever hard-deleted, the cascade would silently destroy `stock_movements`/`cash_movements` — both documented as immutable, append-only audit ledgers. Today this is dormant: zero call sites do `.from('branches').delete(`; branches are only ever soft-deleted via `is_active`. Worth flagging as a trap for any future hard-delete feature, not an active bug.

### Affected Areas

- `docs/database.md` — duplicate `profiles` section, stale `sales.branch_id` RLS claim, dead `sales-form.tsx` reference, missing §18/§19 analytics documentation.
- `docs/features.md` — stale sale-entry section, stale payment-breakdown claim, missing `/analytics` section.
- `migration.sql` — optional explicit `REVOKE EXECUTE ... FROM PUBLIC, anon` for `delete_employee_user`, `update_employee_user`, `preload_employee`; optional `ON DELETE` alignment for `profiles.branch_id`/`sales.branch_id`.
- `openspec/changes/pos-ui/tasks.md` — checkbox drift, and the still-outstanding 12-item live E2E checklist.
- `openspec/changes/analytics/tasks.md` — 9 outstanding `[VERIFY]` items requiring a live browser session.

### Approaches

1. **Documentation-only fix pass + explicit verification-debt ledger, defer SQL/lint changes.** Fix `docs/database.md`/`docs/features.md` staleness now (cheap, zero behavioral risk); formally record the pos-ui/analytics manual-verification debt as a tracked backlog item; leave SECURITY DEFINER revoke hardening and the FK cascade inconsistency as explicitly-noted, deliberately-deferred low-severity debt.
   - Pros: fastest, lowest risk, closes the credibility gap between docs and shipped code.
   - Cons: doesn't close the actual RLS/lint gaps, only documents them.
   - Effort: Low.

2. **Full remediation.** In addition to (1): add the missing `REVOKE EXECUTE` statements, align `ON DELETE` behavior, and fix the accumulated lint warnings across the 7 named files.
   - Pros: closes every gap this audit found.
   - Cons: touches production RLS grants (needs the same live-impersonation-test discipline as every prior schema phase) and 7+ unrelated UI files for lint-only changes with no functional payoff; real risk of scope creep.
   - Effort: Medium-High.

3. **Audit only, no fixes this phase.** Ship this exploration as the terminal artifact for P8; every finding is triaged by the user into immediate small fixes or a follow-up backlog.
   - Pros: matches "P8: QA audit" literally.
   - Cons: docs staleness keeps confusing future readers/agents if left unfixed indefinitely.
   - Effort: none.

### Recommendation

Approach 1. The documentation fixes are cheap, safe, and directly reduce the exact kind of confusion this session has already been fighting once (`docs/features.md:89`). The RLS revoke hardening and the FK cascade inconsistency are real but low-severity (no confirmed exploit path, no active trigger) — track them, don't rush them into this phase. The manual-verification debt for pos-ui/analytics should be named explicitly to the user as a decision point, not silently carried forward again.

### Risks

- Build/lint state needed independent re-verification by the orchestrator (the exploration agent had no Bash access this run).
- The SECURITY DEFINER revoke gap and FK cascade inconsistency are reasoned from SQL text only, not cross-checked against a fresh `get_advisors()` call at exploration time.
- The pos-ui T6.7 live E2E checklist (barcode scanning, split payment, receipt printing, stock clamping) has never been run end-to-end since `/pos` first shipped.

### Ready for Proposal

Yes — with a narrowed scope, pending the user's choice between Approach 1 (docs-only + tracked debt ledger) and Approach 2 (full remediation), since they differ materially in whether production RLS grants get touched.
