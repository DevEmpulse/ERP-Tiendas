# Proposal: Stock Phase 2 — Branch Stock, Product Codes, Excel Import

> **Full rewrite (2026-08-29).** The prior version of this file targeted a single
> `products.stock_quantity` column per store. `store-branches` has since landed
> (`branches`, `profiles.branch_id`, `sales.branch_id`, `get_current_user_branch_id()`,
> the two-tier RLS contract, the admin branch selector), and the user added two
> requirements to this same change. Everything below supersedes it.

## Intent

Three problems, one change, because each depends on the other two:

1. **Stock is uncountable.** `products` has no quantity anywhere, and stock is
   inherently *per location*: the same product has different quantities at each
   sucursal. A store cannot answer "how many are left **here**" or "why did that
   number change".
2. **Products have no human-usable identifier.** Phase 1's `products.barcode` is
   optional free text nobody ever types, and there is no way to label physical
   merchandise. Without a short numeric code there is no fallback keypad entry at
   the register and no stable match key for bulk updates.
3. **The catalog cannot be loaded.** `products` is still empty in every store
   (`exploration.md`: the only two call sites are read-only name lookups), so every
   `sale_items.product_id` written to date is NULL. Owners keep their inventory in
   Excel. Typing hundreds of products one dialog at a time is not a viable onboarding
   path, so the catalog stays empty and stock tracking stays theoretical.

Solving 1 without 3 ships a counter with nothing to count. Solving 3 without 2 gives
imported rows no stable identity to update against on the next import. This change
delivers all three.

## Scope

### In Scope

**A. Branch-scoped stock**

- `public.branch_stock` keyed `(branch_id, product_id)`, carrying `current_stock` and
  `min_stock`. `min_stock` is a **bare column with zero behaviour** — no alerts, no
  badges, no reporting (Phase 7 owns that); it exists so importers and the admin form
  have somewhere to write the value instead of a later schema break.
- `public.stock_movements` — append-only ledger, `branch_id uuid NOT NULL REFERENCES
  branches(id)` alongside `store_id`: typed reason, requested delta, applied delta,
  resulting balance, nullable `sale_item_id`, note, timestamp.
- Triggers on `sale_items` INSERT/DELETE resolving the target row as
  `(sales.branch_id, sale_items.product_id)`. All four writers stay correct through
  one enforcement point (`sales-form.tsx`, `SaleModal.tsx` create, `SaleModal.tsx`
  edit-by-delete-recreate, `SalesTable.tsx` cascade delete).
- Both new tables use `store-branches`' **Shape B** RLS predicate verbatim: admins and
  superadmins float across every branch of their store, employees are hard-restricted
  to their own branch at the DB layer.
- `StockView.tsx` gains per-branch stock: the admin sees and adjusts stock for the
  branch already selected in the header (`selectedBranchId`), plus a read-only movement
  history per product. Manual adjustment goes through an atomic admin-only RPC.

**B. Numeric 8-digit product code (EAN-8)**

- `products.barcode` becomes **system-generated and mandatory**: a global Postgres
  `SEQUENCE` yields 7 digits zero-padded (`0000001`–`9999999`) and an 8th check digit
  is appended. No user ever types it; the field disappears from the product form.
- Check digit: the **standard EAN-8/EAN-13 mod-10 weighted checksum** (GS1 General
  Specifications) — weight the 7 data digits alternately, sum, and take the value that
  brings the total to the next multiple of 10. `sdd-design` writes the arithmetic; it
  must be the real EAN-8 algorithm so any off-the-shelf scanner validates the code.
- Printable label: barcode graphic (**jsbarcode**, `EAN8` format, called imperatively
  against a canvas/svg ref) + the 8-digit code as text beneath it + product name +
  sale price. Printable for one product (row action) and in batch (multi-select in the
  product list, and "print all products from this import run").

**C. Excel product import / update**

- Admin uploads a `.xlsx`, picks **one destination branch** for the whole run, sees a
  pre-confirmation summary, then commits.
- Columns read: `Nombre del Producto`, `Sección` (category name), `Cantidad Ingresada`,
  `Precio Costo Unitario`, `Precio Venta Unitario`, optional `ID`.
- **`Margen%` / `Totales` columns are never read as values.** They are formula outputs
  and the user's own reference file contains a `#VALUE!` error in a `Margen%` cell.
  Margin is a derived display concern, recomputed from cost and sale price; the file's
  numbers are ignored outright rather than parsed defensively.
- Row **without** an ID, **or** with an ID that does not match an existing product in
  this store → create a product, generating a fresh EAN-8 code, in the category named
  by `Sección` (auto-created in that store's `categories` if absent). A file-supplied ID
  is never adopted as the new product's code — codes only ever come from the sequence,
  so nothing external is ever trusted as a real EAN-8. See the Approach section for why.
- Row **with** an ID that matches an existing product → update that product's identity
  fields (name, category, purchase_price, sale_price) **and** record `Cantidad
  Ingresada` as a **new `stock_movements` entry** at the chosen branch. Import is
  **always additive; it never overwrites a stock balance.**
- Preview shows counts before commit: N products to create (including any row whose ID
  didn't match anything), M to update, K categories to create.
- **Catalog export to Excel**: a button generates a `.xlsx` with one row per active
  product in the store — `ID` (the EAN-8 code), `Nombre del Producto`, `Sección`,
  `Cantidad Ingresada` (current stock at the branch the admin has selected),
  `Precio Costo Unitario`, `Precio Venta Unitario`. This is what closes the loop: the
  admin exports, edits quantities/prices in Excel, and re-imports the same file — every
  row now carries a real code, so every row updates instead of creating a duplicate.
  Column order and names match the import format exactly, so an exported file is a valid
  file to re-import unmodified.

### Out of Scope

- **Barcode scanning anywhere** — reading a code at a POS entry point stays Phase 4
  ("new POS UI"). This change only generates, renders, and prints codes.
- **Receipt/ticket templates** beyond this one product label — stays Phase 6, now
  narrower since label printing lands here.
- Low-stock alerting, thresholds, reporting, and any behaviour driven by `min_stock` —
  Phase 7.
- Stock transfers between branches; cash register (Phase 3); granular roles (Phase 5);
  sales-time product picker (Phase 4).
- Background/async import jobs, scheduled imports, CSV, or Google Sheets. One
  synchronous, user-confirmed run.
- No backfill of stock and no historical movement reconstruction.

## Capabilities

### New Capabilities

- `stock-tracking`: per-branch stock balances (`branch_stock`) plus an append-only,
  branch-isolated ledger explaining every quantity change, including sale-driven
  movements and admin adjustments.
- `product-labeling`: deterministic generation of a unique 8-digit EAN-8 code per
  product, and its rendering as a printable label (single and batch).
- `product-import`: spreadsheet-driven bulk creation and update of products, with
  category auto-creation, additive stock ingress at one chosen branch, a pre-commit
  summary, and a matching catalog export so codes assigned by import round-trip back
  into the next import file.

### Modified Capabilities

- `product-catalog`: `barcode` changes from *optional free text, unique per
  `(store_id, barcode)`* to *mandatory, system-generated, and **globally** unique
  across all stores* (a global sequence produces globally distinct values, so
  per-store uniqueness is no longer the right invariant). Products also gain no stock
  column — stock is deliberately not on `products`, since it varies per branch.
- `sale-line-items`: inserting a sale line decrements the stock of the **branch that
  sold it**, resolved through `sales.branch_id`; deleting one restores it.

## Approach

**Section 15 of `migration.sql`** (14 is now `store-branches`), additive and
dependency-ordered: sequence + code generator → `products.barcode` conversion →
`branch_stock` → `stock_movements` → Shape B RLS → `sale_items` triggers →
adjustment RPC.

**`barcode` keeps its name; no new column, no deprecation.** The column already exists,
is already indexed, already means "the barcode", and is expected to hold zero non-null
values (`products` has had no write path since Phase 1). Introducing a second column
would leave two identifier fields with one permanently empty. The evolution is:
`DEFAULT public.next_product_code()` → backfill any stragglers → `SET NOT NULL` →
replace the partial per-store unique index with a global unique index on `barcode`.
The backfill step is non-negotiable even at an expected zero rows, because it is what
makes `SET NOT NULL` safe if the assumption is wrong.

**Stock moves via DB triggers, not application code**, keeping the original design's
philosophy intact:

- **Never block the register.** Decrement clamps at zero; the movement is logged
  regardless. The oversell stays fully auditable because the ledger records the
  *requested* delta and the *applied* delta separately — reversal reverses the applied
  delta, so deleting a clamped oversell restores the true pre-sale balance instead of
  inventing units.
- **Exactly one decrement per logical purchase.** The split-payment duplication that
  would have decremented N times is **already fixed** — `store-branches` shipped the
  one-item-set-per-purchase writers. This change inherits the fix and must not regress
  it; no SQL-side deduplication exists or is needed.
- **A missing `branch_stock` row is not an error.** It is created on demand at zero,
  so a product never needs rows pre-seeded for every branch.

**An unmatched or missing import ID always falls through to "create new," never to
rejection or to adopting the file's value as the code.** Accepting a file-supplied
number as a product's real EAN-8 would reintroduce exactly the failure mode the
system-generated code exists to remove: a hand-typed or copy-pasted number is not
guaranteed to be a valid check-digit code, and even if it happened to look like one, the
sequence has no way to know it was "used," risking a future collision when the sequence
independently reaches that value. Treating an unmatched ID as a fresh row is what makes
mixing brand-new products and stock updates for existing ones work in a single file:
new rows are simply left with the ID column blank (or any value, since it is ignored),
while existing products are updated by the code the system itself printed on their label.

**The importer runs in the browser.** This repo has no server actions and exactly one
API route (`src/app/auth/callback/route.ts`); all data access is client-side Supabase
under RLS. Parsing, previewing, and committing all happen in the admin component,
which also keeps tenant isolation enforced by the database rather than by new server
code. **A spreadsheet library is a new dependency** — `package.json` has no `xlsx`,
`exceljs`, or equivalent today. It must both **read** (import) and **write** (export)
`.xlsx`, since export exists specifically to produce a file the importer accepts
unmodified. `sdd-design` selects and pins it, and must check publication status before
choosing: the npm-registry `xlsx` package has been stale since SheetJS moved to its own
distribution channel, so the maintained npm alternative is the safer pick.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `migration.sql` | Modified | New section 15: sequence + EAN-8 generator, `barcode` conversion, `branch_stock`, `stock_movements`, Shape B RLS, `sale_items` triggers, adjustment RPC, rollback block |
| `src/components/admin/StockView.tsx` | Modified | Product CRUD (no barcode input), per-branch stock column, adjust-stock dialog, movement history, label print action, multi-select for batch labels |
| `src/components/admin/ProductLabel.tsx` | New | jsbarcode EAN-8 render + name + price; print-oriented layout, single and batch |
| `src/components/admin/ProductImportDialog.tsx` | New | File picker, destination-branch select, parsed preview, create/update/new-category summary, commit |
| `src/components/admin/ProductExportButton.tsx` (or inline in `StockView.tsx`) | New | Generates a `.xlsx` of the store's active catalog, columns matching the import format exactly, quantities for the currently selected branch |
| `src/app/admin/page.tsx` | Modified | Thread `branchId={selectedBranchId}` into `StockView` (the selector already exists) |
| `package.json` | Modified | Two new pinned dependencies: barcode renderer + spreadsheet parser |
| `src/components/employee/sales-form.tsx`, `SaleModal.tsx`, `SalesTable.tsx` | Unchanged | Split-payment fix already shipped in `store-branches`; triggers cover all four paths |
| `openspec/specs/product-catalog`, `sale-line-items` | Modified | Delta specs |
| `docs/database.md`, `docs/features.md` | Modified | New tables, Shape B usage, code generation, import flow |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| A non-empty `products` table breaks the `SET NOT NULL` conversion | Low | Verify row count on the dev branch **before** apply; the backfill step exists precisely for this and runs unconditionally |
| Import creates duplicate products because rows without a *matching* code never match by name | High | Stated as designed behaviour, surfaced in the preview ("N will be created"); name-based fuzzy matching is explicitly not attempted. Export exists specifically so a re-import carries real codes instead of blank/stale ones |
| Excel column headers differ from the reference file (accents, casing, extra spaces) | High | Normalize headers before matching; any unmatched required column fails the whole preview loudly with the header list found |
| Wrong destination branch chosen for an import run | Med | Branch is a required, explicit select in the dialog and is restated in the confirmation summary; movements are additive and reversible via adjustment |
| Global sequence exhaustion (10M codes) or cross-tenant code inference | Low | Accepted per `state.yaml`; codes are opaque and RLS still gates every read |
| Employee branch RLS blocks a legitimate cross-branch admin action | Med | Shape B short-circuits on role before the branch comparison; probe both roles on the dev branch |
| Combined SQL + 2 new components + StockView rework blows the 400-line review budget | High | `sdd-tasks` must slice: (1) schema + codes, (2) stock UI, (3) labels, (4) importer |
| A new npm dependency carries a React 19 / Next 16 peer conflict | Med | jsbarcode is framework-agnostic by decision; the parser must be verified against `npm run build` before the UI work starts |

## Rollback Plan

Section 15 ships with an explicit `down` block, reversed bottom-to-top: drop the
adjustment RPC, drop the two `sale_items` triggers then their function, `drop table
stock_movements cascade`, `drop table branch_stock cascade`, then restore `barcode`
(`DROP NOT NULL`, drop the default, drop the global unique index, recreate the Phase 1
partial per-store index, drop the sequence and generator). Generated codes may be left
in place — they are valid free text under the restored Phase 1 semantics, so no data is
destroyed. Revert `StockView.tsx` to its `store-branches` state and delete the two new
components; remove both dependencies. Nothing in the sales path depends on this change,
so a rollback leaves the POS fully functional. Snapshot before applying anywhere with
real rows.

## Dependencies

- **`store-branches` applied** — `branches`, `profiles.branch_id`, `sales.branch_id`,
  `get_current_user_branch_id()`, `get_current_user_role()`, and the header branch
  selector. All confirmed live.
- Phase 1 (`2026-08-28-stock-phase1-catalog`) applied — `products`, `categories`,
  `sale_items`.
- Two new npm dependencies (barcode renderer, spreadsheet parser), pinned with the
  lockfile committed.
- Supabase development branch for apply/verify before production merge; `execute_sql`
  and `get_advisors`.

## Success Criteria

- [ ] Every product has a non-null, globally unique 8-digit `barcode` whose 8th digit
      validates as a correct EAN-8 check digit; no UI accepts barcode input.
- [ ] A printed label scans successfully with a standard EAN-8 scanner and shows the
      code, the product name, and the sale price.
- [ ] Batch printing produces one label per selected product in a single print job.
- [ ] `branch_stock` and `stock_movements` exist with RLS enabled; a cross-tenant read
      returns zero rows, and an employee of branch X reads zero rows for branch Y.
- [ ] An admin can adjust stock for the selected branch and see the movement logged.
- [ ] A sale at branch X decrements branch X's stock exactly once and leaves branch Y
      untouched; a split payment still decrements exactly once.
- [ ] Deleting or editing a sale restores stock to its pre-sale value, including the
      clamped-oversell case.
- [ ] Selling more than available clamps at zero and never rejects the sale.
- [ ] Importing the user's reference file creates the expected products and categories,
      records one movement per quantity row at the chosen branch, and ignores every
      `Margen%`/`Totales` cell — including the `#VALUE!` one — without erroring.
- [ ] Re-importing the same file with IDs updates instead of duplicating, and **adds**
      stock rather than overwriting it.
- [ ] A row whose ID does not match any product in the store is created as new (with a
      fresh code), never rejected and never treated as an update.
- [ ] Exporting the catalog and re-importing that exact file with no edits updates every
      row (matches every code) and creates zero new products or categories.
- [ ] The preview counts match what the commit actually writes.
- [ ] `npm run build` passes; `get_advisors` reports no new findings.

## Proposal question round — RESOLVED (user decision) + remaining assumptions

Nothing already settled in `state.yaml` (EAN-8 vs Code128, jsbarcode, global sequence,
minimal admin UI) is re-opened here.

1. **What does the Excel `ID` column match against?** → The **8-digit EAN-8 code**, not
   the internal uuid. It is the value printed on the label and the only identifier a
   human can read off a shelf, which is the whole point of having it.
2. **What happens to a row whose `ID` is not found in this store?** → **RESOLVED,
   changed from the first draft.** Create it as a new product with a fresh code,
   exactly like a blank-ID row — never reject, never adopt the file's value as the
   code. See Approach for why an external ID can't become the real code. This is also
   what makes exporting the catalog necessary (item 6 below): without an export, the
   only way to get a *real* code into a spreadsheet for updating existing stock is
   copying it by hand from the app or a printed label, which defeats bulk updates.
3. **Does an existing product with a blank or zero `Cantidad Ingresada` still update?**
   → Assumed **yes for identity fields, with no stock movement recorded**. A blank
   quantity means "correct the data", not "receive zero units".
4. **Does a newly created imported product with a quantity get a movement too?** →
   Assumed **yes**, logged as the same ingress reason at the same branch, so the ledger
   explains the opening balance rather than a number appearing from nowhere.
5. **Is `products` really empty in production?** → **CONFIRMED, verified directly**
   (`select count(*) from public.products` → 0), not just inherited from prior phases.
   Worth the direct check: `store-branches`' own "no production data" assumption about
   `stores`/`profiles` turned out to be wrong when actually applied, so this session
   re-verified `products` specifically rather than trusting the pattern. The
   `barcode NOT NULL` conversion's backfill step still runs unconditionally regardless.
6. **Catalog export to Excel** → **ADDED to scope** (see In Scope, item C) after the
   user pointed out that without it, updating existing products' stock in bulk has no
   practical way to get real codes into a spreadsheet.
7. **Who can import, export, and print?** → Assumed **admin only** (all three surfaces
   live under `/admin/*`). Employees never see them, and the DB additionally restricts
   them to their own branch's stock rows.
