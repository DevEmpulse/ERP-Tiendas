# Design: Store Analytics (P7)

> Size note: this document exceeds the generic 800-word design budget. The
> orchestrator explicitly required exact SQL, file-by-file estimates, and
> deviation flags, and `openspec/config.yaml` `rules.design` requires forward
> **and** rollback SQL. Project rigor (see `cash-register` / `pos-ui`) wins.

## Technical Approach

Two in-place bugfixes plus one new read-only aggregation layer.

1. **Bugfix A** is fixed at the *query* level, not in the reducer: once
   `sales` is fetched branch-filtered, `localTodayStats()` and `HistoryView`
   become correct by construction with zero changes.
2. **Bugfix B** aligns `EmployeeReport`'s `profiles` scope with the scope RLS
   already imposes on `sales`, and replaces the stale `role === 'employee'`
   filter with a named constant from `roles.ts`.
3. **New analytics** aggregates in Postgres via one `security_invoker` view
   and three `SECURITY INVOKER` functions appended as `migration.sql` **§18**,
   consumed by a standalone `/analytics` route (`/pos` precedent) with
   Recharts panels and a `pdfGenerator.ts` export.

Grounded against `migration.sql` §13–§17 and the live component code, not the
proposal's prose. Aligned to `specs/store-analytics/spec.md` (all 11
requirements mapped below).

---

## Architecture Decisions

### Decision: `security_invoker = true` is MANDATORY on the view — a bare `CREATE VIEW` leaks

| Option | Tradeoff | Decision |
|---|---|---|
| Plain `CREATE VIEW` | **Unsafe.** A Postgres view executes with the *view owner's* rights. Migrations run as `postgres`, which bypasses RLS, so `authenticated` would read every branch of every store. | Rejected |
| `CREATE VIEW ... WITH (security_invoker = true)` (PG15+) | Permission checks *and* RLS policies on base tables are evaluated as the **querying** role. Supabase's own linter flags the absence of this as `security_definer_view`. | **Chosen** |
| `SECURITY DEFINER` function + manual scoping | Re-derives what RLS already encodes; the exact bug class §16.5 exists to prevent. | Rejected (user resolved to INVOKER) |

Functions default to `SECURITY INVOKER`; §18 states it explicitly for
reviewability. This directly answers the phase's top-named risk: the user's
"INVOKER is safe" conclusion holds **for functions and for
`security_invoker` views only** — it does *not* hold for a plain view.

### Decision: branch comparison must re-derive scoping by hand

RLS scoping is inherited only where the driving table is itself
branch-scoped. Verified per source table:

| Source table | SELECT policy | Encargado result | Inherits safely? |
|---|---|---|---|
| `sale_items` | §16.5 `:1481` branch-scoped | own branch | ✅ |
| `branch_stock` | §15.6 Shape B branch-scoped | own branch | ✅ |
| `cash_sessions` | §17.3 branch-scoped | own branch | ✅ |
| `products` | §16.4 Shape C **store-wide** | all products | ✅ (inner-joined onto restricted rows; cannot widen) |
| `branches` | §14.2 **store-wide read** | **all branches** | ❌ **leaks** |

`analytics_branch_comparison` is driven `FROM branches`, so RLS would zero the
*numbers* but still hand an encargado one row per sibling branch — violating
"no other-branch rows". It therefore carries an explicit
`role IN ('admin','superadmin') OR b.id = get_current_user_branch_id()`
predicate. This is the single place scoping is re-derived, and it is flagged
inline in the SQL.

### Decision: one view + three functions, not four views

Views take no parameters. Low-stock is a point-in-time snapshot → view.
Ranking / comparison / discrepancy need `p_from`/`p_to` (30-day default) →
functions called through `supabase.rpc()`.

### Decision: standalone `/analytics` route, not a dashboard section

| Option | Tradeoff | Decision |
|---|---|---|
| Section in `admin`+`encargado` pages | Reuses the header branch selector and bootstrap (~120 fewer lines), but `/analytics` would not exist as a URL — the spec's access scenarios ("WHEN they navigate to `/analytics`") would fail literally, and `roles.ts` would have nothing to gate. | Rejected |
| Standalone `/analytics` (mirrors `/pos`) | Satisfies the spec verbatim; one surface for both roles; own period selector/charts. Costs a duplicated bootstrap + a `proxy.ts` arm. | **Chosen** |

Reachability follows the `pos` precedent exactly: a sidebar item whose
`handleSetSection` arm does `router.push('/analytics')`.

### Decision: realtime must follow the branch filter

Admin's subscription filters `store_id=eq.…`. Once KPIs are branch-scoped, an
INSERT on an unselected branch would still prepend + highlight a row,
re-opening the bug through the realtime path. **The highlight must not
survive**: the filter becomes `branch_id=eq.${selectedBranchId}`, matching
`encargado/page.tsx:232` verbatim.

### Decision: margin exposes both an estimate and a realized figure

Spec says `(sale_price - purchase_price) * units`, which reads the *current*
`products` snapshot while revenue uses the historical `sale_items.subtotal`.
Both columns ship: `margin_estimated` (spec-verbatim, primary in the UI) and
`margin_realized` = `SUM(subtotal) - SUM(quantity * purchase_price)` (two
extra SQL lines, consistent with revenue). Flagged as an addition.

---

## Data Flow

    /analytics page.tsx ─ auth + profile (role, branch_id, store)
             │
             ▼
    AnalyticsShell ── PeriodSelector (default: now-30d → now)
             │        BranchSelector (admin) | Branch badge (encargado)
             │
             ├─► lib/analytics.ts ─ rpc('analytics_product_ranking')     ──┐
             ├────────────────────  rpc('analytics_branch_comparison')  ──┤
             ├────────────────────  rpc('analytics_cash_discrepancy')   ──┤ SECURITY
             └────────────────────  from('analytics_low_stock')         ──┘ INVOKER
                                             │
                                    RLS of the CALLING user
                                    (§16.5 / §15.6 / §17.3)
             │
             ├─► Recharts panels (Bar / Line) + tables
             └─► generateAnalyticsReportPdf()  (jsPDF + autoTable, tables only)

---

## SQL — `migration.sql` §18 (append after §17.9, line 2119+)

```sql
-- ==============================================================================
-- 18. STORE ANALYTICS — read-only aggregation (Phase 7)
-- ==============================================================================
-- Nothing here mutates. Every object is SECURITY INVOKER so the existing
-- policies (§15.6 branch_stock, §16.4 products, §16.5 sales/sale_items,
-- §17.3 cash_sessions) do the scoping. The ONE exception is 18.4, which must
-- re-derive it by hand — see the comment there.

-- 18.1 Indexes. sales has only sales_branch_id_idx (:580) and NO index on
-- created_at at all, so every period query below would seq-scan sales.
CREATE INDEX IF NOT EXISTS sales_branch_created_idx
  ON public.sales (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_store_created_idx
  ON public.sales (store_id, created_at DESC);
-- sale_items.branch_id (§15.7) has no index; its SELECT policy filters on it.
CREATE INDEX IF NOT EXISTS sale_items_branch_id_idx
  ON public.sale_items (branch_id);
-- cash_sessions_branch_opened_idx (:1694) indexes opened_at; 18.5 filters closed_at.
CREATE INDEX IF NOT EXISTS cash_sessions_branch_closed_idx
  ON public.cash_sessions (branch_id, closed_at DESC) WHERE status = 'closed';

-- 18.2 Low-stock alerts. WITHOUT security_invoker a view runs with the VIEW
-- OWNER's rights (postgres, which bypasses RLS) and would expose every store.
-- min_stock is NOT NULL DEFAULT 0 (:811), so "not configured" is exactly 0 —
-- there is no NULL arm to handle.
DROP VIEW IF EXISTS public.analytics_low_stock;
CREATE VIEW public.analytics_low_stock
WITH (security_invoker = true) AS
SELECT bs.store_id,
       bs.branch_id,
       b.name  AS branch_name,
       bs.product_id,
       p.name  AS product_name,
       p.barcode,
       bs.current_stock,
       bs.min_stock,
       (bs.min_stock - bs.current_stock) AS deficit
  FROM public.branch_stock bs
  JOIN public.products p ON p.id = bs.product_id
  JOIN public.branches b ON b.id = bs.branch_id
 WHERE bs.min_stock > 0
   AND bs.current_stock <= bs.min_stock
   AND p.is_active;

-- 18.3 Product ranking + margin. sale_items' Shape D SELECT policy (:1481)
-- already limits an encargado to their branch; p_branch_id can only narrow.
-- Legacy free-text lines (product_id IS NULL, pre-P1) are excluded: they have
-- no product to rank or price.
DROP FUNCTION IF EXISTS public.analytics_product_ranking(timestamptz, timestamptz, uuid);
CREATE FUNCTION public.analytics_product_ranking(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id       uuid,
  product_name     text,
  units_sold       bigint,
  revenue          numeric,
  margin_estimated numeric,
  margin_realized  numeric
)
LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public
AS $$
  SELECT si.product_id,
         MAX(COALESCE(p.name, si.product_name)),
         SUM(si.quantity)::bigint,
         SUM(si.subtotal),
         SUM(si.quantity * (p.sale_price - p.purchase_price)),
         SUM(si.subtotal - si.quantity * p.purchase_price)
    FROM public.sale_items si
    JOIN public.sales    s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
   WHERE s.created_at >= p_from
     AND s.created_at <  p_to
     AND si.product_id IS NOT NULL
     AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
   GROUP BY si.product_id;
$$;

-- 18.4 Branch comparison. THE ONE PLACE that re-derives scoping by hand.
-- branches is store-wide readable (§14.2 :550-553), so driving FROM it would
-- hand an encargado one zero-row per sibling branch: RLS zeroes the NUMBERS
-- but does not hide the BRANCHES. The explicit predicate below is what
-- enforces the resolved decision "encargado sees ONLY their own branch".
-- sales_count replicates groupSales()'s ref-code grouping (salesHelper.ts:144)
-- so combined payments count as ONE transaction, matching the Dashboard.
DROP FUNCTION IF EXISTS public.analytics_branch_comparison(timestamptz, timestamptz);
CREATE FUNCTION public.analytics_branch_comparison(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  branch_id   uuid,
  branch_name text,
  revenue     numeric,
  sales_count bigint,
  stock_units bigint
)
LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public
AS $$
  SELECT b.id,
         b.name,
         COALESCE(sa.revenue, 0),
         COALESCE(sa.sales_count, 0),
         COALESCE(st.stock_units, 0)
    FROM public.branches b
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(s.total_amount), 0) AS revenue,
             COUNT(DISTINCT COALESCE(
               substring(s.description from 'Ref:\s*#([A-Za-z0-9-]+)'),
               s.id::text))::bigint           AS sales_count
        FROM public.sales s
       WHERE s.branch_id = b.id
         AND s.created_at >= p_from
         AND s.created_at <  p_to
    ) sa ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(bs.current_stock), 0)::bigint AS stock_units
        FROM public.branch_stock bs
       WHERE bs.branch_id = b.id
    ) st ON true
   WHERE b.is_active
     AND b.store_id = public.get_current_user_store_id()
     AND (
       public.get_current_user_role() IN ('admin','superadmin')
       OR b.id = public.get_current_user_branch_id()
     )
   ORDER BY 3 DESC;
$$;

-- 18.5 Cash discrepancy trend. Returns one row per CLOSED session rather than
-- a pre-grouped aggregate: cardinality is bounded (~1-2 sessions/branch/day,
-- so <100 rows for a 30-day window) and the panel needs per-session points for
-- the time series AND a per-cashier rollup from the same fetch.
DROP FUNCTION IF EXISTS public.analytics_cash_discrepancy(timestamptz, timestamptz, uuid);
CREATE FUNCTION public.analytics_cash_discrepancy(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  session_id      uuid,
  branch_id       uuid,
  branch_name     text,
  closed_at       timestamptz,
  closed_by       uuid,
  cashier_name    text,
  expected_amount numeric,
  counted_amount  numeric,
  discrepancy     numeric
)
LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public
AS $$
  SELECT cs.id, cs.branch_id, b.name, cs.closed_at, cs.closed_by,
         COALESCE(pr.name, pr.email, 'Sin nombre'),
         cs.expected_amount, cs.counted_amount, cs.discrepancy
    FROM public.cash_sessions cs
    JOIN public.branches b  ON b.id  = cs.branch_id
    LEFT JOIN public.profiles pr ON pr.id = cs.closed_by
   WHERE cs.status = 'closed'
     AND cs.closed_at >= p_from
     AND cs.closed_at <  p_to
     AND (p_branch_id IS NULL OR cs.branch_id = p_branch_id)
   ORDER BY cs.closed_at;
$$;

-- 18.6 Grants. Read-only surface, revoke-then-grant per §17.7 (:1896-1902).
-- security_invoker views also require the CALLER to hold SELECT on the base
-- tables — branch_stock has it (:1036), products/sales/sale_items via
-- Supabase's default privileges for `authenticated`.
GRANT SELECT ON public.analytics_low_stock TO authenticated;
REVOKE ALL    ON public.analytics_low_stock FROM anon;
REVOKE EXECUTE ON FUNCTION public.analytics_product_ranking(timestamptz, timestamptz, uuid)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_product_ranking(timestamptz, timestamptz, uuid)   TO authenticated;
REVOKE EXECUTE ON FUNCTION public.analytics_branch_comparison(timestamptz, timestamptz)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_branch_comparison(timestamptz, timestamptz)       TO authenticated;
REVOKE EXECUTE ON FUNCTION public.analytics_cash_discrepancy(timestamptz, timestamptz, uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_cash_discrepancy(timestamptz, timestamptz, uuid)  TO authenticated;

-- 18.7 ROLLBACK (do not run automatically) — reverse of section 18, bottom to top:
-- DROP FUNCTION IF EXISTS public.analytics_cash_discrepancy(timestamptz, timestamptz, uuid);
-- DROP FUNCTION IF EXISTS public.analytics_branch_comparison(timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.analytics_product_ranking(timestamptz, timestamptz, uuid);
-- DROP VIEW     IF EXISTS public.analytics_low_stock;
-- DROP INDEX    IF EXISTS public.cash_sessions_branch_closed_idx;
-- DROP INDEX    IF EXISTS public.sale_items_branch_id_idx;
-- DROP INDEX    IF EXISTS public.sales_store_created_idx;
-- DROP INDEX    IF EXISTS public.sales_branch_created_idx;
-- No table, column, or row is touched in either direction; min_stock returns
-- to inert. The indexes are safe to keep if only the views are rolled back.
```

---

## Bugfix A — exact change

**`src/app/admin/page.tsx`** (the only page that needs it — see Deviations):

1. Add `const [branchesLoaded, setBranchesLoaded] = useState(false)`; set it
   `true` in the `finally` of effect #3 (`loadBranches`, `:226-250`).
2. Effect #2 (`:163-220`) guards on `if (!userProfile?.store_id ||
   !branchesLoaded) return`, builds the query as a variable, and applies
   `if (selectedBranchId) query = query.eq('branch_id', selectedBranchId)`
   before `.order('created_at', { ascending: false })`. Deps gain
   `selectedBranchId, branchesLoaded`.
   The `selectedBranchId &&` guard (not an unconditional `.eq`) keeps a store
   with zero active branches from hanging on a permanent skeleton.
3. Realtime effect (`:264-316`): channel becomes
   `realtime-sales-branch-${selectedBranchId}`, filter
   `branch_id=eq.${selectedBranchId}`, early-return when
   `!selectedBranchId`, deps gain `selectedBranchId`.
4. **`localTodayStats()` (`:319-355`) is left byte-for-byte unchanged** — it
   reduces over `sales`, which is now branch-filtered at the source.
   `HistoryView` (`:382`) is likewise fixed for free. Filtering once at the
   query is the smaller, non-duplicated fix.

## Bugfix B — exact change (`src/components/admin/EmployeeReport.tsx`)

1. New step 0 in `fetchPerformance()`: read the caller's own scope once —
   `supabase.from('profiles').select('role, branch_id').eq('id',
   (await supabase.auth.getUser()).data.user!.id).single()`. Self-contained,
   so `EmployeesView` and both dashboard pages stay untouched.
2. **Scoping fix (`:67-70`)**: when the caller is not `admin`/`superadmin`,
   add `.eq('branch_id', callerBranchId)` to the `profiles` query, matching
   the branch scope §16.5 already imposes on the `sales` query at `:75-79`.
   Other-branch staff are then *excluded*, never rendered as a misleading
   `$0` — the "excluded" arm the spec permits.
3. **Role filter (`:105`)**: replace `p.role === 'employee'` with
   `SALES_REPORT_ROLES.includes(p.role ?? '') || salesByEmp[p.id]?.count > 0`,
   importing a new constant from `roles.ts` (below). The second arm is kept
   verbatim so an admin who actually sold still appears.
4. Relabel `Participación de tienda` (`:278`) to `Participación de sucursal`
   when the caller is branch-scoped, so the share percentage is not read as a
   store-wide figure it never was.

`filterType` (`'day' | 'month'`, `:20`) is left as-is: it is `EmployeeReport`'s
own selector and is out of `/analytics`'s 30-day scope.

---

## File Changes

| File | Action | Description | ~Lines |
|---|---|---|---|
| `migration.sql` | Modify | Append §18 (18.1–18.7) | +175 |
| `package.json` | Modify | `npm install recharts` (v3, React 19 compatible) | +1 |
| `src/lib/roles.ts` | Modify | `ANALYTICS_ROLES = ['admin','encargado']`, `SALES_REPORT_ROLES = ['encargado','caja','employee']`, `/analytics` arm in `canAccess` | +14 |
| `src/proxy.ts` | Modify | New §11 access block for `/analytics` (mirrors §10 `/pos`, `:130-139`) | +9 |
| `src/components/admin/sidebar-items.ts` | Modify | `'analytics'` in `AdminSection` + `ADMIN_MENU_ITEMS` (inherited by `ENCARGADO_MENU_ITEMS`, absent from `EMPLOYEE_MENU_ITEMS`) | +9 |
| `src/app/admin/page.tsx` | Modify | Bugfix A (query + realtime) · `handleSetSection` analytics arm · `?section=` guard excludes `analytics` | ~28 |
| `src/app/encargado/page.tsx` | Modify | `handleSetSection` arm + `?section=` guard **only** | ~6 |
| `src/components/admin/EmployeeReport.tsx` | Modify | Bugfix B (caller scope, profiles filter, role constant, label) | ~48 |
| `src/lib/pdfGenerator.ts` | Modify | `generateAnalyticsReportPdf()` | +165 |
| `src/lib/analytics.ts` | Create | Typed RPC/view wrappers, period helpers, shared types | +95 |
| `src/app/analytics/page.tsx` | Create | Auth + profile + branch bootstrap (mirrors `/pos`, `:19-115`) | +115 |
| `src/components/analytics/AnalyticsShell.tsx` | Create | Header, branch selector/badge, PDF button, panel layout, refresh | +205 |
| `src/components/analytics/PeriodSelector.tsx` | Create | 7d / **30d default** / 90d presets | +60 |
| `src/components/analytics/ProductRankingPanel.tsx` | Create | Horizontal `BarChart` top-10 + units/revenue/margin toggle + table | +135 |
| `src/components/analytics/BranchComparisonPanel.tsx` | Create | Grouped `BarChart`; degenerates to KPI cards on a single row | +115 |
| `src/components/analytics/LowStockPanel.tsx` | Create | Table + deficit badge (no chart — a chart adds nothing) | +90 |
| `src/components/analytics/CashDiscrepancyPanel.tsx` | Create | `LineChart` over `closed_at`, one series per branch + cashier rollup table | +135 |

**Total authored ≈ 1,405 lines** across 6 modified + 7 created files, plus
`migration.sql` and the lockfile.

---

## Interfaces / Contracts

```ts
// src/lib/roles.ts
export const ANALYTICS_ROLES = ['admin', 'encargado'] as const
// Roles whose sales performance is reported by default; an admin appears only
// when they actually sold. Replaces EmployeeReport's hardcoded 'employee'.
export const SALES_REPORT_ROLES = ['encargado', 'caja', 'employee'] as const
// inside canAccess():
if (prefix.startsWith('/analytics')) return (ANALYTICS_ROLES as readonly string[]).includes(role)

// src/lib/analytics.ts
export interface AnalyticsPeriod { from: Date; to: Date; label: string }
export const DEFAULT_PERIOD_DAYS = 30
export interface ProductRankingRow  { product_id: string; product_name: string; units_sold: number; revenue: number; margin_estimated: number; margin_realized: number }
export interface BranchComparisonRow { branch_id: string; branch_name: string; revenue: number; sales_count: number; stock_units: number }
export interface LowStockRow        { branch_id: string; branch_name: string; product_id: string; product_name: string; barcode: string | null; current_stock: number; min_stock: number; deficit: number }
export interface CashDiscrepancyRow { session_id: string; branch_id: string; branch_name: string; closed_at: string; closed_by: string | null; cashier_name: string; expected_amount: number; counted_amount: number; discrepancy: number }

export async function fetchProductRanking(sb, period, branchId: string | null): Promise<ProductRankingRow[]>
export async function fetchBranchComparison(sb, period): Promise<BranchComparisonRow[]>
export async function fetchLowStock(sb, branchId: string | null): Promise<LowStockRow[]>
export async function fetchCashDiscrepancy(sb, period, branchId: string | null): Promise<CashDiscrepancyRow[]>
```

```ts
// src/lib/pdfGenerator.ts — mirrors generateSalesReportPdf's structure
// (zinc palette :53-60, header block :65-94, summary card :113-159,
//  autoTable per section chained off lastAutoTable.finalY :341)
export function generateAnalyticsReportPdf(opts: {
  storeName: string
  branchLabel: string          // branch name, or "Todas las sucursales"
  periodLabel: string          // e.g. "Últimos 30 días (01/08 – 30/08)"
  products: ProductRankingRow[]
  branches: BranchComparisonRow[]
  lowStock: LowStockRow[]
  cash: CashDiscrepancyRow[]
  fileName: string
}): void
```

PDF content: header (store / title / period / branch / generation stamp),
a 4-column summary card (total revenue, transactions, estimated margin,
low-stock count), then four `autoTable` sections. **Charts are not
rasterized** — that needs canvas capture and a new dependency; tables satisfy
the spec's "reflecting the currently displayed metrics".

Recharts components live in `'use client'` files (the whole route is client
side, like every other page here), so no `next/dynamic { ssr: false }`
wrapper is needed.

---

## Testing Strategy

No automated test suite exists in this repo (`openspec/config.yaml`
`rules.verify.test_command: ""`). Verification is manual + `npm run build`.

| Layer | What to test | Approach |
|---|---|---|
| Build | Type safety of RPC row types, Recharts v3 + React 19 | `npm run build` |
| DB (RLS) | **Highest risk.** Query the view and all three RPCs as a live `encargado` and confirm zero non-own-branch rows, especially `analytics_branch_comparison` (the manually-scoped one) | Log in as an `encargado` in production; compare against the same call as `admin` |
| DB (invoker) | Confirm the view was created with `security_invoker` | `SELECT reloptions FROM pg_class WHERE relname = 'analytics_low_stock';` must contain `security_invoker=true` |
| Integration | Bugfix A: switch header branch → Dashboard + History KPIs change; a sale on another branch does not appear or highlight | Manual, two branches with sales |
| Integration | Bugfix B: as `encargado`, other-branch staff are absent (not `$0`); as `admin`, `caja`/`encargado` sellers are listed | Manual |
| Integration | `caja` / `stock` / `employee` navigating to `/analytics` are redirected by `proxy.ts` | Manual per role |
| Regression | Low-stock only lists rows with `min_stock > 0` | Set one `min_stock` via `adjust_branch_stock` flow |

---

## Threat Matrix

The matrix's boundaries are VCS/shell/process integration; this change has an
HTTP-route authorization boundary only, covered by the spec's *Role-Based
Access to /analytics* requirement and the `proxy.ts` §11 arm.

| Boundary | Applicability | Design response |
|---|---|---|
| Documentation-like paths | N/A — no file classification or execution | — |
| Git repository selection | N/A — no VCS automation | — |
| Commit state | N/A — no VCS automation | — |
| Push state | N/A — no VCS automation | — |
| PR commands | N/A — no PR automation | — |

No shell command, subprocess, or executable-file classification is introduced.

---

## Migration / Rollout

Order matters — the client must not ship before the SQL exists:

1. `npm install recharts` (single new dependency; lockfile churn expected).
2. Apply `migration.sql` **§18** to production (user's standing convention:
   production directly, no dev branch). Additive and read-only: no table,
   column, row, trigger, or policy is touched.
3. Verify `security_invoker=true` on `analytics_low_stock` and run the
   encargado RLS check **before** shipping any UI.
4. Ship the two bugfixes (independently deliverable and independently
   revertible).
5. Ship `roles.ts` / `proxy.ts` / `sidebar-items.ts` gating + `/analytics`
   route + panels + PDF export.

Rollback is §18.7 plus a revert of the client commits (see `proposal.md`).

**Review Workload Forecast input for `sdd-tasks`** — ≈1,405 authored lines
against a 400-line budget. Suggested slices if the tasks phase chains PRs:

- **Slice 1 (~85 lines)**: Bugfix A + Bugfix B + the `SALES_REPORT_ROLES`
  constant. Self-contained, shippable, revertible alone.
- **Slice 2 (~180 lines)**: `migration.sql` §18 + `src/lib/analytics.ts`.
  Verifiable against live RLS with no UI.
- **Slice 3 (~1,140 lines)**: route, gating, sidebar, four panels, PDF export.
  Still over budget; sub-split by panel if the strategy demands it.

The session's standing choice has been single-PR exception for every prior
phase; the tasks phase owns the final decision.

---

## Deviations from the Proposal (flag at apply time)

1. **`src/app/encargado/page.tsx` does NOT need Bugfix A.** The proposal's
   Affected Areas says "Same fix", but the live code already filters
   `.eq('branch_id', branchId)` (`:188`) and already scopes realtime to
   `branch_id=eq.${branchId}` (`:232`). Only the `analytics` navigation arm
   changes there. Estimated impact drops from ~28 to ~6 lines.
2. **`localTodayStats()` is not modified.** The proposal names it as a fix
   target; filtering at the query makes it correct with no edit. Behavior
   matches the spec either way.
3. **A plain `CREATE VIEW` would have leaked.** The user's resolution
   ("`SECURITY INVOKER` is sufficient") is correct only with the explicit
   `WITH (security_invoker = true)` option on the view. Load-bearing — the
   whole INVOKER decision depends on it.
4. **`analytics_branch_comparison` re-derives scoping manually.** RLS alone
   cannot satisfy "encargado sees ONLY their own branch" because `branches`
   is store-wide readable. This is the one place the proposal's "replicate
   the exact per-role scoping" mitigation is literally required.
5. **`margin_realized` is an addition** beyond the spec's
   `sale_price - purchase_price` formula (two SQL lines), because the
   spec-verbatim figure mixes a current price snapshot with historical
   revenue.
6. **Four new indexes are added** (§18.1). The proposal's Affected Areas
   lists only "views/RPCs + RLS"; `sales` has no `created_at` index at all
   today, so every period query would seq-scan.
7. **PDF export contains tables, not chart images.**
8. `EmployeeReport` deliberately does **not** adopt the header branch
   selector — its scope stays the caller's RLS scope. Out of the spec's
   Bugfix A requirement, which names Dashboard and History only.

---

## Open Questions

- [ ] Legacy pre-P1 sale lines (`sale_items.product_id IS NULL`) and pre-
      store-branches rows (`sale_items.branch_id IS NULL`, nullable per
      §15.7) are excluded from product ranking; the latter are also invisible
      to `encargado` under §16.5. Acceptable, but the numbers will not
      reconcile with a store-wide historical total. Confirm at verification.
- [ ] `sales_count` replicates only `groupSales()`'s ref-code arm, not its
      `description + employee + minute` fallback (`salesHelper.ts:193-195`),
      which cannot be expressed cheaply in SQL. Legacy sales without a
      `Ref: #` may over-count transactions in branch comparison. Revenue is
      unaffected.
