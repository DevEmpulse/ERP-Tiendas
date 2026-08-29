# Design: Stock Phase 2 — Branch Stock, Product Codes, Excel Import

> **Full rewrite (2026-08-29)**, superseding the pre-branch version that keyed stock on
> `products.stock_quantity`. Kept from it: trigger-based movement, the
> `quantity_delta` / `applied_delta` split, `SECURITY INVOKER` throughout, clamp-at-zero,
> and the no-FK `sale_item_id`. Everything else is re-derived against `store-branches`.

## Technical Approach

Append **section 15** to root `migration.sql` (14 is `store-branches`), dependency-ordered:
coherence keys → code sequence + EAN-8 functions → `products.barcode` conversion →
`branch_stock` → `stock_movements` → Shape B RLS → `sale_items.branch_id` + fill trigger →
stock triggers → `adjust_branch_stock()` → grants.

Stock lives **only** in `branch_stock (branch_id, product_id)`. `products` gains no stock
column, because a quantity is meaningless without a location. Both new tables carry a
denormalized `store_id` **and** `branch_id` and use `store-branches`' **Shape B** predicate
verbatim (`design.md:317-336`).

Client side, everything is a client component under `/admin/*` using the existing
`useState` + `useCallback` loader + `useToast`/`Toaster` pattern (`BranchManager.tsx`
shape). No server actions, no API routes — the repo has none, and RLS is the isolation
boundary.

## Architecture Decisions

### Decision: `branch_stock` uses a composite primary key `(branch_id, product_id)`

**Choice**: no surrogate `id`; `PRIMARY KEY (branch_id, product_id)`.
**Alternatives**: `id uuid PRIMARY KEY` + `UNIQUE (branch_id, product_id)` (the repo's
convention for every other table).
**Rationale**: the pair *is* the identity. The race-free upsert (`ON CONFLICT
(branch_id, product_id) DO UPDATE`) needs that constraint regardless, so a surrogate key
adds a second uniqueness object with **zero consumers** — nothing references a balance row
(`stock_movements` references branch + product, not the balance). Deliberate departure from
convention; recorded here so it is not read as an oversight. PostgREST supports composite
PKs, and `supabase-js` upserts with `onConflict: 'branch_id,product_id'`.

### Decision: cross-store coherence is enforced by composite FKs, not by trust

**Choice**: add `UNIQUE (store_id, id)` to `branches` and `products`, then reference
`(store_id, branch_id)` and `(store_id, product_id)` from both new tables.
**Alternatives**: plain single-column FKs to `branches(id)` / `products(id)`.
**Rationale**: Shape B's `WITH CHECK` only proves `store_id` is *the caller's own store*.
With single-column FKs, an admin could still write `branch_stock(store_id = mine,
branch_id = another store's branch)` — it passes RLS and every FK, and produces a row no
one can ever reconcile. The composite FK makes that unrepresentable. Cost: two extra unique
constraints on section-14/13 tables (additive, no data change) and **one PostgREST
consequence** — a single composite FK is not a resolvable embed target, so the export
reads `products` and `branch_stock` in two queries and merges client-side instead of using
`products(...,branch_stock(...))`. Accepted; the two-query merge is also the only shape
that keeps products with no stock row in the export.

### Decision: `sale_items.branch_id` is **denormalized**, filled by a BEFORE INSERT trigger

**Choice**: `ALTER TABLE sale_items ADD COLUMN branch_id uuid` (nullable), populated by
`set_sale_item_branch()` from `sales.branch_id`; the stock trigger reads the column.
**Alternatives**: (a) the stock trigger joins `sale_items.sale_id -> sales.branch_id`;
(b) the four writers pass `branch_id` explicitly.
**Rationale**: (a) is **not just slower, it is unsafe on the reversal path**. `SaleModal`
edit and `SalesTable` delete both `DELETE FROM sales`, and `sale_items` rows disappear by
`ON DELETE CASCADE`. Postgres runs the cascade *after* the parent row is deleted, so a
`SELECT branch_id FROM sales WHERE id = OLD.sale_id` inside the child's `AFTER DELETE`
trigger is racing a row that is already gone in that transaction — the reversal would
silently no-op and leak stock forever. The column survives into `OLD`; the join does not.
(b) would touch all four writers, which the proposal explicitly keeps unchanged. The
column also matches the repo's existing denormalization of `store_id` onto `sale_items`
(`migration.sql:478`). Nullable because pre-`store-branches` sales have
`sales.branch_id IS NULL`; a NULL branch is a trigger no-op, exactly like a NULL
`product_id`.

### Decision: split-payment duplication needs **no** SQL-side handling

**Confirmed, not assumed**: `store-branches` shipped the one-item-set-per-purchase writers
(`insertedSales[0].id` only). One logical purchase produces exactly one `sale_items` row
per line, so "one movement per `sale_items` row" is already "one movement per purchase".
This design adds **no** dedup logic and must not regress the writers.

### Decision: upsert-and-lock in one statement, replacing `SELECT … FOR UPDATE`

**Choice**: `INSERT … ON CONFLICT (branch_id, product_id) DO UPDATE SET updated_at = now()
RETURNING current_stock INTO v_before`.
**Alternatives**: the old design's `INSERT … DO NOTHING` then `SELECT … FOR UPDATE`.
**Rationale**: create-on-demand and row-locking must be one atomic step. With `DO NOTHING`,
a concurrent uncommitted insert of the same pair is skipped *and* invisible to the
following `SELECT`, so `v_before` comes back NULL and the movement is lost. `DO UPDATE`
performs a no-op write that locks and returns the live row in every case.

### Decision: `barcode` is filled by a column `DEFAULT`, not a BEFORE INSERT trigger

**Choice**: `ALTER COLUMN barcode SET DEFAULT public.next_product_code()`.
**Alternatives**: a `BEFORE INSERT` trigger filling `NEW.barcode` when NULL, or
force-overwriting it.
**Rationale**: `next_product_code()` is self-contained (it needs the 7-digit value to
compute the check digit, so it returns the finished 8 characters either way), and a
fill-when-NULL trigger is behaviourally identical to a DEFAULT with an extra object to
maintain. Force-overwriting was rejected because it would make importing a genuine
manufacturer EAN impossible in a later phase without dropping the trigger. The honest cost:
a DEFAULT is advisory — a client *could* send a `barcode`. Two guards close it in practice:
the app never sends the field, and the check-digit CHECK constraint plus the global unique
index reject anything invalid or colliding, loudly.

### Decision: `stock_movements` stays append-only at **both** the RLS and privilege layers

**Choice**: `FOR SELECT` + `FOR INSERT` Shape B policies only, plus
`REVOKE UPDATE, DELETE … FROM authenticated, anon`.
**Alternatives**: RLS omission alone (the old design), a `FOR ALL` policy.
**Rationale**: RLS default-denies verbs with no policy, but Supabase's default privileges
grant broadly on new `public` tables; an explicit REVOKE means the ledger is immutable even
if a policy is later widened by accident. Honest limit: `service_role`/`postgres` bypass
both.

### Decision: the importer commits as **4 batched calls**, not per-row and not one RPC

**Choice**: (1) `categories.insert([...])`, (2) `products.insert([...])`,
(3) `products.upsert([...], { onConflict: 'id' })`, (4) one
`rpc('adjust_branch_stock', …)` per row carrying a quantity.
**Alternatives**: (a) a single `import_products(jsonb)` RPC — genuinely atomic;
(b) fully per-row client writes.
**Rationale**: no client-side transaction spans network calls, so (b) has N failure points;
batching collapses all catalog writes into 3 single-statement (therefore atomic) calls,
leaving only the quantity RPCs individually fallible — and those are exactly the operations
an admin can re-issue by hand from the adjust-stock dialog. (a) was rejected because it
would duplicate the entire matching/normalizing logic in plpgsql alongside the client
implementation that already produced the preview, creating two sources of truth for the
counts the preview promises, and it blows the 400-line review budget on its own.
**Stated partial-failure behaviour**: the commit reports per-phase and per-row outcomes.
Stock ingress is **additive and therefore not idempotent** — re-running a partially failed
file double-adds the rows that succeeded. The failure dialog therefore lists succeeded row
numbers explicitly, and the documented recovery is to remove them from the file before
retrying (or to correct with an adjustment). This is a real cost of the client-side model
and is not hidden behind a retry button.

### Decision: `exceljs`, dynamically imported

**Choice**: one dependency, `exceljs` (MIT, npm registry), `await import('exceljs')` inside
the click handler.
**Alternatives**: (a) npm `xlsx` — SheetJS stopped publishing to the npm registry after
`0.18.5`; that frozen copy carries the prototype-pollution and ReDoS advisories whose fixes
exist only in `≥0.19.3` / `≥0.20.2`; (b) SheetJS from `https://cdn.sheetjs.com/…​.tgz` —
genuinely maintained, but a non-registry dependency spec breaks registry-mirrored/offline
CI installs and weakens lockfile provenance; (c) `read-excel-file` + `write-excel-file` —
browser-first and lighter, but two dependencies and a schema-driven read API that fights
the "read whatever headers exist, then normalize" requirement.
**Rationale**: export exists specifically to produce a file the importer accepts unmodified,
so one library owning **both** directions removes an entire class of round-trip mismatch.
No React/Next peer dependencies. Dynamic import keeps ~1 MB out of the `/admin` initial
bundle.
**Verification gap — must be closed at apply, not assumed here**: this session had no
network tool, so registry recency was not confirmed. Preflight before any importer UI work:
`npm view exceljs version time.modified`, `npm i -E exceljs`, `npm audit`, `npm run build`,
plus a browser smoke test (ExcelJS has historically needed a `Buffer`/stream shim under some
bundlers). If any step fails, fall back to (c). `jsbarcode` is likewise installed with
`npm i -E jsbarcode` and the resolved version recorded; add `@types/jsbarcode` only if the
build reports missing types.

### Decision: label printing follows `ReceiptModal.tsx`, not the `@media print` block

**Choice**: render labels into an off-screen `ref`, then `window.open` a self-contained
document with an inline `<style>` sheet and call `win.print()`.
**Alternatives**: the `@media print` / `body > * { display: none }` rule in
`globals.css:133-142`.
**Rationale**: that rule is declared but has **no consumer in `src/`** — the shipped
thermal receipt uses the `window.open` + `innerHTML` pattern (`ReceiptModal.tsx:76-175`).
Following the code that actually works avoids fighting Next's DOM for the print root, and
the jsbarcode-produced `<svg>` is self-contained inline markup that renders unchanged when
copied into the new document.

## EAN-8 Check Digit — exact algorithm

For a GTIN-8 `N1 N2 N3 N4 N5 N6 N7 N8` where `N8` is the check digit:

| Position (left→right) | N1 | N2 | N3 | N4 | N5 | N6 | N7 |
|---|---|---|---|---|---|---|---|
| **Weight** | **3** | 1 | **3** | 1 | **3** | 1 | **3** |

`N8 = (10 − (Σ Nᵢ·wᵢ mod 10)) mod 10`. Equivalently, counting from the **right** of the
full code with the check digit at position 1, every **even** position carries weight 3.

This is the **mirror** of EAN-13, where the leftmost digit carries weight 1 — implementing
EAN-13's `1,3,1,3…` pattern on an 8-digit payload produces a wrong digit for every input
whose weighted sums differ, and those codes fail checksum validation in every real scanner.

Verified against the GS1 published example `96385074` (payload `9638507`, check `4`):
`27+6+9+8+15+0+21 = 86`; `86 mod 10 = 6`; `(10−6) mod 10 = 4` ✓. Second check, `55123457`:
`15+5+3+2+9+4+15 = 53` → `(10−3) mod 10 = 7` ✓. The `mod 10` on the outside matters: a sum
ending in 0 yields check digit `0`, not `10`.

## Forward SQL — `migration.sql` section 15

```sql
-- 15. Branch stock, movement ledger, product codes (Stock Phase 2)

-- 15.1 Coherence keys: make (store_id, id) referenceable so branch/product can never
--      be paired with a foreign store. Additive, no data change.
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_store_id_id_key;
ALTER TABLE public.branches ADD  CONSTRAINT branches_store_id_id_key UNIQUE (store_id, id);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_store_id_id_key;
ALTER TABLE public.products ADD  CONSTRAINT products_store_id_id_key UNIQUE (store_id, id);

-- 15.2 Global product code sequence + EAN-8 generator
CREATE SEQUENCE IF NOT EXISTS public.product_code_seq
  AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 NO CYCLE;

CREATE OR REPLACE FUNCTION public.ean8_check_digit(p_payload text)
RETURNS int
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = public
AS $$
DECLARE v_sum int := 0; i int;
BEGIN
  IF p_payload !~ '^[0-9]{7}$' THEN
    RAISE EXCEPTION 'EAN-8 payload must be exactly 7 digits, got %', p_payload;
  END IF;
  -- Odd positions (1,3,5,7) weigh 3; even positions (2,4,6) weigh 1. Mirror of EAN-13.
  FOR i IN 1..7 LOOP
    v_sum := v_sum + substr(p_payload, i, 1)::int * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END;
  END LOOP;
  RETURN (10 - (v_sum % 10)) % 10;   -- outer mod: a sum ending in 0 yields 0, not 10
END;
$$;

CREATE OR REPLACE FUNCTION public.next_product_code()
RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path = public
AS $$
DECLARE v_payload text;
BEGIN
  v_payload := lpad(nextval('public.product_code_seq')::text, 7, '0');
  RETURN v_payload || public.ean8_check_digit(v_payload)::text;
END;
$$;

-- 15.3 products.barcode: optional free text -> mandatory, generated, globally unique.
--      Column already exists (13.2, `barcode text`) and its Phase 1 index is
--      products_store_barcode_uidx ON (store_id, barcode) WHERE barcode IS NOT NULL.
ALTER TABLE public.products ALTER COLUMN barcode SET DEFAULT public.next_product_code();

-- Runs unconditionally. `products` is verified empty, so this is a no-op today; it is
-- what makes SET NOT NULL safe if that verification is ever wrong. Any surviving Phase 1
-- free-text value is regenerated: it is not a valid code under the new invariant and
-- would fail both the format CHECK and, across stores, the global unique index.
UPDATE public.products
   SET barcode = public.next_product_code()
 WHERE barcode IS NULL OR barcode !~ '^[0-9]{8}$';

ALTER TABLE public.products ALTER COLUMN barcode SET NOT NULL;

DROP INDEX IF EXISTS public.products_store_barcode_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_uidx ON public.products (barcode);

-- Enforces success criterion "the 8th digit validates as a correct EAN-8 check digit"
-- at the DB layer. Caveat: a CHECK calling a user function requires that function to
-- exist first on restore, which the ordering in this file guarantees.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_barcode_ean8_check;
ALTER TABLE public.products ADD  CONSTRAINT products_barcode_ean8_check CHECK (
  barcode ~ '^[0-9]{8}$'
  AND substr(barcode, 8, 1)::int = public.ean8_check_digit(substr(barcode, 1, 7))
);

-- 15.4 Per-branch balances. Composite PK; no surrogate id (see decision).
CREATE TABLE IF NOT EXISTS public.branch_stock (
  store_id      uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL,
  product_id    uuid NOT NULL,
  current_stock int  NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  min_stock     int  NOT NULL DEFAULT 0 CHECK (min_stock >= 0),  -- bare column, no behaviour (Phase 7)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id),
  FOREIGN KEY (store_id, branch_id)  REFERENCES public.branches (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, product_id) REFERENCES public.products (store_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS branch_stock_store_id_idx   ON public.branch_stock (store_id);
CREATE INDEX IF NOT EXISTS branch_stock_product_id_idx ON public.branch_stock (product_id);

-- 15.5 Append-only ledger. sale_item_id has NO FK on purpose: the AFTER DELETE reversal
-- is written once the sale_items row is already gone, and CASCADE would erase the very
-- audit trail this table exists for (Phase 1 precedent: sale_items.product_name).
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL,
  product_id   uuid NOT NULL,
  sale_item_id uuid,
  reason text NOT NULL CHECK (reason IN
    ('sale', 'sale_reversal', 'manual_adjustment', 'restock', 'import_ingress')),
  quantity_delta    int NOT NULL CHECK (quantity_delta <> 0),  -- requested (audit)
  applied_delta     int NOT NULL,                              -- actually applied
  resulting_balance int NOT NULL CHECK (resulting_balance >= 0),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, branch_id)  REFERENCES public.branches (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, product_id) REFERENCES public.products (store_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS stock_movements_store_id_idx ON public.stock_movements (store_id);
CREATE INDEX IF NOT EXISTS stock_movements_branch_product_idx
  ON public.stock_movements (branch_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_sale_item_id_idx
  ON public.stock_movements (sale_item_id) WHERE sale_item_id IS NOT NULL;

-- 15.6 RLS — Shape B verbatim (store-branches design.md:317-336)
ALTER TABLE public.branch_stock    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage branch stock in their branch" ON public.branch_stock;
CREATE POLICY "Users can manage branch stock in their branch" ON public.branch_stock
  FOR ALL TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

-- Append-only: the same boolean expression, split across SELECT/INSERT. No UPDATE or
-- DELETE policy exists, so RLS default-denies both verbs.
DROP POLICY IF EXISTS "Users can read stock movements in their branch" ON public.stock_movements;
CREATE POLICY "Users can read stock movements in their branch" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

DROP POLICY IF EXISTS "Users can insert stock movements in their branch" ON public.stock_movements;
CREATE POLICY "Users can insert stock movements in their branch" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

-- 15.7 sale_items.branch_id — denormalized so the AFTER DELETE reversal survives the
-- sales cascade (see decision). Nullable: pre-store-branches sales have a NULL branch.
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS branch_id uuid;

UPDATE public.sale_items si
   SET branch_id = s.branch_id
  FROM public.sales s
 WHERE s.id = si.sale_id AND si.branch_id IS NULL AND s.branch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_sale_item_branch()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT s.branch_id INTO NEW.branch_id FROM public.sales s WHERE s.id = NEW.sale_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_sale_item_set_branch ON public.sale_items;
CREATE TRIGGER on_sale_item_set_branch
  BEFORE INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.set_sale_item_branch();

-- 15.8 Sale line item -> branch stock. One function, both directions.
CREATE OR REPLACE FUNCTION public.apply_sale_item_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_item public.sale_items%ROWTYPE;
  v_delta int; v_before int; v_after int; v_prior_applied int;
BEGIN
  IF TG_OP = 'INSERT' THEN v_item := NEW; ELSE v_item := OLD; END IF;

  -- Untracked line (no product resolved) or a pre-branch sale: no-op in both directions.
  IF v_item.product_id IS NULL OR v_item.branch_id IS NULL THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    v_delta := -v_item.quantity;
  ELSE
    -- Reverse what was APPLIED, not what was requested, so a clamped oversell
    -- restores the true pre-sale balance instead of inventing units.
    SELECT m.applied_delta INTO v_prior_applied
      FROM public.stock_movements m
     WHERE m.sale_item_id = v_item.id AND m.reason = 'sale'
     ORDER BY m.created_at DESC LIMIT 1;
    IF v_prior_applied IS NULL THEN RETURN NULL; END IF;   -- nothing was ever applied
    v_delta := -v_prior_applied;
  END IF;

  IF v_delta = 0 THEN RETURN NULL; END IF;  -- fully clamped sale: nothing to reverse

  -- Create-on-demand at zero AND take the row lock in one atomic statement.
  INSERT INTO public.branch_stock (store_id, branch_id, product_id, current_stock)
  VALUES (v_item.store_id, v_item.branch_id, v_item.product_id, 0)
  ON CONFLICT (branch_id, product_id) DO UPDATE SET updated_at = now()
  RETURNING current_stock INTO v_before;

  UPDATE public.branch_stock
     SET current_stock = GREATEST(v_before + v_delta, 0), updated_at = now()
   WHERE branch_id = v_item.branch_id AND product_id = v_item.product_id
  RETURNING current_stock INTO v_after;

  INSERT INTO public.stock_movements
    (store_id, branch_id, product_id, sale_item_id, reason,
     quantity_delta, applied_delta, resulting_balance)
  VALUES
    (v_item.store_id, v_item.branch_id, v_item.product_id, v_item.id,
     CASE WHEN TG_OP = 'INSERT' THEN 'sale' ELSE 'sale_reversal' END,
     v_delta, v_after - v_before, v_after);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_sale_item_inserted ON public.sale_items;
CREATE TRIGGER on_sale_item_inserted
  AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_sale_item_stock();

DROP TRIGGER IF EXISTS on_sale_item_deleted ON public.sale_items;
CREATE TRIGGER on_sale_item_deleted
  AFTER DELETE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_sale_item_stock();

-- 15.9 Manual/import adjustment: atomic balance change + ledger entry, admin only.
DROP FUNCTION IF EXISTS public.adjust_branch_stock(uuid, uuid, int, text, text);
CREATE FUNCTION public.adjust_branch_stock(
  p_branch_id  uuid,
  p_product_id uuid,
  p_delta      int,
  p_reason     text DEFAULT 'manual_adjustment',
  p_note       text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_store_id uuid; v_branch_store uuid; v_before int; v_after int;
BEGIN
  IF public.get_current_user_role() NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only admins can adjust stock';
  END IF;
  IF p_delta = 0 THEN RAISE EXCEPTION 'Adjustment delta must not be zero'; END IF;
  IF p_reason NOT IN ('manual_adjustment', 'restock', 'import_ingress') THEN
    RAISE EXCEPTION 'Invalid adjustment reason: %', p_reason;
  END IF;

  -- Both reads run under RLS (SECURITY INVOKER), so a cross-tenant id simply finds
  -- nothing and surfaces as "not found" rather than leaking its existence.
  SELECT p.store_id INTO v_store_id  FROM public.products p WHERE p.id = p_product_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  SELECT b.store_id INTO v_branch_store FROM public.branches b WHERE b.id = p_branch_id;
  IF v_branch_store IS NULL OR v_branch_store <> v_store_id THEN
    RAISE EXCEPTION 'Branch does not belong to this product''s store';
  END IF;

  INSERT INTO public.branch_stock (store_id, branch_id, product_id, current_stock)
  VALUES (v_store_id, p_branch_id, p_product_id, 0)
  ON CONFLICT (branch_id, product_id) DO UPDATE SET updated_at = now()
  RETURNING current_stock INTO v_before;

  UPDATE public.branch_stock
     SET current_stock = GREATEST(v_before + p_delta, 0), updated_at = now()
   WHERE branch_id = p_branch_id AND product_id = p_product_id
  RETURNING current_stock INTO v_after;

  INSERT INTO public.stock_movements
    (store_id, branch_id, product_id, reason,
     quantity_delta, applied_delta, resulting_balance, note)
  VALUES
    (v_store_id, p_branch_id, p_product_id, p_reason,
     p_delta, v_after - v_before, v_after, p_note);

  RETURN v_after;
END;
$$;

-- 15.10 Grants. The sequence grant is REQUIRED: the DEFAULT is evaluated as the
-- inserting (authenticated) role, and nextval() needs USAGE.
GRANT USAGE  ON SEQUENCE public.product_code_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.branch_stock    TO authenticated;
GRANT SELECT, INSERT         ON public.stock_movements TO authenticated;
REVOKE UPDATE, DELETE        ON public.stock_movements FROM authenticated, anon;
REVOKE DELETE                ON public.branch_stock    FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.adjust_branch_stock(uuid, uuid, int, text, text)
  TO authenticated;
```

### Rollback SQL

```sql
-- ROLLBACK (do not run automatically) — reverse of section 15, bottom to top:
DROP FUNCTION IF EXISTS public.adjust_branch_stock(uuid, uuid, int, text, text);
DROP TRIGGER  IF EXISTS on_sale_item_deleted    ON public.sale_items;
DROP TRIGGER  IF EXISTS on_sale_item_inserted   ON public.sale_items;
DROP FUNCTION IF EXISTS public.apply_sale_item_stock();
DROP TRIGGER  IF EXISTS on_sale_item_set_branch ON public.sale_items;
DROP FUNCTION IF EXISTS public.set_sale_item_branch();
ALTER TABLE public.sale_items DROP COLUMN IF EXISTS branch_id;
DROP TABLE IF EXISTS public.stock_movements CASCADE;
DROP TABLE IF EXISTS public.branch_stock    CASCADE;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_barcode_ean8_check;
DROP INDEX IF EXISTS public.products_barcode_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_uidx
  ON public.products (store_id, barcode) WHERE barcode IS NOT NULL;
ALTER TABLE public.products ALTER COLUMN barcode DROP NOT NULL;
ALTER TABLE public.products ALTER COLUMN barcode DROP DEFAULT;
DROP FUNCTION IF EXISTS public.next_product_code();
DROP FUNCTION IF EXISTS public.ean8_check_digit(text);
DROP SEQUENCE IF EXISTS public.product_code_seq;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_store_id_id_key;
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_store_id_id_key;
```

Generated codes are intentionally **left in place** — under restored Phase 1 semantics they
are valid free text, so nothing is destroyed. Drop order is strict: the check-digit CHECK
before the function it calls, triggers before their functions, the `branch_id` column
before the tables that read it, both tables before the constraints they reference.

## Data Flow

```
── Sale at branch X ───────────────────────────────────────────────────────────
sales-form.tsx / SaleModal.tsx
  └─ insert sales rows (1, or N sharing "Ref: #A4F9")
  └─ insert sale_items for insertedSales[0] ONLY   ← already fixed in store-branches
        │ BEFORE INSERT  set_sale_item_branch()  → NEW.branch_id := sales.branch_id
        │ AFTER  INSERT  apply_sale_item_stock()
        ▼
     upsert branch_stock(X, product) → v_before   (create-on-demand at 0 + row lock)
     update current_stock = GREATEST(before − qty, 0) → v_after
     insert stock_movements(reason='sale', quantity_delta=−qty,
                            applied_delta=after−before, resulting_balance=after)

── Edit / delete (delete-then-recreate; cascade from sales) ───────────────────
DELETE sales ─CASCADE→ sale_items ─AFTER DELETE→ reads OLD.branch_id (column survives;
   a join to the already-deleted sales row would not) → applied_delta of the prior
   'sale' movement → reason='sale_reversal'. Net effect exact, oversell included.

── Admin adjustment / import ingress ──────────────────────────────────────────
StockView / ProductImportDialog ─rpc adjust_branch_stock(branch, product, delta, reason)
   → role check → branch-belongs-to-store check → upsert+lock → update → ledger

── Import (client, 4 batched writes) ─────────────────────────────────────────
.xlsx ─ExcelJS.read→ rows ─normalizeHeaders→ resolve ID against products.barcode
  → PREVIEW {create: N, update: M, newCategories: K}  ─confirm→
     1 categories.insert([...])            (atomic)
     2 products.insert([...])              (atomic; barcode omitted → DEFAULT generates)
     3 products.upsert([...], onConflict:'id')  (atomic)
     4 rpc adjust_branch_stock × rows-with-quantity   (individually fallible → reported)

── Export ─────────────────────────────────────────────────────────────────────
products+categories(name)  ─┐
branch_stock @ selectedBranch ┴─ merge client-side (default 0) → ExcelJS write → download
```

## Excel Contract

Header normalization (import): `h.normalize('NFD').replace(/[̀-ͯ]/g,'')
.trim().toLowerCase().replace(/\s+/g,' ')`. Required after normalization:
`nombre del producto`, `seccion`, `cantidad ingresada`, `precio costo unitario`,
`precio venta unitario`. Optional: `id`. Any missing required header **fails the whole
preview** and displays the normalized header list actually found. `margen%` / `totales`
are never read — not even defensively parsed — so the reference file's `#VALUE!` cell is
structurally unreachable.

Column order for **both** directions (an exported file re-imports unmodified):

| ID | Nombre del Producto | Sección | Cantidad Ingresada | Precio Costo Unitario | Precio Venta Unitario |
|----|---------------------|---------|--------------------|-----------------------|-----------------------|

```ts
// ExcelJS cell values are a union; every read column goes through this.
type XlsxCell = null | string | number | boolean | Date
  | { formula?: string; sharedFormula?: string; result?: unknown }
  | { richText: { text: string }[] } | { error: string } | { hyperlink: string; text: string }

function cellText(v: XlsxCell): string        // '' for null/error; result for formulas;
                                              // concatenated richText; ISO for Date
function parseMoney(s: string): number | null  // strips $ and NBSP; '1.234,56' -> 1234.56
                                              // ('.' + ',' => '.' is thousands); ',' only => decimal
function parseQty(s: string): number | null    // '' / 0 / non-numeric => null (no movement)
```

Row resolution: `cellText(row.ID)` is matched against `products.barcode` **in this store**.
Match → update identity fields + (if quantity) one `import_ingress` movement. No match, blank,
or garbage → **create new** with a sequence-generated code; the file's value is never adopted.
Blank quantity on an existing product → identity update only, **no** movement (assumption 3).
New product with a quantity → identity + one `import_ingress` movement (assumption 4).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `migration.sql` | Modify | Section 15 (15.1–15.10) + rollback block; 1–14 untouched |
| `src/components/admin/StockView.tsx` | Modify | Tabs: **Productos** (CRUD without any barcode input, per-branch `Stock` column, adjust dialog, movements dialog, label actions, multi-select) + **Precios Especiales** (today's price-rule CRUD, moved unchanged). New props `branchId`, `branchName` |
| `src/components/admin/ProductLabel.tsx` | Create | jsbarcode `EAN8` on an `<svg>` ref in `useEffect`; code text + name + price; single and batch print via the `ReceiptModal` `window.open` pattern |
| `src/components/admin/ProductImportDialog.tsx` | Create | File input → ExcelJS parse → header normalize → resolve → preview counts → 4-phase commit → outcome report |
| `src/components/admin/ProductExportButton.tsx` | Create | Two-query merge → ExcelJS write → `Blob` download, columns in import order |
| `src/app/admin/page.tsx` | Modify | `:373` — pass `branchId={selectedBranchId}` and the resolved branch name into `StockView` |
| `package.json` | Modify | `exceljs` + `jsbarcode`, both `-E` pinned, lockfile committed |
| `src/components/employee/sales-form.tsx`, `SaleModal.tsx`, `SalesTable.tsx` | Unchanged | Branch is filled by the BEFORE INSERT trigger; the split-payment fix is already shipped |
| `src/app/globals.css` | Unchanged | The unused `@media print` block stays as-is; labels use the `window.open` path |
| `docs/database.md`, `docs/features.md` | Modify | New tables, Shape B usage, code generation, import/export flow |

## Interfaces / Contracts

```ts
interface Product {
  id: string; store_id: string; category_id: string | null
  name: string; barcode: string          // NOT NULL, 8 digits, system-generated
  purchase_price: number; sale_price: number; is_active: boolean
}
interface BranchStock { branch_id: string; product_id: string; current_stock: number; min_stock: number }

type MovementReason =
  | 'sale' | 'sale_reversal' | 'manual_adjustment' | 'restock' | 'import_ingress'

interface StockMovement {
  id: string; branch_id: string; product_id: string; sale_item_id: string | null
  reason: MovementReason
  quantity_delta: number      // requested
  applied_delta: number       // actually applied — differs only on a clamped oversell
  resulting_balance: number; note: string | null; created_at: string
}

// RPC — returns the new balance at that branch
adjust_branch_stock(p_branch_id: string, p_product_id: string, p_delta: number,
                    p_reason?: 'manual_adjustment' | 'restock' | 'import_ingress',
                    p_note?: string | null): number

interface StockViewProps { storeId: string | null; branchId: string | null; branchName?: string }
interface ImportPreview {
  toCreate: ParsedRow[]; toUpdate: (ParsedRow & { productId: string })[]
  newCategories: string[]; skipped: { row: number; reason: string }[]
}
```

## Testing Strategy

No test runner exists (`config.yaml` → `test_command: ""`); verification is `execute_sql`
probes on a **Supabase development branch** plus manual UI passes, matching Phases 1 and
`store-branches`.

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Function | `ean8_check_digit` against published codes | `select public.ean8_check_digit('9638507')` → 4; `'5512345'` → 7; a payload summing to a multiple of 10 → 0 |
| Function | `next_product_code()` produces distinct, self-validating codes | Call 5×; assert regex, uniqueness, and that each 8th digit re-derives |
| Schema | `barcode` NOT NULL + globally unique + CHECK | Insert without `barcode` (auto-filled); insert an invalid check digit (rejected); insert a duplicate code from a second store (rejected) |
| Schema | Composite FK blocks a foreign-store branch/product pair | Insert `branch_stock(store_id=A, branch_id=B's branch)` → FK violation |
| RLS | Shape B both ways | Cross-tenant `select` → 0 rows; employee of branch X reading branch Y → 0 rows; admin reads both |
| RLS | Ledger is append-only | `update`/`delete stock_movements` → 0 rows / permission denied |
| Trigger | Branch fill | Insert a `sale_item`; assert `branch_id` matches its sale |
| Trigger | Decrement at the selling branch only | Sale at X; assert X decremented, Y untouched |
| Trigger | Split payment decrements once | Two `sales` sharing a `Ref:`, one item set; assert exactly one `sale` movement |
| Trigger | Clamped oversell round-trip | Stock 3 → sell 5 → delete → assert 3 (not 5), and one `sale` + one `sale_reversal` |
| Trigger | Reversal survives the cascade | `DELETE FROM sales` (not from `sale_items`); assert the reversal movement exists |
| RPC | Admin-only + cross-store branch rejected | Call as employee → exception; call with a foreign branch → exception |
| Import | Reference file end-to-end | Expected creates/categories/movements; `#VALUE!` cell never touched; re-import with IDs updates and **adds** stock |
| Import | Preview equals commit | Compare preview counts against post-commit row counts |
| Export | Round-trip | Export → re-import unmodified → 0 creates, 0 new categories, every row matched |
| Label | Scanner validation | Print one label; scan with a real EAN-8 scanner; batch-print ≥3 in one job |
| Build | Type safety + advisors | `npm run build`; `get_advisors(security)` — no `rls_disabled_in_public`, no `function_search_path_mutable` |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. One untrusted-input note that is not a matrix row: the
importer parses an admin-supplied `.xlsx` **client-side only**, and every write goes through
RLS as that admin, so a malicious file cannot exceed what the admin could already do by
hand. Export writes every cell as a string value (never a formula object), so a product name
beginning with `=` round-trips as text rather than becoming a live formula.

## Migration / Rollout

Section 15 is additive and re-runnable (`IF NOT EXISTS` / `CREATE OR REPLACE` /
`DROP … IF EXISTS`). Order:

1. **Pre-apply probes** on the target database, before any DDL:
   `select count(*) from public.products;` (expected 0) and
   `select barcode, count(*) from public.products where barcode is not null group by 1
   having count(*) > 1;` (expected empty — the old index allowed the same code in two
   stores, which the new global index would reject).
2. Apply 15.1 → 15.10 on the **development branch**.
3. `get_advisors(security)`; then the RLS/trigger/RPC probes above.
4. If a `select` on either new table errors instead of returning zero rows, the Data API
   grants in 15.10 are the fix (RLS is already on, so no grant widens row access).
5. App PR(s) → `npm run build` → merge the branch to production → re-run `get_advisors`.

The SQL can ship ahead of the UI safely: with `products` empty, no `sale_items` row can
resolve a `product_id`, so the triggers stay inert until the importer creates real products.

**Review budget**: SQL + 3 new components + the `StockView` rework is well past 400 lines.
`sdd-tasks` must slice it as (1) section 15 + codes, (2) `StockView` per-branch stock +
adjustment + movements, (3) `ProductLabel` + printing, (4) import/export. Slice 1 is a
prerequisite for 2–4; 3 and 4 are independent of each other.

## Open Questions

- [ ] **`exceljs` registry recency and browser-bundle behaviour under Next 16 / Turbopack.**
      Not verifiable in this session (no network tool). Closed by the preflight commands in
      the library decision, before any importer UI work starts. Fallback is documented.
- [ ] **`jsbarcode` bundled type declarations.** If `npm run build` reports missing types,
      add `@types/jsbarcode` as a devDependency; no design impact either way.
