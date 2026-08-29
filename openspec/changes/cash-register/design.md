# Design: Cash Register — Caja Sessions (Phase 3)

## Technical Approach

Append **section 17** to `migration.sql` (live file is 1663 lines; 16 is `granular-roles`).
Ordering is strictly additive until the very last statement: `cash_sessions` → coherence
keys → `cash_movements` → `sales.cash_session_id` + guard trigger → close RPC → grants →
**Shape D policy replacement last**. Until that final block runs, nothing added changes POS
behaviour.

All line citations below were **re-verified against the live file**: Shape D `sales`
UPDATE/DELETE at `:1440-1477`, `sale_items` UPDATE/DELETE at `:1504-1547`, `stock_movements`
+ RLS at `:824-890`, its `REVOKE` at `:1038`, Shape B on `branch_stock` at `:851-866`,
coherence keys at `:737-743`, `adjust_branch_stock` at `:980-1031`, `sales` columns at
`:29-38` (`total_amount numeric(10,2)`, `payment_method` CHECK `('cash','transfer','card')`,
`employee_id uuid ON DELETE SET NULL`), `sales.branch_id` at `:577-580`. All citations in
the proposal are accurate.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|----------|----------------------|-----------|
| D1 | **Open = plain RLS-gated INSERT. Close = RPC.** | `open_cash_session()` RPC; combined `open_or_close`. | The partial unique index is already atomic: a second concurrent INSERT blocks on the index tuple and raises `23505` after the first commits. An RPC cannot beat that. Opening writes **no derived value** — `opening_amount` is human-supplied, like `counted_amount`. Close is different: `expected_amount`/`discrepancy` are *derived* and must be unforgeable, which requires the client to hold no UPDATE grant at all. |
| D2 | **Close RPC is `SECURITY DEFINER`, not `SECURITY INVOKER`** (deviation from the proposal's Approach wording) | `SECURITY INVOKER` + a narrow `USING (status='open') WITH CHECK (status='closed')` UPDATE policy. | INVOKER requires the caller to hold `UPDATE` on `cash_sessions`, and Postgres RLS cannot restrict *which columns* an UPDATE writes. A caja with that grant could PostgREST-`PATCH` `expected_amount` directly and the frozen number becomes theatre. Column-level `GRANT UPDATE (...)` cannot help either, since the INVOKER function writes as the caller. So: **no UPDATE grant at all + `REVOKE UPDATE, DELETE`**, and one `SECURITY DEFINER` RPC as the sole mutation path, with in-body authorization exactly mirroring the repo's own precedent (`preload_employee` `:1086`, `update_employee_user` `:1150`, `delete_employee_user` `:1228`, and the explicit comment at `:606` "SECURITY DEFINER bypasses RLS: verify the branch belongs to this store"). The proposal's stated intent — frozen number, one transaction — is preserved and strengthened. |
| D3 | **The closed-session condition is written fail-CLOSED (`EXISTS … status='open'`), not fail-open (`NOT EXISTS … status='closed'`)** | The `NOT EXISTS … 'closed'` form named in the proposal. | RLS policy subqueries have RLS applied to the referenced table. If `cash_sessions` were ever invisible to the caller, `NOT EXISTS` evaluates true and *permits* the edit. `EXISTS … status='open'` demands positive proof and denies on invisibility. `status` is `CHECK IN ('open','closed')`, so the two forms are logically identical whenever the row is visible. |
| D4 | **Coherence key `cash_sessions UNIQUE (branch_id, id)` + composite FK from `sales`** | Plain `cash_session_id uuid REFERENCES cash_sessions(id)`. | Mirrors section 15.1 (`:737-743`). Guarantees a sale's session is always at the sale's own branch, which in turn guarantees D3's subquery always finds the row for a same-branch caja — so fail-closed never fires spuriously. |
| D5 | **BEFORE INSERT trigger nulls a stale/foreign `cash_session_id` instead of an INSERT-policy check** | Adding the open-session condition to the `sales` INSERT policy; doing nothing. | A policy check would *block the sale*, violating the hard "no sale is ever blocked by session state" decision. The trigger degrades a stale attach to an unattributed sale (`NULL`) — never blocks, always correct. Mirrors `set_sale_item_branch()` (`:901-911`), same `SECURITY INVOKER` BEFORE-INSERT shape. |
| D6 | **`cash_movements` INSERT into a *closed* session is allowed** | Restricting movements to open sessions. | This is precisely correction path (F). The frozen `expected_amount` is never recomputed, so a post-close movement cannot alter it — it is a visible, attributed audit event appended beside a frozen reconciliation. The history view renders `created_at > closed_at` movements distinctly. |
| D7 | **Admin's session control lives in a new `'cash'` sidebar section scoped to the existing `selectedBranchId`**, not the page header | A global header control; a per-`SaleModal` open/close control. | `admin/page.tsx` already maintains `selectedBranchId` (`:62`, localStorage-persisted `:216/:234`) and threads it into `DashboardView`/`HistoryView`/`StockView` — admin's "current branch" already exists as UI state. A header control would let an admin close another branch's drawer by mis-clicking while the selector points elsewhere. `SaleModal` gets only a **read-only** one-line indicator, because that is where the attribution decision is actually made. |
| D8 | **On `SaleModal` edit, the recreated rows attach to the branch's *currently* open session — never the original's `cash_session_id`** | Preserving the original id. | Edit is delete-then-recreate (`:351-357`, `:418`/`:437`). Re-attaching to a frozen session would inject money into a closed reconciliation. If the original session is still the branch's open one, `fetchOpenSession` returns the same id anyway. |

## Section 17 DDL

```sql
-- ==============================================================================
-- 17. CASH REGISTER — per-branch caja sessions + manual cash ledger
-- ==============================================================================

-- 17.1 cash_sessions. One open session per branch is a DATABASE invariant.
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL,
  opened_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  opening_amount  numeric(10,2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at       timestamptz,
  counted_amount  numeric(10,2) CHECK (counted_amount >= 0),
  expected_amount numeric(10,2),
  discrepancy     numeric(10,2),
  FOREIGN KEY (store_id, branch_id) REFERENCES public.branches (store_id, id) ON DELETE CASCADE,
  CONSTRAINT cash_sessions_closed_shape CHECK (
    (status = 'open'   AND closed_at IS NULL AND counted_amount IS NULL
                       AND expected_amount IS NULL AND discrepancy IS NULL)
 OR (status = 'closed' AND closed_at IS NOT NULL AND counted_amount IS NOT NULL
                       AND expected_amount IS NOT NULL AND discrepancy IS NOT NULL)
  )
);

-- THE invariant: at most one open session per branch.
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_branch_idx
  ON public.cash_sessions (branch_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS cash_sessions_store_id_idx ON public.cash_sessions (store_id);
CREATE INDEX IF NOT EXISTS cash_sessions_branch_opened_idx
  ON public.cash_sessions (branch_id, opened_at DESC);

-- Coherence key (section 15.1 pattern, :737-743): a sale's session is always
-- at the sale's own branch, so the RLS subquery in 17.7 can never miss it.
ALTER TABLE public.cash_sessions
  DROP CONSTRAINT IF EXISTS cash_sessions_branch_id_key;
ALTER TABLE public.cash_sessions
  ADD CONSTRAINT cash_sessions_branch_id_key UNIQUE (branch_id, id);

-- 17.2 cash_movements. Manual entries ONLY — sale-driven cash is derived
-- (join sales WHERE payment_method='cash'), never duplicated here.
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  store_id        uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL,
  type            text NOT NULL CHECK (type IN ('cash_in','cash_out')),
  amount          numeric(10,2) NOT NULL CHECK (amount > 0),
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  note            text,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, branch_id) REFERENCES public.branches (store_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cash_movements_session_idx
  ON public.cash_movements (cash_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_movements_store_id_idx ON public.cash_movements (store_id);

-- 17.3 RLS — Shape B verbatim (:851-866), split across SELECT/INSERT exactly like
-- stock_movements (:868-890). No UPDATE or DELETE policy exists on either table,
-- so RLS default-denies both verbs; 17.6 revokes the privilege as well.
ALTER TABLE public.cash_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read cash sessions in their branch" ON public.cash_sessions;
CREATE POLICY "Users can read cash sessions in their branch" ON public.cash_sessions
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

-- Opening a session is a plain INSERT (decision D1). opened_by is pinned to the
-- caller so an open can never be attributed to someone else.
DROP POLICY IF EXISTS "Operators can open cash sessions in their branch" ON public.cash_sessions;
CREATE POLICY "Operators can open cash sessions in their branch" ON public.cash_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND status = 'open'
    AND opened_by = (select auth.uid())
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR (
        public.get_current_user_role() IN ('encargado','caja','employee')
        AND branch_id = public.get_current_user_branch_id()
      )
    )
  );

DROP POLICY IF EXISTS "Users can read cash movements in their branch" ON public.cash_movements;
CREATE POLICY "Users can read cash movements in their branch" ON public.cash_movements
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

DROP POLICY IF EXISTS "Users can insert cash movements in their branch" ON public.cash_movements;
CREATE POLICY "Users can insert cash movements in their branch" ON public.cash_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND created_by = (select auth.uid())
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

-- 17.4 sales.cash_session_id — nullable, additive. A sale made with no open
-- session lands NULL, exactly like sale_items.product_id for an unmatched name.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cash_session_id uuid;
CREATE INDEX IF NOT EXISTS sales_cash_session_id_idx
  ON public.sales (cash_session_id) WHERE cash_session_id IS NOT NULL;

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_cash_session_branch_fkey;
ALTER TABLE public.sales ADD CONSTRAINT sales_cash_session_branch_fkey
  FOREIGN KEY (branch_id, cash_session_id)
  REFERENCES public.cash_sessions (branch_id, id) ON DELETE SET NULL;

-- 17.5 Stale-attach guard (D5). Never blocks a sale: an id that is missing,
-- foreign, or already closed degrades to NULL (unattributed).
CREATE OR REPLACE FUNCTION public.enforce_sale_cash_session()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NEW.cash_session_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_sessions cs
       WHERE cs.id = NEW.cash_session_id
         AND cs.status = 'open'
         AND cs.branch_id IS NOT DISTINCT FROM NEW.branch_id
    ) THEN
      NEW.cash_session_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_sale_set_cash_session ON public.sales;
CREATE TRIGGER on_sale_set_cash_session
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sale_cash_session();
```

### The close RPC

```sql
-- 17.6 Close = the ONLY mutation path for cash_sessions (D1, D2). SECURITY
-- DEFINER because the caller holds no UPDATE grant, so expected_amount and
-- discrepancy cannot be forged from the client. Authorization is done in the
-- body, mirroring preload_employee (:1086) / the :606 branch-ownership check.
DROP FUNCTION IF EXISTS public.close_cash_session(uuid, numeric);
CREATE FUNCTION public.close_cash_session(
  p_session_id     uuid,
  p_counted_amount numeric
)
RETURNS public.cash_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role        text := public.get_current_user_role();
  v_store_id    uuid := public.get_current_user_store_id();
  v_branch_id   uuid := public.get_current_user_branch_id();
  v_session     public.cash_sessions;
  v_cash_sales  numeric(10,2);
  v_cash_in     numeric(10,2);
  v_cash_out    numeric(10,2);
  v_expected    numeric(10,2);
BEGIN
  IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN
    RAISE EXCEPTION 'A non-negative counted amount is required';
  END IF;

  -- FOR UPDATE serializes two concurrent closes of the same session.
  SELECT * INTO v_session FROM public.cash_sessions
   WHERE id = p_session_id FOR UPDATE;

  -- Same message for "absent" and "other tenant" so existence never leaks.
  IF v_session.id IS NULL OR v_session.store_id IS DISTINCT FROM v_store_id THEN
    RAISE EXCEPTION 'Cash session not found';
  END IF;

  IF v_role IN ('admin','superadmin') THEN
    NULL;  -- store-wide, any branch of their store
  ELSIF v_role IN ('encargado','caja','employee')
        AND v_session.branch_id = v_branch_id THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Not authorized to close this cash session';
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'Cash session is already closed';
  END IF;

  -- sales.total_amount is numeric(10,2); combined payments are split one row
  -- per method (sales-form.tsx:344-402), so this sum is exact — there is no
  -- partial-cash amount to apportion.
  SELECT COALESCE(SUM(s.total_amount), 0) INTO v_cash_sales
    FROM public.sales s
   WHERE s.cash_session_id = p_session_id
     AND s.payment_method = 'cash';

  SELECT COALESCE(SUM(m.amount) FILTER (WHERE m.type = 'cash_in'),  0),
         COALESCE(SUM(m.amount) FILTER (WHERE m.type = 'cash_out'), 0)
    INTO v_cash_in, v_cash_out
    FROM public.cash_movements m
   WHERE m.cash_session_id = p_session_id;

  v_expected := v_session.opening_amount + v_cash_sales + v_cash_in - v_cash_out;

  UPDATE public.cash_sessions
     SET status          = 'closed',
         closed_by       = auth.uid(),
         closed_at       = now(),
         counted_amount  = p_counted_amount,
         expected_amount = v_expected,
         discrepancy     = p_counted_amount - v_expected
   WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

-- 17.7 Grants. Append-only from the client on both tables; close is RPC-only.
GRANT SELECT, INSERT  ON public.cash_sessions  TO authenticated;
GRANT SELECT, INSERT  ON public.cash_movements TO authenticated;
REVOKE UPDATE, DELETE ON public.cash_sessions  FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.cash_movements FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric) TO authenticated;
```

### The Shape D policy replacement (LAST statement of section 17)

Four policies are DROP+CREATEd. Every existing condition is preserved byte-for-byte from
`:1440-1477` / `:1504-1547`; the **only** delta is one AND-clause appended to the
`encargado` and `caja`/`employee` arms. The `admin`/`superadmin` arms are untouched —
they keep unconditional access, per the resolved question round.

```sql
-- 17.8 Post-close immutability. Delta vs 16.5 is ONE clause, on the non-admin
-- arms only. admin/superadmin stay unconditional (resolved Q1).
DROP POLICY IF EXISTS "Sellers can update sales in their scope" ON public.sales;
CREATE POLICY "Sellers can update sales in their scope" ON public.sales
  FOR UPDATE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND employee_id = (select auth.uid())
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
    )
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND employee_id = (select auth.uid())
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
    )
  );

DROP POLICY IF EXISTS "Sellers can delete sales in their scope" ON public.sales;
CREATE POLICY "Sellers can delete sales in their scope" ON public.sales
  FOR DELETE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND employee_id = (select auth.uid())
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
    )
  );

-- sale_items reaches the session through its EXISTS join to sales, which the
-- caja/employee arm already carries; the encargado arm gains that same join.
DROP POLICY IF EXISTS "Sellers can update sale items in their scope" ON public.sale_items;
CREATE POLICY "Sellers can update sale items in their scope" ON public.sale_items
  FOR UPDATE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND NOT EXISTS (SELECT 1 FROM public.sales s
                           JOIN public.cash_sessions cs ON cs.id = s.cash_session_id
                          WHERE s.id = sale_items.sale_id
                            AND cs.status = 'closed'))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND EXISTS (SELECT 1 FROM public.sales s
                       WHERE s.id = sale_items.sale_id
                         AND s.employee_id = (select auth.uid())
                         AND (s.cash_session_id IS NULL
                              OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                                          WHERE cs.id = s.cash_session_id
                                            AND cs.status = 'open'))))
    )
  )
  WITH CHECK ( /* identical expression to USING */ );

DROP POLICY IF EXISTS "Sellers can delete sale items in their scope" ON public.sale_items;
CREATE POLICY "Sellers can delete sale items in their scope" ON public.sale_items
  FOR DELETE TO authenticated
  USING ( /* identical expression to the UPDATE USING above */ );
```

> `sdd-apply` writes the two elided bodies out in full — they are literal copies of the
> UPDATE `USING` expression, matching how 16.5 already duplicates `USING`/`WITH CHECK`.
> Note the encargado `sale_items` arm uses `NOT EXISTS (… JOIN …)` rather than the
> positive form, because that arm has no pre-existing `EXISTS` join to extend; a closed
> session must be positively *found* for the deny to fire, and an encargado can always
> see their own branch's sessions.

### Rollback (17.9, commented)

Reverse, bottom to top: restore the four 16.5 policies verbatim from `:1440-1477` /
`:1504-1547` (the closed-session clause is the only delta, so the restore is a literal
copy) → `DROP FUNCTION close_cash_session(uuid, numeric)` → `DROP TRIGGER
on_sale_set_cash_session` + `DROP FUNCTION enforce_sale_cash_session()` → drop
`sales_cash_session_branch_fkey`, `sales_cash_session_id_idx`, then `ALTER TABLE
public.sales DROP COLUMN IF EXISTS cash_session_id` → `DROP TABLE public.cash_movements
CASCADE` → `DROP TABLE public.cash_sessions CASCADE`.

## Data Flow

```
  OPEN                    SELL                          CLOSE
  ────                    ────                          ─────
  CashSessionPanel        sales-form / SaleModal        CashSessionPanel
       │                        │                             │
       │ INSERT cash_sessions   │ fetchOpenSession(branchId)   │ rpc close_cash_session
       │  (status='open')       │        ↓                    │  (p_session_id, p_counted)
       ▼                        │ cash_session_id | NULL       ▼
  partial unique idx            ▼                        FOR UPDATE + status check
  23505 → "ya hay una      INSERT sales ──BEFORE trigger──→  Σ cash sales
  sesión abierta"                        stale/foreign/       + Σ cash_in − Σ cash_out
                                         closed → NULL        + opening_amount
                                                                    ▼
                                                        expected / discrepancy FROZEN
                                                                    ▼
                                              non-admin UPDATE/DELETE on those sales
                                              now denied by 17.8 → cash_movements is
                                              the correction path (admin exempt)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `migration.sql` | Modify | Section 17 as specified above (17.1–17.9) |
| `src/lib/cashSession.ts` | Create | `fetchOpenSession(supabase, branchId)`, `openSession(...)`, `closeSession(...)` (rpc), `addCashMovement(...)`, `CashSession` type. Plain async helpers — the repo has no hooks directory |
| `src/components/shared/CashSessionPanel.tsx` | Create | Banner (opened_by, opened_at, running expected preview) + open dialog (`opening_amount`) + close dialog (`counted_amount`, live discrepancy preview) + cash-in/out dialog. Props `{ storeId, branchId, branchName?, role, userId, onChange? }`. `branchId === null` → renders "Selecciona una sucursal" |
| `src/components/shared/CashSessionHistoryView.tsx` | Create | Session history + reconciliation. RLS already scopes it (admin store-wide, encargado/caja own branch); an optional `branchId` prop adds `.eq('branch_id', …)` for admin's selector. Per session: opening / expected / counted / discrepancy (coloured over/short), expandable movements, post-close movements flagged, plus an "efectivo sin caja" (`cash_session_id IS NULL`) per-branch-per-day counter |
| `src/components/employee/employee-dashboard.tsx` | Modify | `CashSessionPanel` above the tab strip (session is context, not a tab); tab union widens to `'form' \| 'my_sales' \| 'cash'`, third tab renders `CashSessionHistoryView` |
| `src/components/employee/sales-form.tsx` | Modify | Resolve session once in `handleSubmit` (after the product lookup `:322-330`, before `:343`); add `cash_session_id` to the 3 combined objects (`:350/:362/:374`) and the single object (`:407`) |
| `src/components/admin/SaleModal.tsx` | Modify | Resolve for `resolvedBranchId` (`:314`); add `cash_session_id` to `:392/:401/:410` and `saleData` (`:429`); abort when the edit-mode delete (`:351-357`) affects fewer rows than expected; read-only attribution line in the form |
| `src/components/employee/MySalesView.tsx` | Modify | Surface the 0-row RLS denial on delete as "Esta venta pertenece a una caja ya cerrada"; pass through `cash_session_id` in its select (`:77-85`) and mapper (`:125`) |
| `src/lib/salesHelper.ts` | Modify | `Sale` (`:23-31`) and `GroupedSale` (`:108-120`) gain `cash_session_id?: string \| null`; populate at `:183`/`:217`. **`deleteSaleGroup` (`:229-236`) must return the deleted ids** — see Risks |
| `src/lib/roles.ts` | Modify | `export const CASH_SESSION_ROLES = ['admin','superadmin','encargado','caja','employee'] as const` + `canOperateCashSession(role, userBranchId, targetBranchId)`, composed from existing exports and mirroring 17.3's arms |
| `src/components/admin/sidebar-items.ts` | Modify | `AdminSection` gains `'cash'`; new `ADMIN_MENU_ITEMS` entry ("Caja", `Wallet` icon). `ENCARGADO_MENU_ITEMS` inherits it automatically (its filter only removes `branches`/`settings`) |
| `src/app/admin/page.tsx` | Modify | `case 'cash'` → `CashSessionPanel` + `CashSessionHistoryView`, both on `selectedBranchId` (D7) |
| `src/app/encargado/page.tsx` | Modify | `case 'cash'` → same pair, on `userProfile.branch_id` |
| `docs/database.md`, `docs/features.md` | Modify | Section 17 tables, the one-open-session invariant, the closed-session rule and the admin exemption |

## Interfaces / Contracts

```ts
// src/lib/cashSession.ts
export interface CashSession {
  id: string; store_id: string; branch_id: string
  opened_by: string | null; opened_at: string; opening_amount: number
  status: 'open' | 'closed'
  closed_by: string | null; closed_at: string | null
  counted_amount: number | null; expected_amount: number | null; discrepancy: number | null
}

/** Fresh, uncached read. Every sale writer calls this immediately before insert. */
export async function fetchOpenSession(
  supabase: SupabaseClient, branchId: string | null,
): Promise<CashSession | null>   // null when branchId is null or no session is open
```

**Sale-writer contract (all four call sites).** Resolve *once per submit*, never from
component state or a cached context — the whole point is that the id is fresh at insert
time. Every row of a combined payment shares the one resolved id. `null` is a valid,
expected result and is written as `cash_session_id: null`. The 17.5 trigger is the
backstop for the remaining milliseconds of staleness.

```ts
const session = await fetchOpenSession(supabase, branchId)
const cashSessionId = session?.id ?? null
// ... spread `cash_session_id: cashSessionId` into every sales insert object
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| DB (RLS) | Second open at the same branch rejected; caja/encargado open+close own branch only; admin any branch; closed-session UPDATE/DELETE denied for caja/encargado on `sales` and `sale_items`; **admin still allowed**; `cash_movements` UPDATE/DELETE denied by both RLS and `REVOKE` | `execute_sql` on the dev branch with `SET LOCAL role authenticated` + `request.jwt.claims`, one script per role, same harness every prior phase used |
| DB (RPC) | `expected = opening + Σcash + Σin − Σout`; `discrepancy = counted − expected`; re-read after later activity returns identical numbers; double close raises; cross-tenant id → "not found"; unauthorized branch raises | `execute_sql` scripted open→sell→movement→close→re-read |
| DB (trigger) | Stale/closed/foreign `cash_session_id` degrades to `NULL` and the sale still inserts | `execute_sql` |
| Build | `npm run build` (TS strict) | CI/local |
| Advisors | No new security findings, especially on the `SECURITY DEFINER` RPC | `get_advisors` on the dev branch before production |
| Manual E2E | Open → cash sale → cash-out → close with a deliberate discrepancy → attempt a caja edit (denied) → admin edit (allowed) → post-close `cash_movements` correction visible in history | Dev branch, one pass per role |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. All new surface is SQL + React client code.

## Migration / Rollout

Single forward-only append to `migration.sql`, applied to the Supabase dev branch first,
then production. **Orchestrator pre-apply probe (required, this phase has no Supabase MCP
access): re-confirm `SELECT count(*) FROM public.sales` is still 0 immediately before
apply.** That is what makes 17.8 safe — with zero historical rows, no sale needs a
`cash_session_id` backfill and no existing row can be stranded on the tighter predicate.
If the count is no longer 0, stop: the policy replacement then needs an explicit
grandfathering clause (`created_at < <apply timestamp>`) and that is a new decision.
`sdd-tasks` slices by dependency: (1) schema + RLS + RPC, (2) writer attribution +
`salesHelper`/`roles`, (3) open/close + movements UI, (4) history/reconciliation view.

## Open Questions

- [ ] None blocking. D2 (`SECURITY DEFINER` close RPC) is a deliberate, justified deviation
      from the proposal's `SECURITY INVOKER` wording — flagged for the user, not a blocker.
