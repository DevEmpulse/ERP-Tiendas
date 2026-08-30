## Exploration: purchases-tracking

### Current State

**1. Cost/margin model (single scalar, no history)**
- `migration.sql:464-465` — `products.purchase_price numeric(10,2) NOT NULL DEFAULT 0` and `sale_price numeric(10,2) NOT NULL DEFAULT 0`. One row per product, one current cost. No history table, no versioning.
- **Written** in two places: `StockView.tsx:325-326,342-362` (`handleSaveProduct`, plain UPDATE/INSERT, silently overwrites prior cost) and `ProductImportDialog.tsx:365-370,383-389` (Excel import bulk upsert, same silent overwrite — column mapping confirmed in `docs/features.md:63`).
- **Read** in `analytics_product_ranking` (`migration.sql:2198-2227`, section 18.3):
  ```sql
  SUM(si.quantity * (p.sale_price - p.purchase_price))   -- margin_estimated
  SUM(si.subtotal - si.quantity * p.purchase_price)       -- margin_realized
  ```
  Joins historical `sale_items` against the CURRENT `products.purchase_price` — margin on a 3-month-old sale is recomputed using today's cost every time, with no point-in-time cost captured anywhere.

**2. Current stock-increase path**
- `adjust_branch_stock` RPC (`migration.sql:1278-1335`): `(p_branch_id, p_product_id, p_delta, p_reason DEFAULT 'manual_adjustment', p_note DEFAULT NULL) RETURNS int`. Role gate: `admin, superadmin, encargado, stock` (non-admin/superadmin restricted to own branch). Reason whitelist: `'manual_adjustment', 'restock', 'import_ingress'` only — `'sale'`/`'sale_reversal'` reserved for the trigger path. No cost field anywhere in this path. Callers: `StockAdjustDialog.tsx:101-107`, `ProductImportDialog.tsx:412-419`.
- **Structurally different path: how sales increase/decrease stock.** `apply_sale_item_stock()` (`migration.sql:919-968`) is an `AFTER INSERT/DELETE` trigger on `sale_items` — inserting a sale_items row atomically decrements `branch_stock` and writes a `stock_movements` row (`reason='sale'`) in the SAME transaction, no separate RPC call. `stock_movements.sale_item_id` links each ledger row back to the exact sale line. **This header+items+trigger pattern is what the user is asking to mirror for purchases**, not the RPC pattern.

**3. RLS/role patterns**
- `stock_movements` is Shape B: append-only (no UPDATE/DELETE policy, RLS default-denies both), SELECT/INSERT split, gated by `store_id = get_current_user_store_id() AND (role IN ('admin','superadmin') OR branch_id = get_current_user_branch_id())`.
- `src/lib/roles.ts:7,9` — `STOCK_ROLES = ['stock']`, `CATALOG_WRITE_ROLES = ['admin', 'superadmin', 'encargado']`. Asymmetry: `adjust_branch_stock`'s actual role check (admin/superadmin/encargado/stock) is BROADER than `CATALOG_WRITE_ROLES` (no `stock`) — the `stock` role can move quantities but cannot edit `purchase_price`/`sale_price` today. A purchase sets both quantity AND per-unit cost, so it doesn't cleanly fit either existing role set.

**4. Margin calculation impact** — see explicit fork below.

**5. Supplier concept**
- Confirmed via grep: zero supplier/proveedor schema or entity anywhere. Only hit: a placeholder string `"Pago a proveedor"` in `CashSessionPanel.tsx:403` (a free-text example inside a generic cash-movement note field — no FK, no table).
- Closest analog, `clients` (`migration.sql:21-27`): `id, store_id, name, phone, created_at` — deliberately minimal. A `suppliers` table could mirror this shape exactly if promoted later.

**6. UI home**
- `StockView.tsx:130` currently has exactly two tabs: `'productos' | 'precios'`. The tab-bar pattern (lines 1150-1172) is a simple button-array with local state — trivial to extend with a third `'compras'` tab.

**7. Reporting**
- `HistoryView.tsx` wraps `SalesHistory.tsx`, which owns a date-range filter with quick-pills (`today/7d/30d/month/custom`) plus a daily-grouped table — a directly reusable pattern for "list of dated records with a running total."

### Affected Areas

- `migration.sql` — new `purchases`/`purchase_items` tables, RLS policies (Shape B, mirroring `stock_movements`/`sale_items`), a new `apply_purchase_item_stock()` trigger, and an extended `stock_movements.reason` CHECK constraint + nullable `purchase_item_id` column.
- `src/lib/roles.ts` — needs an explicit new export (e.g. `PURCHASE_ROLES`) once the role question is resolved.
- `src/components/admin/StockView.tsx` — likely home for a new "Compras" tab.
- New component(s) for purchase entry (header: date/supplier/branch + repeatable line items: product/quantity/unit cost).
- `docs/database.md`, `docs/features.md` — new sections once implemented.
- `analytics_product_ranking` (`migration.sql:2198-2227`) — touched ONLY if the margin fork resolves to weighted-average or FIFO.

### Approaches — stock-increase mechanism

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| 1. RPC-orchestrated | Insert `purchases`/`purchase_items`, then loop calling existing `adjust_branch_stock(reason='restock')` per line | Reuses shipped/tested RPC; minimal new SQL | Not atomic (two round-trips); `stock_movements` gets no link back to the purchase line; doesn't match "mirror sales/sale_items" | Low |
| 2. Trigger-based (mirrors `sale_items`/`apply_sale_item_stock` exactly) | New `AFTER INSERT` trigger on `purchase_items` atomically updates `branch_stock` + writes `stock_movements` in the same transaction; extend reason CHECK with `'purchase'`; add nullable `stock_movements.purchase_item_id` | Atomic per item; consistent audit trail with a real FK link; exactly the architecture requested; RLS on `purchase_items` INSERT alone gates who can register | More schema surface; duplicates balance-update logic a third time (precedented, needs care to stay consistent, e.g. floor-at-zero) | Medium |

*(A lighter option — adding a cost field directly to `adjust_branch_stock`'s `restock` path — was already presented to and explicitly rejected by the user in favor of full history tracking; not re-proposed.)*

### Margin Calculation Fork (explicit decision needed)

| Option | Mechanism | Change to `analytics_product_ranking` | Effort |
|---|---|---|---|
| (a) Status quo | Current cost × historical quantity (today's behavior) | None | None |
| (b) Weighted-average cost | Average `purchase_items.unit_cost` weighted by quantity, computed per product at query time | One extra JOIN/subquery, pure SQL, no schema beyond `purchase_items` | Low–Medium |
| (c) FIFO lot consumption | Each sale consumes specific purchase "lots" in order, using that lot's cost | Stateful consumption ledger needed, touches the sale-side trigger too, ambiguous once reversals exist | High |

**Recommendation: (a) for v1.** Ship `purchases`/`purchase_items` purely as historical record-keeping, leave `analytics_product_ranking` untouched. (b) can be added later as a pure additive change once real purchase history accumulates. (c) only if there's a concrete accounting requirement later.

### Recommendation

1. `purchases` (header: `id, store_id, branch_id, supplier_name text NULL, purchase_date/created_at, note`) + `purchase_items` (`id, store_id, purchase_id, product_id, quantity, unit_cost, subtotal`), mirroring `sales`/`sale_items`' shape and Shape B RLS.
2. **Approach 2** (trigger-based) for the stock-increase mechanism.
3. Supplier: **free-text `supplier_name` field now**, not a full table — promote later if supplier-level reporting is ever wanted.
4. Margin: **(a) status quo**, revisit weighted-average later.
5. UI: new **"Compras" tab in `StockView.tsx`** for entry, plus a `SalesHistory.tsx`-style list for viewing past purchases.
6. Reporting: a simple purchase-list view is sufficient for v1; defer any `/analytics` cost-trend panel until margin calculation actually changes.

### Risks

- Margin-calculation method is unresolved — must be confirmed explicitly.
- Role set for recording purchases is undefined (writes both quantity and cost — more sensitive than routine stock counts; neither `CATALOG_WRITE_ROLES` nor `STOCK_ROLES` cleanly covers it).
- Extending `stock_movements.reason`'s CHECK constraint requires an `ALTER TABLE ... DROP/ADD CONSTRAINT` on production, affecting a constraint that also underlies the 5 already-live reason values.
- Duplicating stock-increase arithmetic a third time (`apply_sale_item_stock`, `adjust_branch_stock`, new `apply_purchase_item_stock`) is precedented but a real maintenance risk (e.g. floor-at-zero must stay consistent across all three).
- Supplier-as-free-text means no dedup/autocomplete for v1 (e.g. "Proveedor A" vs "proveedor a" don't link) — accepted limitation.

### Ready for Proposal

Yes, with three decisions to put to the user first:
1. Margin calculation: (a) status quo (recommended) vs (b) weighted-average vs (c) FIFO.
2. Which roles may record a purchase (new explicit role set, not silent reuse).
3. Supplier: free-text field (recommended) vs full `suppliers` table now.
