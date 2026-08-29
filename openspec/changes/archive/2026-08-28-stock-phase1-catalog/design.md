# Design: Stock Phase 1 — Product Catalog Data Model

## Technical Approach

Append a single additive **section 13** to root `migration.sql` (sections 1–12 are
never rewritten). Order inside the section is dependency-first so any interruption
leaves a working system: `categories` → `products` → indexes → RLS → `sale_items`
→ `product_price_rules.product_id` → `sales.description` nullability. Every new
table is tenant-scoped by a denormalized `store_id` and carries the verbatim
`store_id = public.get_current_user_store_id()` policy pattern from `clients`
(`migration.sql:91-95`) and `product_price_rules` (`migration.sql:434-437`).

All `apply_migration` / `execute_sql` calls in the next phase target the **Supabase
development branch**, never the production project, until the branch verification
below passes (proposal Q1).

## Architecture Decisions

### Decision: `sale_items.sale_id` uses `ON DELETE CASCADE`

**Choice**: `references public.sales(id) on delete cascade`.
**Alternatives considered**: `RESTRICT`; relying on "sales are never deleted".
**Rationale**: The premise that sales history is never deleted is **false in this
codebase**. Two live paths hard-delete `sales` rows:
`src/components/admin/SalesTable.tsx:99-102` (`.from('sales').delete().in('id', …)`)
and `src/components/admin/SaleModal.tsx:337` (edit mode deletes the old rows, then
re-inserts). `RESTRICT` would make both admin delete and admin edit fail the moment
any sale has line items. `CASCADE` is the only option that keeps existing behavior
working. Preserve-history is enforced at the **product** edge (soft-delete), not the
sale edge.

### Decision: `sale_items.product_id` is nullable with `ON DELETE SET NULL`, plus a `product_name` snapshot

**Choice**: `product_id uuid references public.products(id) on delete set null` (nullable)
and an additional `product_name text not null` snapshot column.
**Alternatives considered**: `NOT NULL` + `RESTRICT` relying purely on soft-delete;
omitting the name snapshot.
**Rationale**: Two independent reasons. (1) Defensive depth — soft-delete is an
application convention with nothing in the schema enforcing it; a future admin tool
or manual `delete` would otherwise destroy history, which `openspec/config.yaml`
(`apply.guidelines`) forbids. (2) Phase 1 has **no product picker UI**, so most lines
cannot resolve to a product id at all (see Risks). A nullable `product_id` plus a
name snapshot lets `sale_items` be populated and rendered today, and lets `product_id`
fill in progressively once Phase 4 ships a picker. The snapshot also keeps historical
receipts correct after a product is renamed.

### Decision: `subtotal` is a plain stored column, not `GENERATED … (quantity * unit_price)`

**Choice**: `subtotal numeric(10,2) not null`.
**Alternatives considered**: generated stored column.
**Rationale**: `subtotal ≠ quantity × unit_price` by design. Both POS surfaces let the
user override the line total directly (`sales-form.tsx:164-172`, `SaleModal.tsx:241-247`),
and applying a price rule sets `importe = special_price` independently of `unit_price`
(`sales-form.tsx:180-192`). A generated column would silently rewrite those amounts.

### Decision: partial unique index on barcode — but not for the reason usually given

**Choice**: `create unique index … on public.products (store_id, barcode) where barcode is not null;`
**Alternatives considered**: table-level `unique (store_id, barcode)`.
**Rationale**: Verified, and the common justification is wrong: a plain `UNIQUE
(store_id, barcode)` **already** permits unlimited NULL barcodes, because Postgres
treats NULLs as distinct in unique indexes by default (`NULLS DISTINCT`; only PG15+
`NULLS NOT DISTINCT` changes that). So multiple NULLs are not the deciding factor.
The partial index still wins on two grounds: barcode is optional and most rows will
have none, so the partial index stores only the barcoded subset; and the `where`
clause states the intent explicitly, so a later `NULLS NOT DISTINCT` edit cannot
silently forbid a second barcode-less product.

### Decision: denormalize `store_id` onto `sale_items`

**Choice**: `store_id uuid … not null` on `sale_items`, policy identical to `clients`.
**Alternatives considered**: RLS policy via `exists (select 1 from sales …)`.
**Rationale**: Keeps every tenant policy in the repo textually identical (one pattern
to audit), and avoids a correlated subquery on every row of every sale-item read.
Cost is one redundant column plus a consistency check tying it to the parent sale.

### Decision: `text` with no length caps

**Choice**: bare `text` for `name` / `barcode`, plus a non-empty check on `name`.
**Alternatives considered**: `varchar(n)`.
**Rationale**: Sections 1–12 use bare `text` for every string column with zero length
caps. Following the existing convention beats a generic best practice here.

## Data Flow

    sales-form.tsx ──insert sales──→ sales ──id──→ insert sale_items (product_id NULL
         │                                          unless an exact active-product
         │                                          name match already exists)
         └── price rules ──name match──→ product_price_rules (product_id column exists,
                                          unused until a picker exists)

    admin/page.tsx ──select sales + sale_items──→ salesHelper.getSaleLines(sale)
                                                    ├─ sale_items present → structured
                                                    └─ else → parseSaleDescription()
                                                          └──→ pdfGenerator

## Forward SQL — `migration.sql` section 13

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

## Rollback SQL

```sql
-- Reverse of section 13. Run top to bottom.
ALTER TABLE public.sales ALTER COLUMN description SET NOT NULL;  -- only if no NULLs exist
DROP INDEX IF EXISTS public.product_price_rules_product_id_idx;
ALTER TABLE public.product_price_rules DROP COLUMN IF EXISTS product_id;
DROP TABLE IF EXISTS public.sale_items CASCADE;
DROP TABLE IF EXISTS public.products   CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
```

`product_name` is never dropped, so no restore step is needed. If any `sales.description`
is NULL at rollback time, `SET NOT NULL` fails — backfill `''` first or skip that line.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `migration.sql` | Modify | Append section 13 above; sections 1–12 untouched |
| `src/lib/salesHelper.ts` | Modify | Add `SaleItemRow` type + optional `sale_items?: SaleItemRow[]` on `Sale`; add `getSaleLines(sale)` that maps `sale_items` → `SaleItem[]` and falls back to `parseSaleDescription` (`:26-69`) when absent. `groupSales` (`:97`) must tolerate `description` being null: `sale.description.match(…)` at `:110` and `.replace` at `:115` need `(sale.description ?? '')` |
| `src/lib/pdfGenerator.ts` | Modify | `:164` swap `parseSaleDescription(sale.description, sale.total_amount)` for `getSaleLines(sale)`; rendering at `:165-167` is unchanged |
| `src/components/employee/sales-form.tsx` | Modify | `PriceRule` (`:13-19`) gains `product_id: string \| null`; select at `:96` adds `product_id`; `getMatchingRule` (`:108-115`) keeps name matching but gains a `product_id`-first branch (dead until a picker exists). After the `sales` insert (`:347-365`), `.select('id')` the inserted rows and insert one `sale_items` row per `validProducts` entry: `product_name` = `p.detail.trim()`, `quantity`, `unit_price`, `subtotal = getProductImporte(p)`, `product_id` = lookup-only match on an active product with the same lowercased name, else NULL |
| `src/components/admin/SaleModal.tsx` | Modify | Same `PriceRule`/select/`getMatchingRule` change (`:25-31`, `:159`, `:268-275`); after the inserts at `:374`/`:384`, write `sale_items` from `validLines`. Edit mode deletes the old sales rows at `:337`, which cascades their `sale_items` away — the re-insert must recreate them |
| `src/components/admin/StockView.tsx` | Modify | `PriceRule` (`:29-37`) gains `product_id: string \| null`; `select('*')` at `:80`/`:104` already returns it; CRUD (`:187`, `:194`) keeps writing `product_name` and leaves `product_id` NULL until a product picker exists |

## Interfaces / Contracts

```ts
// src/lib/salesHelper.ts
export interface SaleItemRow {
  id: string
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number | string
  subtotal: number | string
}

// Prefers structured lines; falls back to the legacy description parser.
export function getSaleLines(sale: Pick<Sale, 'description' | 'total_amount'> & {
  sale_items?: SaleItemRow[] | null
}): SaleItem[]
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Schema | Constraints, FK actions, partial unique index | `execute_sql` probes on the branch: duplicate barcode rejected, second NULL barcode accepted, same barcode across stores accepted, soft-deleting a product leaves `sale_items` rows intact with `product_id` set NULL on hard delete |
| Security | Tenant isolation | `get_advisors` + manual cross-tenant probe (below) |
| Unit | `getSaleLines` dual path | No test runner is configured (`openspec/config.yaml` → `test_command: ""`); verify manually against one sale with `sale_items` and one legacy description-only sale |
| Build | Type safety | `npm run build` (the configured `verify.build_command`) |

## RLS Verification Plan (development branch, before merging to production)

1. Apply section 13 to the **development branch** only.
2. `get_advisors(project_id: <branch-ref>, type: "security")` — expect zero new
   findings; specifically no `rls_disabled_in_public` or `policy_exists_rls_disabled`
   for `categories`, `products`, `sale_items`.
3. Confirm Data API reachability: newly SQL-created tables are not always exposed to
   `anon`/`authenticated`. If a `select` from the app returns a permission error rather
   than zero rows, add explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table>
   TO authenticated;` — RLS is already enabled, so the grant does not widen row access.
4. Manual cross-tenant probe, authenticated as a store-A user (not `service_role`):
   ```sql
   -- Expect 0 rows for every table, even with an explicit store B filter.
   select count(*) from public.products   where store_id = '<store_B_id>';
   select count(*) from public.categories where store_id = '<store_B_id>';
   select count(*) from public.sale_items where store_id = '<store_B_id>';
   -- Expect: new row violates row-level security policy
   insert into public.products (store_id, name) values ('<store_B_id>', 'probe');
   ```
5. Only after 2–4 pass, merge the branch to production and re-run `get_advisors` there.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary. The security surface here is
tenant isolation, covered by the RLS verification plan above.

## Migration / Rollout

Section 13 is additive and idempotent (`IF NOT EXISTS` / `DROP POLICY IF EXISTS`),
so it is safe to re-run and safe to interrupt: each numbered sub-step only depends on
earlier ones. No backfill is required — all three new tables start empty and
`product_price_rules.product_id` starts NULL for every existing row, which the
name-matching call sites already ignore. Rollout order: branch apply → advisors →
cross-tenant probe → app-layer PR → `npm run build` → merge branch to production.

## Open Questions

- [ ] **How does `sale_items.product_id` get populated with no product picker?** The
      design's answer is lookup-only (exact case-insensitive match against an active
      product, else NULL) plus a `product_name` snapshot. The rejected alternative was
      "resolve or create product by name", which would fill the catalog with typos and
      one-off services and hand Phase 2 stock a polluted catalog. Confirm this is
      acceptable, or promote a product picker into Phase 1 (Phase 4 scope).
- [ ] **The price-rule name→id cutover cannot complete in Phase 1.** There is no UI to
      create a product or attach one to a rule, so all three call sites must keep
      matching by `product_name`. The column and index ship now; the behavioral
      requirement "rule resolves by `product_id`" lands with the picker.
- [ ] **Reading `sale_items` requires files outside the stated scope.** The sales query
      lives at `src/app/admin/page.tsx:125-137` and `src/components/admin/EmployeeReport.tsx:77`;
      both must add `sale_items(...)` to their `select` or `getSaleLines` will always
      take the legacy path. Confirm these two files may be touched.
