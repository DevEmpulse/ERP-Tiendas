# Exploration: Stock Phase 2 — Quantities and Movements

## Current State

Phase 1 (archived `2026-08-28-stock-phase1-catalog`) shipped `categories`, `products`,
`sale_items`, and `product_price_rules.product_id` (schema live in `migration.sql`
section 13, lines 444-523) — data model only, verified identical to the archived
`design.md` forward SQL. Three facts from that phase directly bound Phase 2's scope:

1. **No product management UI exists.** Grep across `src/` for `.from('products')` /
   `.from('categories')` finds only two call sites — `src/components/employee/sales-form.tsx:320`
   and `src/components/admin/SaleModal.tsx:357` — and both are read-only
   `SELECT id, name ... WHERE is_active = true`, used solely to resolve
   `sale_items.product_id` by case-insensitive name match. There is no `INSERT`/`UPDATE`
   into `products` anywhere in the app. `products` is empty in every store today and has
   no way to become non-empty except direct SQL.
2. **`StockView.tsx` manages price rules, not products or stock.** The entire component
   (`src/components/admin/StockView.tsx`) is a CRUD screen for `product_price_rules`
   (name, quantity, special price, unit price). It has zero fields for category, barcode,
   purchase/sale price, or any stock concept — those `products` columns exist in the
   schema but nothing in the UI touches them.
3. **`sale_items.product_id` resolution is lookup-only and silently nullable.** Both
   `sales-form.tsx:316-338` and `SaleModal.tsx:353-375` build a
   `Map<lowercased-name, product-id>` from active products and fall back to `null` on any
   non-exact match. Since `products` is empty today, every `sale_items.product_id`
   currently written is `null`.

Combined, these three facts mean: if Phase 2 only adds `stock_quantity`/`stock_movements`
schema, it ships an invisible, untestable-in-the-UI feature — there is no way for a real
user to create a product, see its stock, or trigger a decrement, because nothing ever
populates `products` or resolves a non-null `product_id`. This is the single most
important scoping fact for Phase 2.

Sale creation/edit/delete flow (relevant to decrement/reversal):

- **Create**: `sales-form.tsx` (employee POS) and `SaleModal.tsx` (admin, `!isEditMode`)
  each insert `sales` row(s), then insert matching `sale_items` rows referencing them.
  Combined payments produce N `sales` rows sharing one `Ref:` token, and Phase 1
  deliberately duplicates the full item set into `sale_items` for each of those N rows
  (`design.md` data-flow diagram, `sales-form.tsx:387-389`), not once per logical
  transaction.
- **Edit**: `SaleModal.tsx:343-349` hard-deletes the old `sales` rows
  (`.from('sales').delete().in('id', ids)`), which `ON DELETE CASCADE` (schema line 479)
  removes their `sale_items` rows, then the same handler re-inserts fresh `sales` +
  `sale_items` rows (lines 407-431). Edit is delete-then-recreate, not a diff.
- **Delete**: `src/components/admin/SalesTable.tsx:98-104` hard-deletes `sales` rows
  directly, same cascade to `sale_items`.
- **No refund/return concept exists** (grep for `refund|devoluci|reembolso` under `src/`
  — zero matches).

Every one of the three call sites (`sales-form.tsx`, `SaleModal.tsx` create path,
`SaleModal.tsx` edit path via delete+recreate) — plus `SalesTable.tsx`'s bare delete —
touches `sale_items` rows, and all four need stock to move consistently. Encoding stock
decrement/reversal as **DB triggers on `sale_items` INSERT/DELETE** (rather than
application code in each UI file) collapses this into one enforcement point and
correctly handles the cascade-delete case for free, since Postgres fires row-level
triggers on cascade-deleted rows exactly as it would for a direct `DELETE`. This also
matches the codebase's existing convention of encoding invariants at the DB layer
(`on_auth_user_created`, `delete_employee_user()` triggers/functions) rather than
duplicating logic across UI components.

## Affected Areas

- `migration.sql` — new numbered section (14) for `stock_movements` table,
  `products.stock_quantity` column, RLS policies, and the `sale_items` INSERT/DELETE
  trigger functions that adjust stock atomically.
- `src/components/admin/StockView.tsx` — currently 100% price-rule CRUD with no
  product/stock UI at all; Phase 2 needs an explicit answer here (see Approaches below).
- `src/components/employee/sales-form.tsx` / `src/components/admin/SaleModal.tsx` — no
  code change needed for decrement itself if trigger-based, but both are the only writers
  of `sale_items.product_id`, and both hit the empty-`products`-table problem above.
- `src/components/admin/SalesTable.tsx` — hard `DELETE` on `sales` is a
  decrement-reversal trigger point (via cascade), not a call site needing new app code.
- `openspec/specs/product-catalog/spec.md` and `openspec/specs/sale-line-items/spec.md` —
  Phase 2 delta specs will add requirements to `product-catalog` (stock fields,
  movements) and reference `sale-line-items` (decrement-on-insert, reversal-on-delete)
  without modifying Phase 1's existing requirements.

## Approaches

1. **Schema-only stock tracking (no admin UI), verified by direct SQL** — Add
   `products.stock_quantity` (nullable int, NULL = untracked) + `stock_movements` ledger
   (append-only: `sale`/`manual_adjustment`/`restock` types, signed quantity delta,
   resulting balance, nullable `sale_item_id` FK, `store_id` denormalized with the
   verbatim `get_current_user_store_id()` RLS policy) + triggers on `sale_items`
   INSERT/DELETE that atomically decrement/restore `products.stock_quantity` and log a
   movement, skipping rows where `product_id IS NULL` or `stock_quantity IS NULL`.
   - Pros: Matches Phase 1's own "data model only, minimal UI" pattern exactly; keeps
     Phase 2 small and reviewable; fully verifiable via `execute_sql` probes and
     `get_advisors` without touching any `.tsx` file.
   - Cons: Ships a feature nobody can trigger in real use — `products` stays empty,
     `product_id` stays null on every `sale_items` row, so the trigger never fires
     outside manual SQL tests. Success criteria like "sale decrements stock" would only
     be provable synthetically, not against the real POS.
   - Effort: Low.

2. **Schema + minimal product/stock admin UI extending `StockView.tsx`** — Everything in
   Approach 1, plus a basic CRUD tab in `StockView.tsx` (or a sibling component) to
   create/edit a `products` row (name, category, prices, barcode, initial
   `stock_quantity`) and record manual stock adjustments (restock/correction) against
   `stock_movements`.
   - Pros: Makes Phase 2 actually testable and usable end-to-end today; gives Phase 4's
     product picker something real to pick from later; matches the Phase 2 title "stock
     quantities and movements" literally (movements need a way to be created manually,
     not only via sales).
   - Cons: Pulls UI work forward that Phase 1 explicitly deferred; risks scope creep
     toward Phase 4 ("new POS UI") if a sales-time picker is added here — must be drawn
     carefully: a plain admin catalog CRUD screen is not the same as the sales-entry
     picker Phase 4 owns, but the boundary needs an explicit decision in `sdd-propose`.
   - Effort: Medium.

3. **`stock_quantity` column only, no `stock_movements` ledger** — Skip the ledger table;
   just decrement/restore the column via trigger.
   - Pros: Simplest possible schema.
   - Cons: Directly contradicts the Phase 2 name ("movements") and the project's own
     RLS/audit conventions (every other tenant table gets an isolated auditable trail);
     no way to answer "why did stock change" later, which blocks Phase 7 (analytics) and
     Phase 3 (cash register reconciliation) from ever trusting the number. Rejected.
   - Effort: Low.

## Recommendation

**Approach 2** (schema + minimal admin product/stock UI), with the product/stock CRUD
screen scoped narrowly: create/edit a product's identity fields plus `stock_quantity`,
and a manual stock-adjustment action that writes to `stock_movements`. Explicitly exclude
from that UI: a sales-time product picker (stays Phase 4's "new POS UI"), barcode
scanning/rendering (Phase 6), and any cash-register or analytics view (Phase 3/7). This
is surfaced as an open question for the user before `sdd-propose` finalizes scope,
because it revises Phase 1's stated boundary ("no UI redesign here" was Phase 1's own
scope note, and Phase 2 inherits an empty catalog as a direct consequence).

Supporting technical decisions to carry into `sdd-design`:

- **Both column and ledger**: `products.stock_quantity int NULL` (NULL = not tracked,
  distinguishing service/free-text-style products from tracked inventory) for O(1)
  POS-time reads, plus `stock_movements` for audit trail — mirrors this codebase's
  existing pattern of denormalizing `store_id` everywhere for RLS simplicity (Phase 1
  `design.md` decision on `sale_items.store_id`) rather than computing balances from the
  ledger on every read.
- **Trigger-based decrement/reversal on `sale_items`**, not application code in
  `sales-form.tsx`/`SaleModal.tsx`/`SalesTable.tsx`, so all three UI writers and the
  cascade-delete edit path stay correct automatically. No `SECURITY DEFINER` needed: the
  trigger runs as the invoking authenticated user, who already has `FOR ALL` RLS access
  to `products` in their own store, avoiding the Supabase-flagged `SECURITY DEFINER`
  RLS-bypass trap.
- **Atomic decrement, never hard-block the sale**:
  `UPDATE products SET stock_quantity = GREATEST(stock_quantity - qty, 0) WHERE id = ...
  AND stock_quantity IS NOT NULL`, relying on Postgres's normal per-row lock for
  concurrency safety (no explicit `SELECT ... FOR UPDATE` needed for a single-row
  conditional `UPDATE`). Overselling is recorded, not blocked — clamp at zero and let the
  movement log the negative delta — because there is still no live stock visibility at
  sale-entry time (no picker until Phase 4); hard-blocking an insert based on an
  invisible number would silently stop a cashier mid-sale with no way to see why, which
  conflicts with this codebase's established priority of never breaking the register
  (same reasoning Phase 1 used to keep `sales.description` nullable and `subtotal` a
  plain column instead of computed).
- **Backfill**: no backfill needed — `products` has zero rows in every store today, same
  as Phase 1's own migration note. The semantic default going forward is NULL =
  untracked for any product created without an explicit stock value.

## Risks

- **Primary risk**: without some UI to create products (Approach 2's scope), Phase 2's
  schema is unreachable by real users and its own success criteria can't be demonstrated
  against the live POS — only against synthetic SQL. Must be resolved explicitly before
  `sdd-propose`, since it revises a Phase 1 scope decision.
- If Approach 2 is chosen, its product-CRUD UI could visually or functionally creep
  toward what Phase 4 ("new POS UI") is supposed to own (the sales-time picker) — the
  delta spec must state the boundary explicitly (admin catalog management vs.
  sales-entry picker) to prevent scope disputes at `sdd-verify`.
- Trigger-based stock adjustment on `sale_items` must be proven safe against the
  **combined-payment duplication pattern**: Phase 1 inserts the full item set once per
  resulting `sales` row for a split payment (N rows share one logical sale), so a naive
  trigger will decrement stock N times for what a customer perceives as one purchase of
  one item. Must be caught in `sdd-design` — it is a correctness bug, not just an edge
  case, and Phase 1's own `groupSales()` reconstruction logic proves this duplication is
  real and already relied upon elsewhere.
- RLS on `stock_movements` must be verified with the same cross-tenant probe methodology
  Phase 1 used (`get_advisors` + manual cross-tenant `SELECT`/`INSERT` probes on a
  development branch before merging to production), per this repo's Supabase
  development-branch convention (`design.md` Q1 resolution).
- `sale_items.product_id` will remain `null` for the vast majority of lines until Phase 4
  ships a picker (confirmed empty `products` table today), so stock decrement coverage is
  inherently partial in this phase — should be stated as an explicit, accepted limitation
  in the proposal, not discovered later in `sdd-verify`.

## Ready for Proposal

Yes, with one required decision point flagged for the user before `sdd-propose`
finalizes scope: **whether Phase 2 includes a minimal product/stock admin UI
(Approach 2) or ships schema-only (Approach 1)**. Recommendation is Approach 2, but this
is a real fork with meaningful tradeoffs, not a unilateral call.

## Key Learnings

1. Phase 1's `products` table has zero application write path — only two read-only
   lookup call sites exist, so it is empty in every store today.
2. `sale_items.product_id` is currently always null in practice because the
   case-insensitive name match has nothing to match against.
3. `SaleModal.tsx` edit mode is implemented as hard-delete-then-recreate of `sales`
   rows, cascading to `sale_items` — any stock trigger must handle this as a normal
   DELETE, not a special edit case.
4. Combined-payment sales duplicate the full `sale_items` set across N `sales` rows
   sharing one `Ref:` token, so a stock-decrement trigger on `sale_items` INSERT must
   not multiply the decrement per split-payment row.
5. This codebase consistently prioritizes never blocking the point-of-sale register
   over backend data rigor (nullable `sales.description`, non-generated `subtotal`),
   which should drive the oversell-handling decision in Phase 2.
