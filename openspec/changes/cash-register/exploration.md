# Exploration: cash-register (Phase 3 — Cash Register / Caja Sessions)

## Current State

**Schema (migration.sql, 1663 lines, sections 1–16 applied).** `sales` carries
`payment_method CHECK (IN ('cash','transfer','card'))`, `branch_id` (nullable,
added in `store-branches`), `employee_id` (nullable, `ON DELETE SET NULL`),
`total_amount`. `sale_items` carries a denormalized `branch_id` (BEFORE INSERT
trigger `set_sale_item_branch`) and drives `branch_stock`/`stock_movements` via
`apply_sale_item_stock()`. There is **no** concept of a till, register, shift,
or cash session anywhere in the schema — confirmed by grep across `src/` and
`migration.sql` for `caja|turno|cash.?register|till|session|fondo|arqueo`: the
only hits are the `caja` **role name** (8 files, all from `granular-roles`) and
generic Supabase **auth** sessions (`middleware.ts`, `server.ts`, `callback/route.ts`),
unrelated to a physical cash drawer. This confirms the phase is greenfield, as
every prior phase's proposal explicitly deferred it.

**Roles (from `granular-roles`, applied).** `admin | encargado | caja | stock |
employee | superadmin`. `caja` and legacy `employee` are `POS_ROLES` — branch-scoped,
can create sales and (new in that phase) correct/void **their own** sales via
`MySalesView.tsx` + `SaleModal.tsx` reuse. `encargado` is functionally an admin
restricted to one branch (full sales/stock/catalog/employee-management at that
branch). `admin`/`superadmin` float store-wide with `branch_id IS NULL`.

**RLS on `sales`/`sale_items` (Shape D, section 16.5).** Verb-split:
`admin`/`superadmin` full store-wide; `encargado` full at own branch; `caja`/`employee`
SELECT+INSERT at own branch, **UPDATE/DELETE restricted to `employee_id = auth.uid()`**
at own branch — **with no date/time restriction in the database**. The "same-day
only" window is enforced **only in `MySalesView.tsx`'s query** (`created_at >=
today's local midnight`, browser-local), not by RLS. This is a load-bearing fact
for the cash-session design (see "Correction edge case" below).

**`stock_movements` ledger pattern (section 15.5, to mirror).** Append-only:
`reason` CHECK enum, `quantity_delta` (requested/audit) vs `applied_delta`
(actually applied) vs `resulting_balance`, `REVOKE UPDATE, DELETE FROM
authenticated, anon` at the privilege layer *in addition to* RLS having no
UPDATE/DELETE policy — belt-and-suspenders immutability. Shape B RLS
(`store_id = own store AND (admin/superadmin OR branch_id = own branch)`) is
reused verbatim by `branch_stock` too. This is the direct precedent for a
"cash movements" ledger.

**Four sale-writer call sites** (unchanged in this investigation, all populate
`branch_id`/`employee_id` already): `sales-form.tsx` (caja/employee, single +
combined payment), `SaleModal.tsx` (admin create, and — reused verbatim by
`MySalesView.tsx` — caja self-correction via delete-then-recreate).

**Existing reporting.** `src/components/admin/EmployeeReport.tsx` exists: a
day/month toggle aggregating `sales` by `employee_id` (amount, count, % share of
store total), admin-only, **no branch filter at all** (relies on RLS admin
seeing the whole store). It is a per-employee-per-period aggregator, not a
per-session one — its shape does not extend cleanly to session history (a
session groups sales by open/close window and a specific opening/counted cash
amount, not by calendar day). Treat as a **new capability**, not a modification
of `EmployeeReport.tsx`.

**Production data.** Last directly verified by `granular-roles` (2026-08-29,
via `execute_sql`): **0 sales**. No historical cash-flow data to reconcile
against. This exploration did not re-verify (no Supabase access from this
phase); a fresh count is cheap for the orchestrator to redo before `sdd-design`.

**"Also check" — no separate till/register entity.** `stores` has no
till concept; `branches` is the only physical-location primitive. Nothing
indicates the business needs multiple simultaneous physical registers per
branch — this is inferred from absence of evidence, not confirmed with the user,
and is flagged as Fork 1 below.

## Affected Areas

- `migration.sql` — new section 17: `cash_sessions` (+ RLS), `cash_movements`
  ledger (+ RLS, append-only like `stock_movements`), nullable `sales.cash_session_id` FK.
- `src/components/employee/sales-form.tsx` — needs session-open awareness
  (banner/gate), `cash_session_id` populated on the 4 insert objects when a
  session is open and belongs to the acting employee/branch.
- `src/components/employee/MySalesView.tsx` — correcting/voiding a sale whose
  session is already closed is a real edge case here (see below); currently
  has no awareness of session state at all.
- `src/components/employee/employee-dashboard.tsx` — needs a third
  tab/section (or a persistent header banner) for open/close session UI,
  alongside the existing "Nueva venta" / "Mis ventas de hoy" tabs.
- `src/components/admin/SaleModal.tsx` — admin-created sales' session
  attribution is ambiguous (admin has no fixed branch/till context) — open
  question, not resolved here.
- `src/lib/salesHelper.ts` — `Sale`/`GroupedSale` types likely gain
  `cash_session_id?: string | null`, mirroring how `branch_id` was added in
  `store-branches`.
- `src/lib/roles.ts` — no changes anticipated; session permissions likely
  compose from existing `POS_ROLES`/`BRANCH_SCOPED_ROLES` exports, but this
  needs confirming once the session-owner model (Fork 1) is resolved.
- New file(s) needed: an open/close session UI component under
  `src/components/employee/`, and a session-history/reconciliation view
  (admin store-wide, encargado own-branch — mirrors the existing Shape
  B/D visibility split) under `src/components/admin/` or `src/components/shared/`.
- `src/components/admin/EmployeeReport.tsx`, `DashboardView.tsx`,
  `HistoryView.tsx`, `SalesTable.tsx` — **not modified** by the recommended
  approach; a new session-history view is additive, not an extension of these.

## Open Forks Requiring a Product Decision (surface to the user in `sdd-propose`)

**Fork 1 — Session granularity: per-branch or per-employee?**
The current role model imposes no limit on concurrent `caja` profiles working
the same branch. Nothing in the schema or roadmap says whether two cajas at one
branch physically share one drawer or work separate ones. This is the single
biggest fork — it decides the whole schema shape (see Approaches below).

**Fork 2 — Enforcement strictness.**
Should the app **block** a `cash` sale when no session is open? Real POS
systems vary. Blocking mid-customer-transaction is a bad UX if a caja simply
forgot to open a session; not blocking risks unattributed cash sales. Also:
should opening a **second** concurrent session at the same branch be
DB-rejected, or just discouraged in the UI?

**Fork 3 — Does admin/encargado need to open/close sessions themselves, or only review them?**
`encargado` clearly needs both (they're the on-site register operator model).
`admin` is store-wide/branch-floating today (`branch_id IS NULL`) and typically
supervises remotely — but the existing `/admin` `SaleModal` lets an admin create
a sale at a selected branch. Does that sale need to attach to that branch's
open session, silently bypass it, or be blocked?

**Fork 4 — Correction of a sale after its session has closed.**
RLS lets a `caja` UPDATE/DELETE their own sale at their own branch **with no
date limit** — `MySalesView`'s "same-day only" window is UI-only, not a DB
guarantee. Today this is low-risk because nothing depends on the query result
being frozen. Once cash sessions exist, a caja correcting/voiding a sale that
belongs to an **already-closed, reconciled session** would silently invalidate
that session's recorded `expected`/`discrepancy` numbers — a real audit
integrity problem that did not exist before this phase. Three options, not
resolved here: (a) freeze closed-session reconciliation as an immutable
snapshot and accept that a later void makes it "stale but historically
accurate" (matches the append-only philosophy already used for
`stock_movements`); (b) add a DB/RPC guard that rejects any UPDATE/DELETE on a
`sales` row whose `cash_session_id` points to a closed session; (c) allow it
but flag the closed session as `needs_reconciliation_review`. This must be
decided in `sdd-design`, not assumed.

**Fork 5 — Mid-shift cash movements (cash-in/cash-out).**
Plausible real need for a multi-branch retail store (paying a supplier from
the till, adding change) but adds a second ledger table. Recommend scoping it
in as a minimal typed ledger (see Approach 1 below) rather than deferring,
since it's cheap to add now and expensive to retrofit into an already-closed
session's math later — but confirm with the user rather than assume.

## Approaches

1. **Per-branch single active session ("one till" model)**
   One `cash_sessions` row can be `status = 'open'` per `branch_id` at a time
   (DB-enforced via a partial unique index `WHERE status = 'open'`). Any
   `caja`/`encargado` at that branch can open it; whoever is logged in when a
   cash sale is made attaches to the branch's currently-open session
   (`cash_session_id` resolved server-side or client-side from the open
   session at that branch, not from `auth.uid()`).
   - Pros: Matches the literal "cash register" mental model (one physical
     drawer); simplest UI (single banner: "Sesión abierta por X desde HH:MM");
     branch-level expected-cash math has no ambiguity (exactly one session's
     numbers = the branch's drawer state at any moment).
     Reuses Shape B verbatim for RLS, same as `branch_stock`/`stock_movements`.
   - Cons: No natural hand-off protocol if a shift changes mid-day without an
     explicit close (does the incoming caja "take over," or must the outgoing
     one close first?); doesn't scale to a branch with multiple physical
     counters (not evidenced as a real need today).
   - Effort: Medium

2. **Per-employee-per-shift session ("multi-till" model)**
   Each `caja` opens their own session (unique per `(employee_id)` while open,
   not per branch); multiple can be concurrently open at one branch.
   `cash_session_id` on a sale is resolved from `auth.uid()`'s own open
   session, mirroring the existing `employee_id = auth.uid()` ownership
   pattern already used for sale correction.
   - Pros: No hand-off friction; naturally supports staffing patterns with
     several simultaneous cajas; ownership model is identical to the one
     `granular-roles` already shipped for sale correction (low conceptual
     novelty).
   - Cons: A branch's *total* physical cash position (if there really is only
     one drawer) requires summing across N concurrently open sessions, which
     is meaningless unless the store genuinely has N physical drawers —
     currently unverified and unevidenced. Reconciliation UX for encargado/admin
     is more complex (must reconcile per-employee, not per-branch).
   - Effort: Medium-High

3. **Introduce an explicit `registers`/`tills` entity, sessions belong to a register**
   A branch can have N registers; a session opens against one specific
   register.
   - Pros: Most physically accurate model; future-proofs larger stores.
   - Cons: Nobody has asked for multi-register-per-branch, and the repo's own
     established convention (`product-catalog`'s "only columns with a named
     future consumer") argues directly against modeling an entity with zero
     evidenced consumers. This is the over-engineering trap the roadmap itself
     warns about.
   - Effort: High

## Recommendation

**Approach 1 (per-branch single active session), pending explicit confirmation
of Fork 1 with the user in `sdd-propose`.** Rationale: (a) the "Also check"
investigation found zero existing till/register modeling to extend — there is
no precedent pointing toward Approach 2 or 3; (b) the app's existing physical
unit is the branch (Shape B/D already treat it as the location boundary), so a
per-branch session is the smallest addition consistent with that; (c) it keeps
the UI surface to a single banner injected above `SalesForm`/`employee-dashboard.tsx`,
consistent with the phase's "extend, don't replace" scope; (d) Approach 2's
premise (genuinely simultaneous same-branch drawers) is unverified — adopting
it risks solving a problem the business may not have; (e) Approach 3 is
explicitly the pattern this repo's own prior phases have rejected.

This is a recommendation, not a decision — Fork 1 must be surfaced to the user
before `sdd-design` locks the schema, because it changes the RLS shape,
the uniqueness constraint, and the reconciliation math.

**Minimal schema shape implied by Approach 1** (illustrative only — `sdd-design`
finalizes it):
- `cash_sessions(id, store_id, branch_id, opened_by, opened_at, opening_amount,
  status CHECK IN ('open','closed'), closed_by, closed_at, counted_amount,
  expected_amount, discrepancy)` — Shape B RLS, one partial unique index
  `(branch_id) WHERE status = 'open'`.
- `cash_movements(id, cash_session_id, store_id, branch_id, type CHECK IN
  ('cash_in','cash_out'), amount, reason text, note, created_by, created_at)`
  — append-only like `stock_movements` (Shape B RLS + `REVOKE UPDATE, DELETE`).
  Sale-driven cash changes are **derived** (join `sales` where
  `cash_session_id = X AND payment_method = 'cash'`), not duplicated into this
  ledger — only manual in/out entries live here.
- `sales.cash_session_id uuid NULL REFERENCES cash_sessions(id)` — nullable so
  a sale made with no open session (if Fork 2 resolves to "don't block")
  simply has no attribution, exactly like `sale_items.product_id IS NULL` for
  an unmatched product name today.
- `expected_amount` at close = `opening_amount + Σ(cash sales) + Σ(cash_in) − Σ(cash_out)`.
  Frozen at close time (Fork 4 → option (a)), not live-recomputed afterward.

## Risks

- **Fork 1 is unresolved and materially changes the schema/RLS shape** — must
  be closed with the user before `sdd-design`, not assumed by that phase.
- **Fork 4 (post-close correction) is a genuine new audit-integrity edge
  case**, not hypothetical: RLS already permits it today (no date limit on
  `sales` UPDATE/DELETE for `caja`), only today it has no financial-reconciliation
  consequence. This phase is what turns a latent capability into a real risk.
- **Admin's session relationship is ambiguous** (Fork 3) — admin has no fixed
  branch context (`branch_id IS NULL`) but can create sales at any selected
  branch via `/admin`'s `SaleModal`; whether that participates in the branch's
  open session needs an explicit answer.
- **Zero production sales today** is a narrow window to add this scoping
  cleanly (same pattern as every prior phase's "0 rows, safe to tighten now")
  — but it closes as soon as real transaction volume starts, so this should
  not slip.
- **Review budget**: 2 new tables + RLS, a nullable FK across 4 sale-writer
  call sites, a new open/close UI surface, and a new session-history/reporting
  view is very likely to exceed the 400-line budget on its own, matching every
  prior phase (`granular-roles` alone needed 7 chained PRs) — `sdd-tasks` will
  need to slice by dependency order (schema → writer attribution → open/close
  UI → reporting).
- **Encargado/caja visibility reuse is plausible but unverified**: Shape B
  should extend cleanly to `cash_sessions`/`cash_movements` (encargado own
  branch, admin store-wide, caja own session or own branch depending on Fork
  1) but this must be re-derived against the live schema in `sdd-design`, not
  assumed from this exploration.

## Ready for Proposal

**Yes, with explicit forks to resolve first.** The domain is well-understood
and greenfield (confirmed by grep — no prior art to reconcile with). Before
`sdd-propose` locks scope, the user should explicitly resolve: Fork 1 (session
granularity), Fork 2 (enforcement strictness — block vs. don't-block cash
sales without a session, and single vs. multiple concurrent sessions per
branch), Fork 3 (admin's role in sessions), and at least a provisional answer
to Fork 4 (post-close correction handling) and Fork 5 (mid-shift cash
movements in/out of scope). Recommend `sdd-propose` present these as a
resolved-decisions round the same way `granular-roles/proposal.md`'s "Proposal
question round" did, rather than silently picking defaults.

## Key Learnings

1. Shape D's `sales` UPDATE/DELETE RLS for caja/employee has no date restriction; `MySalesView.tsx`'s same-day window is UI-only, not DB-enforced.
2. `EmployeeReport.tsx` aggregates per-employee-per-period, store-wide, with no branch filter, so it cannot be extended for per-session cash reporting.
3. The repo has zero till/register/session concept anywhere; `branches` is the only physical-location primitive that exists today.
4. `stock_movements`' append-only ledger pattern (typed reason, requested vs. applied delta, resulting balance, RLS plus REVOKE) is the direct precedent for a new cash-movements ledger.
5. Production sales count was last verified at 0 by `granular-roles` on 2026-08-29 via `execute_sql`, not independently re-verified in this phase.
