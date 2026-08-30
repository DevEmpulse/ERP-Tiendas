# Design: Purchases Tracking

## Technical Approach

Two new tenant-scoped tables (`purchases` header + `purchase_items` lines) shaped after
`sales`/`sale_items`, with three PL/pgSQL triggers on `purchase_items`: one that pins
scope from the header (`BEFORE INSERT`), one that moves `branch_stock` and writes the
`stock_movements` ledger row in both directions (`AFTER INSERT` / `AFTER DELETE`, a
line-for-line mirror of `apply_sale_item_stock()`, `migration.sql:919-968`), and one that
moves `products.purchase_price` forward (`AFTER INSERT` only). No `UPDATE` path exists on
either table: editing is delete-then-recreate and voiding is delete-only, both driven from
the client with the mandatory deleted-row-count verification already established by
`salesHelper.ts:246-255`. Everything lands as `migration.sql` section 23 (current last
section is 22, `migration.sql:2486`).

## Architecture Decisions

| # | Decision | Chosen | Rejected alternative | Rationale |
|---|---|---|---|---|
| D1 | Stock mechanism | `AFTER INSERT`/`AFTER DELETE` trigger on `purchase_items`, identical control flow to `apply_sale_item_stock()` | `adjust_branch_stock()` RPC with a cost argument | Proposal-resolved; the RPC has no line/document linkage and no reversal path. Copying the sales function line-for-line is the proposal's own mitigation for arithmetic drift across the three stock writers |
| D2 | Cost forward-update | **Separate** `apply_purchase_item_cost()` trigger, `AFTER INSERT` only | Folding the `UPDATE products` into `apply_purchase_item_stock()` | Different lifecycle (stock reverses on DELETE, cost does not) and, decisively, a different security context (D4). One function cannot be both `SECURITY INVOKER` and `SECURITY DEFINER`. Splitting also keeps the stock function a byte-comparable mirror of the sales one |
| D3 | Which insert wins the scalar | Update `products.purchase_price` **only when the inserted line's purchase is the chronologically newest for that product** (`(purchase_date, created_at)` row comparison) | Unconditional update on every insert | Reconciles the spec's two requirements: unconditional would let a re-insert while editing a 3-month-old purchase clobber a newer cost, contradicting `Voiding an older purchase never retroactively changes current cost` ("...or edited"). Flagged below as **DEV-1** |
| D4 | Cost trigger security | `SECURITY DEFINER`, tenant-scoped by explicit `store_id` predicates | `SECURITY INVOKER` like the stock trigger | `products.purchase_price` is a **store-wide** scalar, so "is this the newest purchase?" must be answered store-wide. Under invoker RLS an `encargado` cannot see another branch's newer purchase and would silently overwrite its cost. No escalation: only `PURCHASE_ROLES` can insert a `purchase_items` row at all, and that set is exactly the `products` write set (`migration.sql:1362-1371`) |
| D5 | Edit granularity | Delete + recreate the **whole purchase** (header + lines) | Keep the header, replace only lines | Keeping the header would require an `UPDATE` policy on `purchases` to edit supplier/date/note. Whole-document replacement keeps the "no UPDATE policy anywhere" invariant and mirrors `SaleModal.tsx:377-386` exactly |
| D6 | No `total_cost` on the header | Sum lines client-side | Denormalized `total_cost` mirroring `sales.total_amount` | The history view already fetches nested lines (needed for detail + edit), so the column would buy nothing and add a drift class. Deliberate divergence from the sales mirror |
| D7 | Deletion FKs | `ON DELETE RESTRICT` on both composite branch FKs and on `purchase_items.product_id` | `CASCADE` (branch_stock) / `SET NULL` (sale_items) | Purchase cost history is audit history; §21.2 already moved the ledgers to RESTRICT for exactly this reason. `product_id` is `NOT NULL` here (a purchase line always targets a real product, unlike a free-text sale line), so `SET NULL` is not available |
| D8 | `PURCHASE_ROLES` as its own constant | New `['admin','superadmin','encargado']` constant + `canRecordPurchase()` | Reuse `CATALOG_WRITE_ROLES` | Same membership today by fork-2, but different meaning (cost recording vs. catalog writing). A separate constant lets one move without silently moving the other, matching how `CASH_SESSION_ROLES` was introduced |

## Data Flow

    PurchaseModal ──insert purchases──▶ purchases (RLS: PURCHASE_ROLES + branch)
          │                                  │
          └──insert purchase_items[] ────────┘
                     │
                     ├─ BEFORE INSERT  set_purchase_item_scope()   → store_id/branch_id pinned from header
                     ├─ AFTER  INSERT  apply_purchase_item_stock() → branch_stock +qty, stock_movements(reason='purchase')
                     └─ AFTER  INSERT  apply_purchase_item_cost()  → products.purchase_price = unit_cost (if newest)

    Void / Edit ──delete purchases──▶ CASCADE deletes purchase_items
                     └─ AFTER DELETE  apply_purchase_item_stock() → branch_stock −applied, stock_movements(reason='purchase_reversal')
                        (no cost trigger fires: the scalar never reverts)

## Schema (migration.sql §23)

```sql
-- ==============================================================================
-- 23. PURCHASES — supplier purchase header/lines, trigger-driven stock increase
-- ==============================================================================

-- 23.1 purchases. Header mirrors sales (:29-38) with the composite branch
-- coherence FK convention from 15.4/17.1. No UPDATE path exists: a correction is
-- delete + re-insert (see design D5), exactly like SaleModal.tsx:377-386.
CREATE TABLE IF NOT EXISTS public.purchases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL,
  supplier_name text,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  note          text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, branch_id) REFERENCES public.branches (store_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS purchases_store_id_idx ON public.purchases (store_id);
CREATE INDEX IF NOT EXISTS purchases_branch_date_idx
  ON public.purchases (branch_id, purchase_date DESC, created_at DESC);

-- 23.2 purchase_items. Column shape mirrors sale_items (:476-486). branch_id is
-- denormalized for the same reason as sale_items.branch_id (:892-894): the AFTER
-- DELETE reversal runs once the parent purchase is already gone. Here it is NOT
-- NULL from day one (no pre-branches legacy rows exist) and is pinned by 23.5.
CREATE TABLE IF NOT EXISTS public.purchase_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  purchase_id  uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL,
  product_id   uuid NOT NULL,
  product_name text NOT NULL,
  quantity     int NOT NULL CHECK (quantity > 0),
  unit_cost    numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  subtotal     numeric(10,2) NOT NULL CHECK (subtotal >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, branch_id)  REFERENCES public.branches (store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, product_id) REFERENCES public.products (store_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS purchase_items_purchase_id_idx ON public.purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS purchase_items_product_id_idx  ON public.purchase_items (product_id);
CREATE INDEX IF NOT EXISTS purchase_items_store_id_idx    ON public.purchase_items (store_id);

-- 23.3 stock_movements linkage + reason widening. purchase_item_id has NO FK, for
-- the same reason sale_item_id has none (:821-823): the reversal row is written
-- once the line is already gone.
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS purchase_item_id uuid;
CREATE INDEX IF NOT EXISTS stock_movements_purchase_item_id_idx
  ON public.stock_movements (purchase_item_id) WHERE purchase_item_id IS NOT NULL;

-- The target is the auto-named inline column CHECK created at :830-831 and never
-- since altered. VERIFY THE REAL NAME AGAINST PRODUCTION BEFORE RUNNING:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.stock_movements'::regclass AND contype = 'c';
-- If the name differs, DROP ... IF EXISTS silently no-ops, the old 5-value CHECK
-- stays in force, and every 'purchase' insert is rejected at runtime.
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
ALTER TABLE public.stock_movements ADD  CONSTRAINT stock_movements_reason_check CHECK (reason IN
  ('sale', 'sale_reversal', 'manual_adjustment', 'restock', 'import_ingress',
   'purchase', 'purchase_reversal'));

-- A ledger row belongs to at most one source document.
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_one_source_check;
ALTER TABLE public.stock_movements ADD  CONSTRAINT stock_movements_one_source_check
  CHECK (sale_item_id IS NULL OR purchase_item_id IS NULL);
```

### 23.4 RLS — Shape B, verb-split, INSERT/DELETE narrowed to PURCHASE_ROLES

SELECT is plain Shape B (`:851-866`). INSERT/DELETE reuse Shape B's store predicate but
replace the branch arm's role list with `encargado` only — narrower than
`stock_movements`' own set, which admits `caja`/`stock`/`employee` at their branch.
`stock` is excluded **on purpose** (fork 2: it may move quantities, never record cost).

```sql
ALTER TABLE public.purchases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read purchases in their branch" ON public.purchases;
CREATE POLICY "Users can read purchases in their branch" ON public.purchases
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

DROP POLICY IF EXISTS "Purchase managers can create purchases in their scope" ON public.purchases;
CREATE POLICY "Purchase managers can create purchases in their scope" ON public.purchases
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND created_by = (select auth.uid())
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
    )
  );

DROP POLICY IF EXISTS "Purchase managers can delete purchases in their scope" ON public.purchases;
CREATE POLICY "Purchase managers can delete purchases in their scope" ON public.purchases
  FOR DELETE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
    )
  );

DROP POLICY IF EXISTS "Users can read purchase items in their branch" ON public.purchase_items;
CREATE POLICY "Users can read purchase items in their branch" ON public.purchase_items
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

DROP POLICY IF EXISTS "Purchase managers can create purchase items in their scope" ON public.purchase_items;
CREATE POLICY "Purchase managers can create purchase items in their scope" ON public.purchase_items
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
    )
  );

DROP POLICY IF EXISTS "Purchase managers can delete purchase items in their scope" ON public.purchase_items;
CREATE POLICY "Purchase managers can delete purchase items in their scope" ON public.purchase_items
  FOR DELETE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
    )
  );
-- No UPDATE policy on either table: RLS default-denies the verb (23.8 also
-- revokes the privilege), which is what makes delete-then-recreate the only
-- correction path.
```

`purchase_items`' INSERT `WITH CHECK` sees the values **after** the BEFORE ROW trigger, so
the header-pinned `branch_id`/`store_id` are what get validated — a client that sends a
foreign `branch_id` has it overwritten first, then checked.

### 23.5–23.7 Trigger functions

```sql
-- 23.5 Scope pinning. Stricter than set_sale_item_branch (:901-911), which only
-- fills a NULL: here both columns are ALWAYS taken from the header, so a line can
-- never be attributed to a different branch or store than its own purchase. The
-- SELECT runs under RLS, so an invisible header yields NULLs and the NOT NULL
-- columns fail the insert closed.
CREATE OR REPLACE FUNCTION public.set_purchase_item_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  SELECT p.store_id, p.branch_id INTO NEW.store_id, NEW.branch_id
    FROM public.purchases p WHERE p.id = NEW.purchase_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_purchase_item_set_scope ON public.purchase_items;
CREATE TRIGGER on_purchase_item_set_scope
  BEFORE INSERT ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.set_purchase_item_scope();

-- 23.6 Purchase line -> branch stock. One function, both directions. Structurally
-- identical to apply_sale_item_stock() (:919-968); the ONLY semantic difference is
-- the sign of the INSERT delta.
--
-- On GREATEST(): a purchase INSERT can never need the floor (v_before >= 0 and
-- v_delta > 0), so it is a no-op there — but it is LOAD-BEARING on DELETE, which
-- is the decreasing direction: reversing 5 units from a balance the sale side has
-- since drawn down to 2 would otherwise violate branch_stock's
-- `current_stock >= 0` CHECK. The clamp is therefore kept verbatim, and
-- applied_delta records what was truly applied (-2 in that example), exactly
-- mirroring how the sales trigger clamps an oversell on its own INSERT side.
CREATE OR REPLACE FUNCTION public.apply_purchase_item_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_item public.purchase_items%ROWTYPE;
  v_delta int; v_before int; v_after int; v_prior_applied int;
BEGIN
  IF TG_OP = 'INSERT' THEN v_item := NEW; ELSE v_item := OLD; END IF;

  IF v_item.product_id IS NULL OR v_item.branch_id IS NULL THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    v_delta := v_item.quantity;                 -- a purchase ADDS units
  ELSE
    -- Reverse what was APPLIED, not what was requested (sales precedent :935-942).
    SELECT m.applied_delta INTO v_prior_applied
      FROM public.stock_movements m
     WHERE m.purchase_item_id = v_item.id AND m.reason = 'purchase'
     ORDER BY m.created_at DESC LIMIT 1;
    IF v_prior_applied IS NULL THEN RETURN NULL; END IF;   -- nothing was ever applied
    v_delta := -v_prior_applied;
  END IF;

  IF v_delta = 0 THEN RETURN NULL; END IF;

  INSERT INTO public.branch_stock (store_id, branch_id, product_id, current_stock)
  VALUES (v_item.store_id, v_item.branch_id, v_item.product_id, 0)
  ON CONFLICT (branch_id, product_id) DO UPDATE SET updated_at = now()
  RETURNING current_stock INTO v_before;

  UPDATE public.branch_stock
     SET current_stock = GREATEST(v_before + v_delta, 0), updated_at = now()
   WHERE branch_id = v_item.branch_id AND product_id = v_item.product_id
  RETURNING current_stock INTO v_after;

  INSERT INTO public.stock_movements
    (store_id, branch_id, product_id, purchase_item_id, reason,
     quantity_delta, applied_delta, resulting_balance)
  VALUES
    (v_item.store_id, v_item.branch_id, v_item.product_id, v_item.id,
     CASE WHEN TG_OP = 'INSERT' THEN 'purchase' ELSE 'purchase_reversal' END,
     v_delta, v_after - v_before, v_after);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_purchase_item_inserted ON public.purchase_items;
CREATE TRIGGER on_purchase_item_inserted
  AFTER INSERT ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_purchase_item_stock();

DROP TRIGGER IF EXISTS on_purchase_item_deleted ON public.purchase_items;
CREATE TRIGGER on_purchase_item_deleted
  AFTER DELETE ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_purchase_item_stock();

-- 23.7 Purchase line -> products.purchase_price (design D2/D3/D4). INSERT only:
-- a void or an edit's delete NEVER reverts the scalar (resolved default
-- q2b_purchase_price_reversion_on_edit_void).
--
-- SECURITY DEFINER because purchase_price is a STORE-WIDE scalar: the "is this
-- the newest purchase for this product?" lookback must see every branch, and an
-- encargado's RLS view stops at their own. Tenant scoping is therefore restated
-- explicitly on both the lookback and the UPDATE. This grants no new power: only
-- PURCHASE_ROLES can insert a purchase_items row at all, and that set is exactly
-- the products write set (:1362-1371).
CREATE OR REPLACE FUNCTION public.apply_purchase_item_cost()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_this_date date; v_this_created timestamptz;
  v_max_date  date; v_max_created  timestamptz;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NULL; END IF;

  SELECT p.purchase_date, p.created_at INTO v_this_date, v_this_created
    FROM public.purchases p
   WHERE p.id = NEW.purchase_id AND p.store_id = NEW.store_id;
  IF v_this_date IS NULL THEN RETURN NULL; END IF;

  -- Newest OTHER purchase line for the same product, store-wide.
  SELECT p.purchase_date, p.created_at INTO v_max_date, v_max_created
    FROM public.purchase_items pi
    JOIN public.purchases p ON p.id = pi.purchase_id
   WHERE pi.product_id = NEW.product_id
     AND pi.store_id   = NEW.store_id
     AND pi.id <> NEW.id
   ORDER BY p.purchase_date DESC, p.created_at DESC
   LIMIT 1;

  -- Ties go to the row being inserted, so re-inserting the newest purchase during
  -- an edit still applies its corrected cost.
  IF v_max_date IS NULL
     OR (v_this_date, v_this_created) >= (v_max_date, v_max_created) THEN
    UPDATE public.products
       SET purchase_price = NEW.unit_cost, updated_at = now()
     WHERE id = NEW.product_id AND store_id = NEW.store_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_purchase_item_cost ON public.purchase_items;
CREATE TRIGGER on_purchase_item_cost
  AFTER INSERT ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_purchase_item_cost();
```

### 23.8 Grants (revoke-then-grant per §17.7 / §21.1)

```sql
GRANT  SELECT, INSERT, DELETE ON public.purchases      TO authenticated;
GRANT  SELECT, INSERT, DELETE ON public.purchase_items TO authenticated;
REVOKE UPDATE ON public.purchases      FROM authenticated, anon;
REVOKE UPDATE ON public.purchase_items FROM authenticated, anon;

REVOKE EXECUTE ON FUNCTION public.set_purchase_item_scope()  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_purchase_item_scope()  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_purchase_item_stock() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_purchase_item_stock() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_purchase_item_cost()  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_purchase_item_cost()  TO authenticated;
-- Trigger functions are not usefully callable directly (they raise outside a
-- trigger context), but the grant is kept so no PostgreSQL version can fail an
-- insert on a missing EXECUTE privilege, and the REVOKE matches §21.1's rule that
-- every function this project ships is closed to PUBLIC/anon.
```

### 23.9 Rollback (do not run automatically) — reverse of section 23, bottom to top

```sql
-- REVOKE EXECUTE ON FUNCTION public.apply_purchase_item_cost()  FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.apply_purchase_item_stock() FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.set_purchase_item_scope()   FROM authenticated;
-- DROP TRIGGER  IF EXISTS on_purchase_item_cost      ON public.purchase_items;
-- DROP TRIGGER  IF EXISTS on_purchase_item_deleted   ON public.purchase_items;
-- DROP TRIGGER  IF EXISTS on_purchase_item_inserted  ON public.purchase_items;
-- DROP TRIGGER  IF EXISTS on_purchase_item_set_scope ON public.purchase_items;
-- DROP FUNCTION IF EXISTS public.apply_purchase_item_cost();
-- DROP FUNCTION IF EXISTS public.apply_purchase_item_stock();
-- DROP FUNCTION IF EXISTS public.set_purchase_item_scope();
-- DROP TABLE    IF EXISTS public.purchase_items CASCADE;
-- DROP TABLE    IF EXISTS public.purchases      CASCADE;
-- ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_one_source_check;
-- DROP INDEX IF EXISTS public.stock_movements_purchase_item_id_idx;
-- ALTER TABLE public.stock_movements DROP COLUMN IF EXISTS purchase_item_id;
-- Narrowing the reason CHECK back to 5 values REQUIRES zero rows with
-- reason IN ('purchase','purchase_reversal'); delete them first or leave the
-- widened CHECK in place (harmless when unused):
-- ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
-- ALTER TABLE public.stock_movements ADD  CONSTRAINT stock_movements_reason_check CHECK (reason IN
--   ('sale', 'sale_reversal', 'manual_adjustment', 'restock', 'import_ingress'));
```

## Interfaces / Contracts

```ts
// src/lib/roles.ts — additions
// Purchases (migration.sql §23): who may record, edit, and void a purchase.
// Same membership as CATALOG_WRITE_ROLES today (resolved fork 2) but a distinct
// constant: a purchase writes cost, and the two gates may diverge later.
// `stock` is deliberately absent — it may move quantities via adjust_branch_stock,
// never record what was paid.
export const PURCHASE_ROLES = ['admin', 'superadmin', 'encargado'] as const

export function canRecordPurchase(
  role: string | null | undefined,
  userBranchId: string | null | undefined,
  targetBranchId: string | null | undefined
): boolean {
  if (!role || !(PURCHASE_ROLES as readonly string[]).includes(role)) return false
  if (role === 'admin' || role === 'superadmin') return true
  if (!targetBranchId || !userBranchId) return false
  return userBranchId === targetBranchId
}
```

```ts
// src/lib/purchasesHelper.ts (new)
export interface PurchaseItemRow {
  id: string
  product_id: string
  product_name: string
  quantity: number
  unit_cost: number | string
  subtotal: number | string
}

export interface Purchase {
  id: string
  store_id: string
  branch_id: string
  supplier_name: string | null
  purchase_date: string          // YYYY-MM-DD
  note: string | null
  created_by: string | null
  created_at: string
  purchase_items?: PurchaseItemRow[] | null
}

export const purchaseTotal = (p: Pick<Purchase, 'purchase_items'>): number =>
  (p.purchase_items ?? []).reduce((acc, l) => acc + Number(l.subtotal), 0)

/**
 * Deletes the given purchase ids and returns the ids the database actually
 * deleted. Identical contract to salesHelper.ts's `deleteSaleGroup`: RLS can
 * silently block a DELETE (0 rows affected, `error: null`) — here when an
 * encargado targets another branch's purchase. Callers MUST compare
 * `deletedIds.length` against the expected count and abort (no re-insert) if it
 * comes up short, or an edit will duplicate the purchase and double-count both
 * stock and cost. This is the exact bug class already shipped and fixed once in
 * this codebase (`deleteSaleGroup`), so it is mandatory from day one here.
 */
export async function deletePurchaseGroup(
  supabase: SupabaseClient,
  ids: string[]
): Promise<{ deletedIds: string[]; error: { message: string } | null }> {
  if (!ids || ids.length === 0) return { deletedIds: [], error: null }
  const { data, error } = await supabase.from('purchases').delete().in('id', ids).select('id')
  if (error) return { deletedIds: [], error }
  return { deletedIds: (data ?? []).map((r: { id: string }) => r.id), error: null }
}

/**
 * Inserts the header then its lines. If the line insert fails, the just-created
 * header is deleted so no empty purchase is left behind (the two statements are
 * separate round-trips; only the per-line trigger work is transactional).
 */
export async function createPurchase(
  supabase: SupabaseClient,
  input: {
    storeId: string; branchId: string; createdBy: string
    supplierName: string | null; purchaseDate: string; note: string | null
    lines: Array<{ product_id: string; product_name: string; quantity: number; unit_cost: number }>
  }
): Promise<{ purchaseId: string | null; error: { message: string } | null }>
```

Edit flow in `PurchaseModal.tsx`, mirroring `SaleModal.tsx:372-386` verbatim in shape:

```ts
if (isEditMode && purchaseToEdit) {
  const { deletedIds, error } = await deletePurchaseGroup(supabase, [purchaseToEdit.id])
  if (error) throw error
  if (deletedIds.length < 1) {
    throw new Error('No se pudo editar esta compra: no tenés permiso sobre esa sucursal.')
  }
}
// ...then createPurchase(...) with the corrected lines
```

Void flow in `PurchasesHistory.tsx`, mirroring `MySalesView.tsx:162-185`: same call, on a
short count show a denial toast, clear the target, and reload instead of reporting success.

## File Changes

| File | Action | Description | ~Lines |
|------|--------|-------------|--------|
| `migration.sql` | Modify | Append §23 (23.1–23.9) after §22 (`:2500`) | +250 |
| `src/lib/roles.ts` | Modify | `PURCHASE_ROLES` + `canRecordPurchase()` | +18 |
| `src/lib/purchasesHelper.ts` | Create | Types, `purchaseTotal`, `createPurchase`, `deletePurchaseGroup` | +115 |
| `src/components/admin/PurchaseModal.tsx` | Create | Header fields + repeatable line rows (product picker, qty, unit cost, subtotal), create and edit modes | +420 |
| `src/components/admin/PurchasesHistory.tsx` | Create | Date-range + quick pills + daily-grouped table + per-row edit/void, mirroring `SalesHistory.tsx` | +300 |
| `src/components/admin/StockView.tsx` | Modify | `activeTab` union `'productos' \| 'precios' \| 'compras'`, third tab button + panel, `role`/`userBranchId` props gated by `canRecordPurchase`, void-confirm dialog, `'purchase' \| 'purchase_reversal'` added to the `StockMovement['reason']` union and `REASON_LABELS` (`:78`, `:97-103`) | +95 |
| `src/app/admin/page.tsx` | Modify | Pass `role="admin"` to `StockView` (`:418-422`) | +2 |
| `src/app/encargado/page.tsx` | Modify | Pass `role="encargado"` + `userBranchId` (`:366-370`) | +3 |
| `src/components/employee/StockAdjustmentView.tsx` | Modify | Two new cases in `formatReason` (`:169-184`) so the new reasons are not shown raw | +4 |
| `docs/database.md` | Modify | Document both tables, the three triggers, the widened CHECK | +50 |
| `docs/features.md` | Modify | Document the "Compras" tab, edit/void semantics, cost forward-update | +30 |

**~1290 authored lines. `400-line budget risk: High`** — `sdd-tasks` should slice this into
three chained PRs: (1) `migration.sql` §23 + live RLS verification, (2) `roles.ts` +
`purchasesHelper.ts`, (3) the three UI files + docs.

## UI Placement

`StockView.tsx` already holds the whole tab strip at `:1151-1172` and switches panels with
`activeTab === '...'` blocks at `:1174+`. The "Compras" tab is a third button plus a third
panel; the panel renders `<PurchasesHistory>` with a "Nueva Compra" button opening
`<PurchaseModal>`, both mounted alongside the existing dialogs at the top of the returned
fragment. The tab button and panel render only when
`canRecordPurchase(role, userBranchId, branchId)` is true — defense in depth, since
`StockView` is currently reachable only from `/admin` and `/encargado`, both of which are
already inside `PURCHASE_ROLES`. Existing loaders (`loadProducts`, `branchStock`) are
reused for the modal's product picker, and `loadProducts()` is called after any
create/edit/void so on-hand quantities and the products table's cost column refresh.

`PurchasesHistory.tsx` reuses `SalesHistory.tsx`'s exact structure: `getLocalTodayStr` /
`getLocalDaysAgoStr` / `toLocalDateStr` helpers, the quick-pill row
(`Hoy | Últimos 7 días | Últimos 30 días | Este mes` + `custom`), two `type="date"` inputs,
the aggregate stat cards (total spent, purchase count, average), and the daily-grouped
table sorted newest-first. Per-row actions add a `Pencil` (edit) and `Trash2` (void)
button, gated by the same `canRecordPurchase` result, with the void behind a confirm
`Dialog` matching `MySalesView`'s.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Schema | §23 applies cleanly; all 5 pre-existing `reason` values still insert after the widening | Direct SQL against production (this project's convention), constraint name verified via `pg_constraint` first |
| RLS | admin store-wide, encargado own-branch only, `stock`/`caja`/`employee` rejected on INSERT/DELETE; cross-store and cross-branch SELECT return zero rows; UPDATE denied for every role | Live impersonation with `set_config('request.jwt.claims', ...)`, as done for every prior schema phase |
| Trigger | N-line insert → `branch_stock` +N and N `stock_movements` rows with `purchase_item_id` set; delete → exact inverse via `purchase_reversal`; reversal clamps at zero when stock was drawn down below the purchased quantity | SQL scenario script, assert `branch_stock`/`stock_movements` before and after |
| Cost | Newest purchase moves `purchase_price` up and down; editing an **older** purchase does not clobber a newer cost; void never reverts | SQL scenario with two purchases at different `purchase_date`s |
| Non-regression | `analytics_product_ranking` output unchanged; `get_advisors` clean | Run before/after and diff |
| Build | `npm run build` | Project's configured verify command; no automated test suite exists |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. The change is confined to SQL schema and in-app React/Supabase
data access.

## Migration / Rollout

Single forward migration appended as `migration.sql` §23, applied directly to production
(project convention: no `supabase/migrations/`). Purely additive — two new tables, one new
nullable column, one widened CHECK. Order is strict: tables → CHECK widening → RLS →
functions → triggers → grants; the reversal trigger must not exist before the widened CHECK
accepts `purchase_reversal`. Rollback is §23.9, bottom to top, with the documented caveat
that narrowing the `reason` CHECK requires zero `purchase`/`purchase_reversal` rows. UI and
roles revert by code revert.

## Deviations from the Proposal (confirm before apply)

- **DEV-1 (load-bearing, needs user confirmation).** The proposal and spec say the
  forward-update runs on *every* insert, including an edit's re-insert. This design makes
  it conditional: the update fires only when the inserted line's purchase is the
  chronologically newest for that product (ties favour the inserted row). Without the
  condition, correcting a typo on a three-month-old purchase would silently reset the
  product's current cost to that old value, which directly contradicts the spec's own
  scenario *"Voiding an older purchase never retroactively changes current cost"* (whose
  trigger is "voided **or edited**"). Every scenario the spec lists still passes: recording
  a new purchase always updates (it is the newest), higher and lower costs both apply, and
  a void still never reverts. **If the user prefers the literal unconditional behaviour,
  delete the `IF ... THEN` guard in 23.7 and keep the bare `UPDATE`.**
- **DEV-2.** `q2b_purchase_price_reversion_on_edit_void` is implemented as the orchestrator
  default: neither an edit's delete nor a void ever reverts `products.purchase_price`. A
  correction is a new purchase or a direct catalog edit. Flagging as `state.yaml` requested.
- **DEV-3.** No `total_cost` column on `purchases` (D6) even though `sales` has
  `total_amount`; totals are summed from lines client-side.
- **DEV-4.** `purchase_items.product_id` is `NOT NULL` with `ON DELETE RESTRICT`, unlike
  `sale_items.product_id` (nullable, `SET NULL`): a purchase line always targets a real
  catalog product, and the stock trigger cannot work without one.
- **DEV-5.** `set_purchase_item_scope()` always overwrites `store_id`/`branch_id` from the
  header, whereas `set_sale_item_branch()` only fills a NULL.

## Open Questions

- [ ] DEV-1: confirm the chronological guard on the `products.purchase_price`
      forward-update, or request the literal unconditional behaviour.
- [ ] Confirm the real name of the `stock_movements.reason` CHECK constraint against
      production (`pg_constraint`) before running the `DROP`/`ADD` in 23.3 — the design
      assumes PostgreSQL's auto-generated `stock_movements_reason_check` from the inline
      column CHECK at `migration.sql:830-831`, which no later section alters.
