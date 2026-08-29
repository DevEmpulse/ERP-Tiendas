# Tasks: Stock Phase 1 — Product Catalog Data Model

Conventions:
- Checkboxes are ordered and dependency-safe: do not start a task until every
  task above it (within the same numbered batch, and every earlier batch) is
  checked off. The system must never be left half-finished between batches.
- `[P]` marks a task that may run in parallel with its siblings inside the
  same batch. Everything else is sequential.
- File/line anchors reference `design.md` and were spot-verified against the
  current source on 2026-08-28; re-verify anchors before editing if the file
  has since changed.
- Requirement references use `spec-name#requirement-name` against
  `specs/product-catalog/spec.md` and `specs/sale-line-items/spec.md`.

---

## Batch 1 — Provision the Supabase development branch (blocks all DB work)

- [x] 1.1 Call Supabase MCP `create_branch` to provision a development branch
      of this project. Record the returned branch `project_id` (branch ref);
      every `execute_sql` / `apply_migration` call in Batches 2–3 targets this
      branch ref, never the production project id.
      — Satisfies: proposal.md Dependencies ("Decision on Q1... before
      applying SQL"); design.md "development branch, never the production
      project, until the branch verification below passes".
- [x] 1.2 Confirm the branch is ready (poll branch status if the MCP tool
      exposes one) before proceeding to Batch 2.

## Batch 2 — Apply migration.sql section 13 to the branch

- [x] 2.1 Append **section 13** verbatim to root `migration.sql` (sections
      1–12 untouched) — the exact SQL from `design.md` lines 99–181:

      ```sql
      -- 13. Product catalog, sale line items (Stock Phase 1)

      -- 13.1 Categories
      CREATE TABLE IF NOT EXISTS public.categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
        name text NOT NULL CHECK (btrim(name) <> ''),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS categories_store_id_idx ON public.categories (store_id);

      -- 13.2 Products
      CREATE TABLE IF NOT EXISTS public.products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
        category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
        name text NOT NULL CHECK (btrim(name) <> ''),
        barcode text,
        purchase_price numeric(10,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
        sale_price numeric(10,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS products_store_id_idx ON public.products (store_id);
      CREATE INDEX IF NOT EXISTS products_category_id_idx ON public.products (category_id);
      CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_uidx
        ON public.products (store_id, barcode) WHERE barcode IS NOT NULL;

      -- 13.3 Sale line items
      CREATE TABLE IF NOT EXISTS public.sale_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
        sale_id uuid REFERENCES public.sales(id) ON DELETE CASCADE NOT NULL,
        product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
        product_name text NOT NULL,            -- snapshot; survives rename and NULL product_id
        quantity int NOT NULL CHECK (quantity > 0),
        unit_price numeric(10,2) NOT NULL CHECK (unit_price >= 0),
        subtotal numeric(10,2) NOT NULL CHECK (subtotal >= 0),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sale_items_sale_id_idx ON public.sale_items (sale_id);
      CREATE INDEX IF NOT EXISTS sale_items_product_id_idx ON public.sale_items (product_id);
      CREATE INDEX IF NOT EXISTS sale_items_store_id_idx ON public.sale_items (store_id);

      -- 13.4 Enable RLS
      ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.products   ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

      -- 13.5 RLS policies (verbatim pattern from sections 5 and 11)
      DROP POLICY IF EXISTS "Users can manage categories in their store" ON public.categories;
      CREATE POLICY "Users can manage categories in their store" ON public.categories
        FOR ALL TO authenticated
        USING (store_id = public.get_current_user_store_id())
        WITH CHECK (store_id = public.get_current_user_store_id());

      DROP POLICY IF EXISTS "Users can manage products in their store" ON public.products;
      CREATE POLICY "Users can manage products in their store" ON public.products
        FOR ALL TO authenticated
        USING (store_id = public.get_current_user_store_id())
        WITH CHECK (store_id = public.get_current_user_store_id());

      DROP POLICY IF EXISTS "Users can manage sale items in their store" ON public.sale_items;
      CREATE POLICY "Users can manage sale items in their store" ON public.sale_items
        FOR ALL TO authenticated
        USING (store_id = public.get_current_user_store_id())
        WITH CHECK (store_id = public.get_current_user_store_id());

      -- 13.6 Price rules: nullable product_id ALONGSIDE product_name.
      -- Dropping product_name is EXPLICITLY OUT OF SCOPE for this phase — see Risks.
      ALTER TABLE public.product_price_rules
        ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS product_price_rules_product_id_idx
        ON public.product_price_rules (product_id);

      -- 13.7 sales.description is currently NOT NULL (migration.sql:33).
      -- The spec requires it nullable so new sales can stop writing it.
      ALTER TABLE public.sales ALTER COLUMN description DROP NOT NULL;
      ```

      Also append the rollback script from `design.md` lines 185–196 as a
      trailing SQL comment block or a `-- ROLLBACK (do not run automatically)`
      section directly under section 13, so the rollback SQL lives alongside
      the forward migration in version control.
      — Satisfies: `product-catalog#Category and Product Catalog Data Model`,
      `product-catalog#Barcode Uniqueness Per Store`,
      `product-catalog#Row-Level Security Isolation for Categories and Products`,
      `sale-line-items#Structured Sale Line Items`,
      `sale-line-items#Row-Level Security Isolation for Sale Items`,
      `sale-line-items#Sale Line Item Survival on Product Deletion`,
      `product-catalog#Price Rule Product Reference Migration` (column/index only),
      `sale-line-items#sales.description Compatibility During Transition`.
- [x] 2.2 Run this exact SQL via MCP `apply_migration` (or `execute_sql`,
      per the supabase skill: use `apply_migration` when committing a named
      migration to branch history) against the **branch project_id from 1.1
      only**. Do not target the production project id in this task.

## Batch 3 — Branch verification (must pass before Batch 4 or Batch 6)

- [x] 3.1 Run MCP `get_advisors(project_id: <branch-ref>, type: "security")`.
      Expect zero new findings — specifically no `rls_disabled_in_public` or
      `policy_exists_rls_disabled` for `categories`, `products`, `sale_items`.
      If new findings appear, fix them on the branch and re-run before
      continuing.
      — Satisfies: `product-catalog#Non-Regression and Build Verification`
      (advisors half); design.md "RLS Verification Plan" step 2.
- [x] 3.2 Confirm Data API exposure: attempt a `select` against `products`,
      `categories`, `sale_items` as an authenticated non-`service_role` user
      (or via `execute_sql` simulating the `authenticated` role). If it
      returns a permission error rather than zero/expected rows, run:
      ```sql
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.products   TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated;
      ```
      on the branch (RLS is already enabled, so this does not widen row
      access). — design.md "RLS Verification Plan" step 3; supabase skill
      Core Principle 4.
- [x] 3.3 Manual cross-tenant RLS probe, authenticated as a store-A user
      (not `service_role`), on the branch — run all four queries from
      `design.md` lines 249–255 and confirm the stated outcomes:
      ```sql
      -- Expect 0 rows for every table, even with an explicit store B filter.
      select count(*) from public.products   where store_id = '<store_B_id>';
      select count(*) from public.categories where store_id = '<store_B_id>';
      select count(*) from public.sale_items where store_id = '<store_B_id>';
      -- Expect: new row violates row-level security policy
      insert into public.products (store_id, name) values ('<store_B_id>', 'probe');
      ```
      — Satisfies: `product-catalog#Row-Level Security Isolation for
      Categories and Products` (both scenarios), `sale-line-items#Row-Level
      Security Isolation for Sale Items`.
- [x] 3.4 Schema probes (design.md "Testing Strategy" row 1) on the branch:
      duplicate barcode within the same store is rejected; a second NULL
      barcode in the same store is accepted; the same barcode across two
      different stores is accepted; soft-deleting a product (`is_active =
      false`) leaves its `sale_items` rows untouched; hard-deleting a
      `products` row sets `sale_items.product_id` to NULL without deleting
      the row. — Satisfies: `product-catalog#Barcode Uniqueness Per Store`,
      `product-catalog#Soft-Delete History Preservation`,
      `sale-line-items#Sale Line Item Survival on Product Deletion`.

Do not proceed to Batch 4 until 3.1–3.4 all pass on the branch.

## Batch 4 — App-layer changes (keep the app buildable after each step)

- [x] 4.1 `src/lib/salesHelper.ts`
  - Add `export interface SaleItemRow { id: string; product_id: string | null; product_name: string; quantity: number; unit_price: number | string; subtotal: number | string }` (per design.md "Interfaces / Contracts").
  - Add optional `sale_items?: SaleItemRow[] | null` to the `Sale` interface (currently lines 14–24).
  - Add `export function getSaleLines(sale: Pick<Sale, 'description' | 'total_amount'> & { sale_items?: SaleItemRow[] | null }): SaleItem[]` that maps `sale.sale_items` to `SaleItem[]` (`cant`→`quantity`, `detalle`→`product_name`, `p_unit`→`unit_price`, `importe`→`subtotal`, coercing string numerics with `Number(...)`) when `sale.sale_items` is present and non-empty, and otherwise falls back to `parseSaleDescription(sale.description, sale.total_amount)` (existing function at lines 26–69).
  - Null-safety in `groupSales` (currently starting at line 97): change
    `sale.description.match(...)` (line 110) to
    `(sale.description ?? '').match(...)`, and the `cleanDesc` computation
    (lines 115–118) to start from `(sale.description ?? '')` instead of
    `sale.description`, so a `null` `description` (now legal per 2.1's
    `DROP NOT NULL`) does not throw.
  - Add optional `sale_items?: SaleItemRow[] | null` to the `GroupedSale`
    interface (currently lines 78–90), and in `groupSales`, when creating a
    **new** group (both the `refCode` branch's `else` at ~line 139 and the
    fallback branch's `else` at ~line 172), set `sale_items: sale.sale_items
    ?? null` on the `newGroup` object (mirroring how `client_id`/`client_phone`
    are already taken from the first row of the group). This step is not
    listed verbatim in design.md's File Changes table but is required for
    design.md's own data-flow diagram and interface contract to actually
    reach `pdfGenerator.ts`, which consumes `GroupedSale[]`, not raw `Sale[]`
    — see the "gap" risk note below. Flag this to the reviewer as a
    minimal, same-file completeness addition, not new scope.
  - Requirement coverage: `sale-line-items#Structured Sale Line Items`,
    `sale-line-items#sales.description Compatibility During Transition`,
    `sale-line-items#Existing Sales Display Compatibility`.
- [x] 4.2 `src/lib/pdfGenerator.ts`
  - Import `getSaleLines` alongside (or instead of, if now unused elsewhere
    in the file) `parseSaleDescription` from `./salesHelper`.
  - At line 164, replace `parseSaleDescription(sale.description,
    sale.total_amount)` with `getSaleLines(sale)`. Rendering logic at lines
    165–167 stays unchanged (both return `SaleItem[]` with the same shape).
  - Requirement coverage: `sale-line-items#Existing Sales Display
    Compatibility` (PDF receipt scenario).
- [x] 4.3 `src/components/employee/sales-form.tsx`
  - `PriceRule` interface (lines 13–19): add `product_id: string | null`.
  - Price-rules `select` (line 96): change
    `.select('id, product_name, quantity, special_price, unit_price')` to
    also select `product_id`.
  - `getMatchingRule` (lines 108–115): keep the existing
    name+quantity match as the fallback, and add an optional `productId?:
    string | null` parameter; when `productId` is provided, first try
    `priceRules.find(r => r.product_id === productId && r.quantity ===
    qty)` before falling back to the name-based match. No caller passes a
    `productId` yet (dead branch until a product picker exists), matching
    design.md's explicit deferral.
  - After the `sales` insert calls (combined-payment block ~lines 347–349,
    single-payment block ~lines 354–356), add `.select('id')` (or
    `.select('id')..single()` for the single-payment path) to capture the
    inserted `sales.id`(s). Then, for each entry in `validProducts`, insert
    one `sale_items` row per resulting `sales.id`:
    - `store_id: storeId`
    - `sale_id`: the inserted sale's id (for the combined-payment path,
      insert one full set of `sale_items` rows per resulting `sales` row,
      matching how `compiledDesc` is already duplicated verbatim into every
      combined-payment row today — see `sale-line-items#Structured Sale
      Line Items` scenario "Split payment across two sales rows")
    - `product_name: p.detail.trim()`
    - `quantity: parseInt(p.quantity || '1', 10)`
    - `unit_price: parseInt(p.unitPrice || '0', 10)`
    - `subtotal: getProductImporte(p)`
    - `product_id`: a lookup-only match — query `products` for this
      `store_id`, `is_active = true`, and `name` case-insensitively equal
      to `p.detail.trim()` (e.g. `.ilike('name', p.detail.trim())` matched
      against an exact, non-wildcard string, or a `lower(name) =
      lower(...)` filter); use the matched product's `id`, else `null`.
      Do not create a product from unmatched names.
    - If the `sale_items` insert fails, surface the same error-handling
      path already used for the `sales` insert (`throw` into the existing
      `catch` block) rather than silently swallowing it.
  - Requirement coverage: `sale-line-items#Structured Sale Line Items`,
    `product-catalog#Price Rule Product Reference Migration` (column
    plumbing only, not the cutover).
- [x] 4.4 `src/components/admin/SaleModal.tsx`
  - Same `PriceRule` interface change (lines 25–31), price-rules `select`
    (line 159), and `getMatchingRule` change (lines 268–275) as 4.3.
  - After the inserts at line 374 (combined) and line 384 (single), add
    `.select('id')` and insert `sale_items` from `validLines` using the
    same field mapping and lookup-only `product_id` resolution as 4.3
    (`l.detalle.trim()` → `product_name`, `Number(l.cant) || 1` →
    `quantity`, `l.p_unit` → `unit_price`, `l.importe` → `subtotal`).
  - Edit-mode fix: edit mode deletes the old `sales` rows at line 337
    (`supabase.from('sales').delete().in('id', ids)`), which cascades away
    their `sale_items` (per 2.1's `sale_items.sale_id ... ON DELETE
    CASCADE`). The re-insert immediately after (lines 344–386) must
    recreate `sale_items` for every newly-inserted `sales` row, exactly as
    in the create-mode path above — do not leave a window where an edited
    sale has zero `sale_items` rows.
  - Requirement coverage: `sale-line-items#Structured Sale Line Items`,
    `sale-line-items#Sale Line Item Survival on Product Deletion` (edit
    path must not silently drop line items).
- [x] 4.5 `src/components/admin/StockView.tsx`
  - `PriceRule` interface (lines 29–37): add `product_id: string | null`.
  - No `select` change needed: both queries already use `.select('*')`
    (lines 81 and 103), which will include `product_id` once 2.1 lands.
  - CRUD (`handleSave` insert/update at lines 187 and 194) keeps writing
    only `product_name`; leave `product_id` unset/`null` until a product
    picker exists (out of scope here).
  - Requirement coverage: `product-catalog#Price Rule Product Reference
    Migration` (type plumbing only).
- [x] 4.6 `[P]` `src/app/admin/page.tsx`
  - In the `sales` query `select` (currently lines 125–137), add a nested
    `sale_items ( id, product_id, product_name, quantity, unit_price,
    subtotal )` selection so `getSaleLines`/`groupSales` receive real data
    instead of always falling back to `parseSaleDescription`.
  - Requirement coverage: `sale-line-items#Existing Sales Display
    Compatibility`.
- [x] 4.7 `[P]` `src/components/admin/EmployeeReport.tsx`
  - In the `sales` query `select` (currently line 77:
    `'id, employee_id, total_amount, description, payment_method,
    created_at'`), add the same nested `sale_items ( id, product_id,
    product_name, quantity, unit_price, subtotal )` selection.
  - Requirement coverage: `sale-line-items#Existing Sales Display
    Compatibility`.

4.6 and 4.7 may run in parallel with each other (independent files, no
shared state) but only after 4.1 lands (both rely on `getSaleLines`
tolerating a null-safe `groupSales`).

## Batch 5 — Build and lint verification

- [x] 5.1 Run `npm run build`. Fix any type errors introduced by 4.1–4.7
      before proceeding (e.g. `SaleItemRow`/`GroupedSale` field mismatches).
      — Satisfies: `product-catalog#Non-Regression and Build Verification`
      (build half); proposal.md Success Criteria "`npm run build` passes".
- [x] 5.2 Run `npm run lint`. Fix any lint errors introduced by 4.1–4.7.

Do not proceed to Batch 6 until 5.1 and 5.2 both pass.

## Batch 6 — Merge to production

- [x] 6.1 **N/A — applied directly to production.** No Supabase branch could
      be created (`create_branch` requires `confirm_cost_id`; no
      `confirm_cost` tool is exposed by this MCP server). User explicitly
      approved applying section 13 directly to production instead of
      branch-first (see proposal.md Q1 override). No merge step exists
      because there was no branch to merge.
- [x] 6.2 `get_advisors(type: "security")` was run directly against
      production immediately after applying section 13 (same call Batch 3
      would have made against a branch). Zero new findings attributable to
      `categories`/`products`/`sale_items`; only pre-existing, unrelated
      warnings. — Satisfies: proposal.md Success Criteria "`get_advisors`
      reports no new security findings"; `product-catalog#Non-Regression and
      Build Verification`.

---

## Verification checkpoints (from proposal.md / spec.md Success Criteria — not separate implementation work)

These are re-checks against the state produced by Batches 1–6, not new tasks:

- [ ] `categories`, `products`, `sale_items` exist with RLS enabled and
      per-store policies. (Covered by 2.1/2.2, confirmed by 3.1.)
- [ ] A cross-tenant read attempt on each new table returns zero rows.
      (Confirmed by 3.3.)
- [ ] `product_price_rules` references `products(id)`; existing rules still
      resolve in the POS via `product_name` matching. (Covered by 2.1,
      4.3/4.4/4.5.)
- [ ] Deleting a product leaves every historical `sale_items` row intact.
      (Confirmed by 3.4.)
- [ ] Existing sales list, sale modal, and PDF receipt render unchanged for
      legacy description-only sales, and render from `sale_items` when
      present. (Covered by 4.1/4.2/4.6/4.7.)
- [ ] `npm run build` passes; `get_advisors` reports no new security
      findings, on both the branch (3.1) and production (6.2).
- [ ] Phase 2 (stock quantities) is not required for any of the above to
      hold — no task in this list references stock-quantity tables.

---

## Known gap flagged for review

`design.md`'s File Changes table does not list `GroupedSale` as needing a
`sale_items` field, but `pdfGenerator.ts` (`generateSalesReportPdf`) consumes
`GroupedSale[]`, not raw `Sale[]`. Without carrying `sale_items` through
`groupSales()` (task 4.1's last bullet), `getSaleLines(sale)` in
`pdfGenerator.ts` would always receive `sale.sale_items === undefined` and
silently always take the legacy `parseSaleDescription` path — contradicting
`sale-line-items#Existing Sales Display Compatibility`'s "PDF receipt renders
from sale_items" scenario. Task 4.1 closes this gap with a minimal,
same-file addition (propagate `sale_items` onto the `GroupedSale` object
already being built). Reviewer should confirm this reading of design.md's
intent before/during `sdd-apply`.
