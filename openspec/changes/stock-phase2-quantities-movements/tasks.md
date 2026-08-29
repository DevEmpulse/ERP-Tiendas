# Tasks: Stock Phase 2 — Branch Stock, Product Codes, Excel Import

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1450–1700 (migration.sql §15 ~330; StockView.tsx rework ~380; ProductLabel.tsx + multi-select ~230; ProductImportDialog.tsx ~430; ProductExportButton.tsx + wiring + docs ~180; package.json ~3) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 (see Work Units) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `migration.sql` §15.1–15.10 + rollback (schema, EAN-8 codes) | PR 1 | N/A (`test_command: ""`) — `execute_sql` probes (tasks 1.14–1.20) | Target database; pre-apply probes (1.1–1.2) + verification probes | Rollback SQL block, bottom-to-top per design |
| 2 | `StockView.tsx` per-branch stock (Stock column, adjust dialog, movement history) + `admin/page.tsx` threading | PR 2 (needs PR 1) | N/A — manual adjust + movement read (task 2.6) | Admin UI, `branch_stock`/`stock_movements` live from PR 1 | Revert `StockView.tsx` stock-column/dialog additions + `admin/page.tsx` prop threading |
| 3 | Deps install + `ProductLabel.tsx` + batch print multi-select in `StockView.tsx` | PR 3 (needs PR 1; touches same file as PR 2 — sequence after PR 2 merges to avoid conflict) | N/A — scanner test (task 3.6) | Real EAN-8 scanner against a printed label | Revert `ProductLabel.tsx` + multi-select/print-action diff in `StockView.tsx` |
| 4 | `ProductImportDialog.tsx` (import flow) — likely exceeds 400 lines alone; may need its own maintainer size-exception or a further parse/commit split | PR 4 (needs PR 1 + PR 3's dependency install) | N/A — reference file end-to-end (task 4.6) | Admin UI, user's reference `.xlsx` file | Revert `ProductImportDialog.tsx` + its `StockView.tsx` entry point |
| 5 | `ProductExportButton.tsx`, print-all-from-import wiring, docs, final build/advisors gate | PR 5 (needs PR 1, PR 3, PR 4) | N/A — export/re-import round-trip (task 5.4) | Admin UI | Revert `ProductExportButton.tsx` + wiring + docs independently |

## Apply Progress Notes (sdd-apply, 2026-08-29)

Executed by an apply agent with **no Supabase MCP access** (per orchestrator scope
boundary) — all DB-side apply/verify tasks (`execute_sql`, `get_advisors`) are left
unchecked below and require the orchestrator to run against a development branch.
Everything file-editable (migration SQL text, all application code, deps, docs) is
done and `pnpm run build` + `pnpm run lint` both pass clean. Repo uses **pnpm**
(`pnpm-lock.yaml`), not npm — used `pnpm add -E` / `pnpm audit` / `pnpm run build`
in place of the literal `npm ...` commands in this file's original text.

`pnpm audit` results: 52 findings (5 low / 24 moderate / 23 high), **none traced
through `read-excel-file`, `write-excel-file`, or `jsbarcode`** (verified via
`pnpm audit` output grep) — all pre-existing, rooted in `next@16.2.6` itself
(several CVEs), `jspdf > dompurify`, and `shadcn`'s bundled `@modelcontextprotocol/sdk`
dev-CLI dependency. Not introduced by this change; not fixed by this change either
(upgrading `next` is a separate, unrelated change). Reported here per instructions,
not silently ignored.

## Phase 1: Schema — `migration.sql` Section 15 (`stock-tracking`, `product-catalog`)

- [ ] 1.1 [VERIFY] Pre-apply probe on target database: `select count(*) from public.products;` — expect 0. **Requires orchestrator (Supabase MCP).**
- [ ] 1.2 [VERIFY] Pre-apply probe: duplicate-barcode-across-stores query from design §Migration/Rollout — expect empty. **Requires orchestrator (Supabase MCP).**
- [x] 1.3 Add §15.1: composite `UNIQUE (store_id, id)` on `branches` and `products`.
- [x] 1.4 Add §15.2: `product_code_seq`, `ean8_check_digit()`, `next_product_code()`.
- [x] 1.5 Add §15.3: `barcode` DEFAULT, unconditional backfill UPDATE, `SET NOT NULL`, swap partial index for global unique index, EAN-8 CHECK constraint. Verified against live `migration.sql` before writing: Phase 1 index is `products_store_barcode_uidx` at lines 472-473, matching design.md's citation exactly — no adjustment needed.
- [x] 1.6 Add §15.4: `branch_stock` table (composite PK, no surrogate id) + 2 indexes.
- [x] 1.7 Add §15.5: `stock_movements` append-only table + 3 indexes.
- [x] 1.8 Add §15.6: Shape B RLS (verbatim from `store-branches`) on both tables — `FOR ALL` on `branch_stock`; split `SELECT`/`INSERT` (no `UPDATE`/`DELETE`) on `stock_movements`.
- [x] 1.9 Add §15.7: `sale_items.branch_id` column, backfill UPDATE, `set_sale_item_branch()` BEFORE INSERT trigger.
- [x] 1.10 Add §15.8: `apply_sale_item_stock()` + `on_sale_item_inserted`/`on_sale_item_deleted` AFTER triggers.
- [x] 1.11 Add §15.9: `adjust_branch_stock()` RPC (admin/superadmin only, cross-store branch check).
- [x] 1.12 Add §15.10: grants (incl. `SEQUENCE` USAGE) + REVOKEs + the rollback block at end of `migration.sql` (as a trailing comment block, matching section 14's own convention in this file rather than a separate fenced code block).
- [x] 1.13 Applied §15.1→15.10 to production (2026-08-29). Zero-row `products` re-confirmed (0) immediately before apply — the earlier "no data" assumption for `stores`/`profiles` was wrong once in `store-branches`, so this was re-checked directly rather than trusted from a prior phase's claim.
- [x] 1.14 [VERIFY] `ean8_check_digit('9638507')` → 4 ✓, `('5512345')` → 7 ✓. `next_product_code()` ×5: all distinct (00000062…00000109), all `^[0-9]{8}$`, all self-validating (8th digit = `ean8_check_digit` of first 7).
- [x] 1.15 [VERIFY] Insert without `barcode` auto-filled (`00000116`). Invalid check digit (`00000001`) rejected by `products_barcode_ean8_check`. Duplicate code (`00000116`) from a second store rejected by the global `products_barcode_uidx` (confirmed NOT scoped to `store_id` — the whole point of the change).
- [x] 1.16 [VERIFY] `branch_stock(store_id=storeA, branch_id=storeB's branch)` rejected by `branch_stock_store_id_branch_id_fkey` — composite FK confirmed closing the cross-store pairing hole.
- [ ] 1.17 [VERIFY-PARTIAL] Cross-tenant/cross-branch RLS requires real authenticated JWT sessions (employee vs. admin) to test properly — `execute_sql` runs as `postgres`, which bypasses RLS entirely, so this cannot be verified from this connection. **Requires a manual pass by the user, logged in as an employee and an admin of different branches** (same limitation as `store-branches`' 2.5/3.5/4.6).
- [ ] 1.18 [VERIFY-PARTIAL] Same limitation as 1.17: the `REVOKE UPDATE, DELETE ... FROM authenticated, anon` targets those roles specifically, but this connection runs as `postgres`/service role, which the REVOKE does not (and cannot) restrict. Structurally confirmed via `pg_policy` that no `UPDATE`/`DELETE` policy exists on `stock_movements` (RLS default-denies both) and the REVOKE statement executed successfully; a real `authenticated`-role attempt is the only way to observe the denial directly. **Requires a manual pass by the user.**
- [x] 1.19 [VERIFY] Full round-trip tested end-to-end with a throwaway product/sale: stock set to 3, sold 5 (oversell) → clamped to 0, logged `reason=sale, quantity_delta=-5, applied_delta=-3, resulting_balance=0`. Deleted the sale (cascades to `sale_items`, fires the reversal) → stock restored to **3, not 5** — confirms the `applied_delta` reversal is exact and survives the cascade via the denormalized `sale_items.branch_id`. All test rows cleaned up; `products`/`sales`/`sale_items`/`branch_stock`/`stock_movements` all back to 0.
- [ ] 1.20 [VERIFY-PARTIAL] `adjust_branch_stock`'s admin-only check (`get_current_user_role() NOT IN ('admin','superadmin')`) is structurally present and reads live role state, same pattern already proven correct for `adjust_product_stock` in the pre-branch design — but exercising it as a real employee session needs a live login, same limitation as 1.17. **Requires a manual pass by the user.**
- [x] 1.21 `get_advisors(security)`: no new finding class. `get_current_user_branch_id`/`adjust_branch_stock` show the same pre-existing "SECURITY DEFINER callable by anon/authenticated" pattern already accepted for `get_current_user_store_id`/`get_current_user_role` (note: `adjust_branch_stock` and the trigger functions are `SECURITY INVOKER`, so they correctly don't even appear in this list). No `rls_disabled_in_public`, no `function_search_path_mutable` on any new object.

## Phase 2: `StockView.tsx` Per-Branch Stock UI (`stock-tracking`) — needs Phase 1

- [x] 2.1 `admin/page.tsx`: pass `branchId={selectedBranchId}` + resolved branch name into `StockView`.
- [x] 2.2 `StockView.tsx`: add `branchId`/`branchName` props; remove `barcode` input from create/edit product form (read-only display only). Note: `StockView.tsx` had **zero** pre-existing product CRUD (confirmed via `exploration.md` and direct read — it was 100% price-rule CRUD), so this task also built the entire "Productos" tab (list, create/edit dialog, category select + inline creation, active/inactive toggle) from scratch, not just the barcode-removal delta the task title implies.
- [x] 2.3 `StockView.tsx`: per-branch `Stock` column reading `branch_stock` for `branchId`.
- [x] 2.4 `StockView.tsx`: adjust-stock dialog calling `adjust_branch_stock` RPC (admin-only surface).
- [x] 2.5 `StockView.tsx`: read-only movement-history dialog per product, scoped to `branchId`.
- [ ] 2.6 [VERIFY] Switching the header branch selector changes displayed stock/history; admin adjustment reflects in both stock and the movement log; RPC call as employee is rejected server-side. **Requires a live DB (section 15 applied) + manual UI pass — not verifiable from this sandbox.**

## Phase 3: Product Labeling (`product-labeling`) — needs Phase 1

- [x] 3.1 `pnpm add -E read-excel-file write-excel-file jsbarcode`; `pnpm audit` (see Apply Progress Notes above); `pnpm run build` passes. Browser bundle smoke test **not performed** — no browser tool available to this agent; `pnpm run build` + full TypeScript/lint pass is the closest available proxy.
- [x] 3.2 Create `ProductLabel.tsx`: `jsbarcode` `EAN8` render on an `<svg>` ref inside `useEffect`; code text + name + sale price.
- [x] 3.3 `ProductLabel.tsx`: single-label print via the `ReceiptModal.tsx` `window.open` + inline `<style>` pattern.
- [x] 3.4 `StockView.tsx`: multi-select checkboxes in the product list + batch-print trigger.
- [x] 3.5 `ProductLabel.tsx`: batch print — one job, N labels, one per selected product.
- [x] 3.5a **Bug found and fixed post-apply**: the apply agent's session crashed (org policy error, unrelated to this code) mid-way through fixing a dedup-guard bug in `ProductLabelPrinter` — `printedKeyRef` was set on print but never reset when the queue cleared, so re-printing the exact same product set later would silently no-op. Orchestrator completed the fix: `printedKeyRef.current` now resets to `''` when `products.length === 0`.
- [ ] 3.6 [VERIFY] Print one label, scan with a real EAN-8 scanner; batch-print ≥3 in one job; confirm no label entry point is reachable from `/employee/*`. **Requires physical scanner + live DB — not verifiable from this sandbox.** (Code-level check: label print entry points only exist in `StockView.tsx`, which is only rendered from `/admin/*`; no import into any `src/components/employee/*` file.)

## Phase 4: Product Import (`product-import`) — needs Phase 1 + Phase 3.1 deps

- [x] 4.1 Create `ProductImportDialog.tsx`: file input → `readSheet(file)` from `read-excel-file/browser` (schemaless raw grid, no library `schema` option).
- [x] 4.2 Header row normalization (`NFD` strip accents, strip punctuation, trim, lowercase, collapse spaces) → column-index map against the 5 canonical keys + optional `id`; missing required header fails the whole preview with the found header list.
- [x] 4.2a **Bug found during user's manual testing with their real reference file and fixed**: the file uses abbreviated headers (`P. Costo Unitario ($)`, `P. Venta Unitario ($)`, `ID Producto`) instead of the originally-assumed spelled-out names (`Precio Costo Unitario`, `Precio Venta Unitario`, `ID`), so the preview failed with "faltan columnas requeridas" even though the data was there. Fixed by (1) stripping punctuation (periods, parens, `$`, commas) in `normalizeHeader`, not just accents/case/whitespace, and (2) matching each canonical field against a list of known variants (`findColumn`) instead of one exact string — the first variant is always this app's own export header, so an exported-then-reimported file still matches on the first try.
- [x] 4.3 `cellText`/`parseMoney`/`parseQty` helpers per the Excel Contract; `Margen%`/`Totales` columns never read, including a `#VALUE!` cell (never read because the column-index map only ever looks up the 5 canonical + `id` indices).
- [x] 4.4 Row resolution: `cellText(row.ID)` matched against `products.barcode` in-store; no match/blank → create-new path, file value discarded.
- [x] 4.5 Destination-branch required select + preview summary (`toCreate`/`toUpdate`/`newCategories` counts).
- [x] 4.5a **UI polish requested by user**: (1) footer's `Cancelar` button sat only ~8px from the dialog's rounded edge because the custom footer className didn't cancel the shared `DialogFooter` component's own `-mx-4 -mb-4` base margins — fixed with `mx-0 mb-0` in this dialog only (the same underlying pattern exists in ~6 other dialogs across the app; user chose to fix only this one, not app-wide, for now). (2) Replaced the native branch `Select` dropdown with a card-list of clickable branch rows (radio-button style, one row per branch) per the user's explicit preference over a "more prominent dropdown" alternative.
- [x] 4.6 4-phase commit: `categories.insert([...])` → `products.insert([...])` (barcode omitted, DEFAULT generates) → `products.upsert([...], onConflict:'id')` → one `rpc('adjust_branch_stock', ...)` per row with a non-zero quantity; per-row outcome report on partial failure.
- [x] 4.6a **Bug found during user's manual testing and fixed**: "Confirmar Importación" did nothing at all, not even a flash of the loading spinner — meaning `handleCommit` was returning immediately via its own `!destinationBranchId` guard. Cause: `resetState()` (which sets `destinationBranchId` to `null` among other fields) ran at the start of `handleFileChange`, so choosing a file silently wiped the branch selection the user had just made — the branch card stopped showing as selected, invisibly, and the preview/parse still worked (parsing doesn't need the branch), masking the loss until commit. Fixed by splitting the reset into `resetFileState()` (clears file/preview/outcome, used when picking a file) and a full reset that also clears the branch, used only in `handleClose()`.
- [x] 4.7 `StockView.tsx`: admin-only entry point opening `ProductImportDialog`.
- [x] 4.7a **Bug found during user's manual testing and fixed**: neither the branch select nor the file input worked — `branches` never loaded, so the select stayed empty and the file input (gated on a selected branch) stayed disabled. Cause: `ProductImportDialog` is opened by a plain external `<Button onClick={() => setIsImportOpen(true)}>` in `StockView.tsx`, not a `DialogTrigger`, so `Dialog`'s `onOpenChange` — which the branch-loading call was gated behind — never fires for the opening transition (Base UI/Radix only call it for transitions the dialog itself initiates: Escape, backdrop, its own Close button). Fixed by loading branches from a `useEffect` watching the `open` prop directly instead of `onOpenChange`. Other dialogs in this codebase are unaffected: they either use `DialogTrigger` (e.g. `UserManager`'s invite dialog, which is why its branch select worked) or don't need to lazy-load data on open.
- [ ] 4.8 [VERIFY] Reference file end-to-end: expected creates/categories/movements; `#VALUE!` cell never touched or erroring; re-import with real IDs updates and **adds** stock (never overwrites); unmatched ID always creates new; preview counts equal post-commit counts. **Requires live DB + the user's reference `.xlsx` file — not verifiable from this sandbox.**

## Phase 5: Catalog Export + Integration (`product-import`) — needs Phase 1, 3, 4

- [x] 5.1 Create `ProductExportButton.tsx`: two-query merge (`products`+`categories` name, `branch_stock` @ `selectedBranchId`, default 0) → `write-excel-file` with the exact import column order/names.
- [x] 5.2 `StockView.tsx`: wire `ProductExportButton` (admin-only surface).
- [x] 5.3 Wire "print all products from this import run": `ProductImportDialog`'s created-product list → `ProductLabel`'s batch-print function (via a "Imprimir importados (N)" button in `StockView.tsx`, an explicit admin action rather than an automatic print, matching the spec's "admin triggers" wording).
- [ ] 5.4 [VERIFY] Export then re-import that exact file unmodified: every row matched and updated, 0 new products/categories created. **Requires live DB with real products — not verifiable from this sandbox.**
- [x] 5.5 `docs/database.md`, `docs/features.md`: new tables, Shape B usage on `branch_stock`/`stock_movements`, EAN-8 generation, import/export flow.
- [ ] 5.6 Final gate: `pnpm run build` passes (✅ confirmed); `get_advisors(security)` — no new finding across the whole change. **`get_advisors` requires orchestrator (Supabase MCP); left unchecked until run.**
