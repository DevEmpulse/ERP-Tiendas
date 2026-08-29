# Proposal: Cash Register — Caja Sessions (Phase 3)

## Intent

A store owner cannot answer the one question every retail till raises at the end of a
shift: *how much cash should be in the drawer right now, and how much actually is?*
Nothing in the schema models a till, a shift, an opening float, or a count — grep across
`src/` and `migration.sql` for `caja|turno|cash.?register|till|session|fondo|arqueo`
returns only the `caja` **role name** and Supabase auth sessions. Cash discrepancies are
therefore invisible: an employee's shortfall, a forgotten cash-out to a supplier, and a
miscounted float are all indistinguishable from correct operation.

`granular-roles` shipped the `caja`/`encargado` operators and Shape D's branch-scoped
verb-split RLS on `sales` (`migration.sql:1413-1547`). It also left a latent audit gap:
that policy restricts a caja's UPDATE/DELETE to `employee_id = auth.uid()` at their own
branch **with no date restriction** — `MySalesView.tsx`'s "today only" window is a
browser-local query filter, not a database guarantee. Today that is harmless. The moment
a closed session records an `expected` and a `discrepancy`, a caja voiding an old sale
silently falsifies a reconciled number. This phase creates that risk, so it must close
it in the same change.

Production is at **0 sales** (re-verified via `execute_sql`, 2026-08-29). Every prior
phase used exactly this window to tighten `sales`; it closes the day real volume starts.

## Scope

### In Scope

**A. `cash_sessions` — per-branch single active session**
`(id, store_id, branch_id, opened_by, opened_at, opening_amount, status CHECK IN
('open','closed'), closed_by, closed_at, counted_amount, expected_amount, discrepancy)`.
Shape B RLS verbatim (`migration.sql:851-866`). A partial unique index
`(branch_id) WHERE status = 'open'` makes "one open till per branch" a **database**
invariant, not a UI convention. `admin`/`superadmin` may open and close a session at any
branch of their store; `encargado`/`caja`/legacy `employee` at their own branch only.

**B. `cash_movements` — append-only manual cash in/out ledger**
`(id, cash_session_id, store_id, branch_id, type CHECK IN ('cash_in','cash_out'),
amount, reason, note, created_by, created_at)`. Mirrors `stock_movements` exactly:
Shape B split across SELECT/INSERT with no UPDATE/DELETE policy, plus
`REVOKE UPDATE, DELETE FROM authenticated, anon` at the privilege layer
(`migration.sql:868-890`, `:1038`). **Sale-driven cash is derived, never duplicated
here** — only manual entries (paying a supplier, adding change, a post-close correction)
live in this table.

**C. `sales.cash_session_id uuid NULL REFERENCES cash_sessions(id)`**
Nullable and additive. A sale made with no open session is created with `NULL` —
unattributed, exactly like `sale_items.product_id IS NULL` for an unmatched name.
**No sale is ever blocked by session state.** The column is attached to sales of *every*
payment method (shift attribution), while the cash math filters `payment_method = 'cash'`.
Verified: `sales-form.tsx:344-402` splits a combined payment into one `sales` row **per
method**, so `Σ(cash) = SUM(total_amount) WHERE payment_method='cash'` is exact — there is
no partial-cash amount to apportion.

**D. Frozen reconciliation at close**
`expected_amount = opening_amount + Σ(cash sales at this session) + Σ(cash_in) − Σ(cash_out)`,
computed and **stored** at close; `discrepancy = counted_amount − expected_amount`
(signed: over/short). Not a live view — a closed session's numbers never move again.

**E. Post-close correction block (DB-enforced, admin/superadmin exempt)**
Shape D's `sales` UPDATE/DELETE policies (`:1440-1477`) and `sale_items`' equivalents
(`:1504-1547`) gain one condition on the **encargado/caja/employee arms only**: the row's
`cash_session_id` must be NULL or point to a session that is **not** `closed`. The
`admin`/`superadmin` arms are left untouched — they keep unconditional access, consistent
with this repo's existing convention that admin/superadmin bypass every branch predicate
in Shape B/C/D. Editing a sale inside a closed session is rejected by the database for
`encargado`/`caja`/`employee`; an admin can still correct it directly if needed, though the
`cash_movements` correction path (F) remains the recommended, auditable way to do so even
for admin. The `sale_items` policies already carry an
`EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id …)` subquery, so the
condition extends that existing predicate rather than adding a new join.

**F. The correction path that replaces sale editing**
A closed session is **never reopened** — closed is closed. A mistake found after close is
resolved by an explicit `cash_movements` entry (e.g. `cash_out` of the erroneous amount
with a `reason`/`note`), which is visible, attributed, and append-only. This makes a
correction an auditable event rather than a silent rewrite of history.

**G. UI**
- Open/close session banner + control in `employee-dashboard.tsx`, the `/encargado` shell,
  and the admin sale-entry surface. Shows who opened, since when, and the running expected
  cash; the close dialog asks for `counted_amount` and shows the resulting discrepancy
  before confirming.
- Manual cash-in/cash-out action, available only while a session is open.
- A **new** session-history / reconciliation view. `EmployeeReport.tsx` is a
  per-employee-per-period aggregator with no branch filter and does not extend to
  per-session windows — this is additive, not a modification of it.
- The four sale-writer call sites (`sales-form.tsx` single + combined, `SaleModal.tsx`
  create + edit, `MySalesView.tsx`) resolve the branch's currently-open session and attach
  `cash_session_id` (or `NULL`) on insert, mirroring how `branch_id` was added in
  `store-branches`.

### Out of Scope

- Blocking, gating, or warning-modal-ing a sale because no session is open (decision: no
  gate, ever).
- Reopening a closed session; auto-closing a stale one; scheduled/cron close.
- A `registers`/`tills` entity separate from `branches` (exploration Approach 3 — zero
  evidenced consumers).
- Per-employee concurrent sessions at one branch (Approach 2).
- New POS UI redesign and barcode scanning — Phase 4. Analytics/reporting beyond basic
  session history — Phase 7. QA audit — Phase 8.
- Any change to the `caja`/`stock`/`encargado` role model itself (shipped in
  `granular-roles`).
- Duplicating sale amounts into `cash_movements`.

## Capabilities

### New Capabilities

- `cash-sessions`: the per-branch single-open-session invariant, open/close lifecycle and
  who may perform it per role, `sales.cash_session_id` attribution (including the
  no-open-session `NULL` case), the frozen `expected`/`counted`/`discrepancy` math at
  close, session-history visibility per role, and the closed-session immutability rule.
- `cash-movements`: the append-only manual cash-in/cash-out ledger, its typed
  `type`/`reason`, its Shape B + `REVOKE` immutability, its exclusion of sale-driven cash,
  and its role as the only post-close correction path.

### Modified Capabilities

- `role-aware-data-access`: Shape D's `sales` UPDATE/DELETE predicates gain the
  closed-session condition. **Note for `sdd-spec`**: this capability is not yet in
  `openspec/specs/` — its current text lives in
  `openspec/changes/granular-roles/specs/role-aware-data-access/spec.md` (unarchived).
- `sale-line-items`: `sale_items` UPDATE/DELETE gain the same closed-session condition via
  the existing `EXISTS (… public.sales s …)` subquery, so a closed sale's lines cannot be
  gutted (which would reverse stock) even though they do not affect the cash math.

## Approach

Append **section 17** to root `migration.sql` (16 is `granular-roles`), ordered so a
partial apply never breaks the POS: create `cash_sessions` + its partial unique index
first, then `cash_movements` + RLS + `REVOKE`, then the nullable `sales.cash_session_id`,
and the Shape D policy replacement **last** — until that final statement runs, everything
added is inert and additive.

Every predicate reuses vocabulary already in the file rather than inventing a new shape:
Shape B verbatim for both new tables (`:851-890`), `'admin'` always paired with
`'superadmin'` (`:856`, `:1422`, `:1470`), and `'caja'` always paired with `'employee'` as
the legacy-compatibility rule expressed in SQL (`:1434`, `:1448`).

`expected_amount` is computed inside a `SECURITY INVOKER` close RPC — not client-side —
so the frozen number is derived from rows the closer can actually see under RLS, and the
close and its computation are one transaction. `sdd-design` decides whether the partial
unique index alone suffices against a double-open race or whether the open path also
needs an RPC.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `migration.sql` | Modified | New section 17: `cash_sessions` + partial unique index, `cash_movements` + Shape B RLS + `REVOKE`, `sales.cash_session_id`, close RPC, Shape D UPDATE/DELETE replacement, grants, rollback block |
| `src/components/employee/employee-dashboard.tsx` | Modified | Session banner + open/close control alongside the existing tabs |
| `src/components/employee/sales-form.tsx` | Modified | Resolve open session; attach `cash_session_id` on the single + 3 combined insert paths (`:344-428`) |
| `src/components/employee/MySalesView.tsx` | Modified | Attach `cash_session_id` on recreate; surface the DB rejection when the sale's session is closed |
| `src/components/admin/SaleModal.tsx` | Modified | Attach the selected branch's open session on create/edit |
| `src/components/employee/CashSessionPanel.tsx` (or similar) | New | Open/close dialog, counted-amount entry, cash-in/cash-out action |
| `src/components/shared/CashSessionHistoryView.tsx` (or similar) | New | Session history + reconciliation, role-scoped visibility |
| `src/app/encargado/page.tsx`, `src/app/admin/page.tsx` | Modified | Mount the session control and history view |
| `src/lib/salesHelper.ts` | Modified | `Sale`/`GroupedSale` gain `cash_session_id?: string \| null` |
| `src/lib/roles.ts` | Modified | Add a session-operator predicate composed from existing role exports |
| `docs/database.md`, `docs/features.md` | Modified | Section 17 tables, the closed-session invariant |
| `src/components/admin/EmployeeReport.tsx` | Unchanged | Shape does not fit per-session reporting |
| `branch_stock` / `stock_movements` | Unchanged | Untouched by this phase |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| The closed-session condition also blocks a *legitimate* same-shift correction because the session was closed minutes earlier | Med | The `cash_movements` correction path (F) is in scope and must ship in the same slice as the block — never ship the block first |
| An overnight session nobody closed makes the next day's expected cash meaningless | Med | Banner shows `opened_at`; a session open across a date boundary is visually flagged. No auto-close (it would fabricate a `counted_amount`) |
| Two clients open a session at the same branch simultaneously | Low | Partial unique index rejects the second at the database; UI must surface the unique-violation as "ya hay una sesión abierta", not a raw error |
| Sales silently accumulate with `cash_session_id = NULL` because operators never open a session | Med | Session-history view reports unattributed cash per branch per day, so the gap is visible instead of invisible |
| A stale client-side session id attaches a sale to a session closed a second earlier | Low-Med | The close RPC computes `expected` from rows present at close; a late-arriving sale becomes visible as a discrepancy, not a silent loss. `sdd-design` may add an INSERT-time check |
| Schema + attribution across 4 writers + open/close UI + history view far exceeds the 400-line budget | High | `sdd-tasks` slices by dependency: (1) schema + RLS, (2) writer attribution, (3) open/close + movements UI, (4) history/reconciliation view |
| `get_advisors` flags the new tables or the close RPC | Low-Med | Run advisors on the dev branch before production, as in every prior phase |

## Rollback Plan

Section 17 ships with an explicit `down` block, reversed bottom-to-top: restore the four
Shape D `sales` and `sale_items` UPDATE/DELETE policies **verbatim from
`migration.sql:1440-1477` and `:1504-1547`** (the closed-session condition is the only
delta, so the restore is a literal copy); drop the close RPC; drop
`sales_cash_session_id_idx` and `ALTER TABLE public.sales DROP COLUMN IF EXISTS
cash_session_id` (the FK dies with the column); `DROP TABLE public.cash_movements CASCADE`;
`DROP TABLE public.cash_sessions CASCADE`. Strict ordering: policies before the column
they reference, the column before the table it points at, `cash_movements` before
`cash_sessions`.

Rolling back destroys session history. With 0 sales today that is a no-op; after
production use, snapshot first. Revert the UI commits together with the SQL — a
rolled-back schema with a live session banner produces a permanent client error.

## Dependencies

- **`granular-roles` applied** — six-value role ladder, Shape C/D, section 16. Confirmed
  live at `migration.sql:1071-1660`.
- **`store-branches` applied** — `branches`, `profiles.branch_id`,
  `get_current_user_branch_id()`, Shape B. Confirmed live.
- **`stock-phase2-quantities-movements` applied** — the `stock_movements` append-only
  pattern this ledger mirrors. Confirmed live.
- Production state re-verified via `execute_sql` on **2026-08-29: 0 sales**. This is what
  makes tightening `sales` UPDATE/DELETE safe — no historical row can be stranded.
- Supabase dev branch for apply/verify; `execute_sql` and `get_advisors`.

## Success Criteria

- [ ] A second `INSERT` into `cash_sessions` with `status='open'` for a branch that
      already has one open session is rejected by the **database**.
- [ ] A `caja` can open and close a session at their own branch, and is rejected for any
      other branch; an `encargado` likewise; an `admin` succeeds for any branch of their
      store.
- [ ] A cash sale made with no open session succeeds and lands with
      `cash_session_id IS NULL` — no error, no modal, no gate.
- [ ] A cash sale made while a session is open lands with that session's id, on all four
      writer paths, including each row of a combined payment.
- [ ] Closing a session stores `expected_amount = opening + Σcash + Σcash_in − Σcash_out`
      and `discrepancy = counted − expected`; re-reading it later returns the same
      numbers regardless of any later activity.
- [ ] A `caja` attempting to UPDATE or DELETE their own sale whose `cash_session_id`
      points to a `closed` session gets zero rows affected; the same sale is editable
      while that session is still open.
- [ ] The same block holds for that sale's `sale_items` rows.
- [ ] An `admin`/`superadmin` can still UPDATE/DELETE a sale belonging to a `closed`
      session (exempt from the block, per the resolved question round).
- [ ] A `cash_movements` row cannot be updated or deleted by `authenticated` through any
      path (RLS default-deny **and** `REVOKE`).
- [ ] `cash_movements` contains **no** sale-derived rows after a full open→sell→close
      cycle; only manual entries.
- [ ] Admin sees store-wide session history; encargado and caja see their own branch's.
- [ ] `npm run build` passes; `get_advisors` reports no new security findings.

## Proposal question round — RESOLVED (user decision) + assumptions

The five forks from the exploration are resolved in `state.yaml` and were not reopened.
Writing the proposal surfaced three new decisions.

**Q1 — Does the post-close block apply to `admin`/`superadmin` too?** → **No, admin/
superadmin are exempt.** They keep unconditional UPDATE/DELETE on `sales`/`sale_items`
regardless of session state, consistent with this repo's existing convention that
admin/superadmin bypass every branch predicate in Shape B/C/D. The block applies only to
the `encargado`/`caja`/`employee` arms of those policies. The `cash_movements` correction
path (F) remains the recommended way for admin to record a post-close fix, but is not
DB-enforced as the only path for that role.

**Assumption A1 — Caja's session-history visibility.** Shape B falls through to branch
equality, so `caja` reads their own branch's full session history (including past days),
read-only. Cheapest and consistent with `stock_movements`. If caja should only see the
session they are currently operating, say so — it needs an extra predicate.

**Assumption A2 — Shift hand-off.** Per decision #1, any authorized role at the branch can
operate the branch's open session, so an incoming caja simply continues the open one; no
explicit hand-off protocol, no forced close at shift change. A session may stay open
across a date boundary and is never auto-closed (an automatic close would have to invent a
`counted_amount`, which is exactly the number that must be human-supplied).
