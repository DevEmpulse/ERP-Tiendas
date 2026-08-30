# Proposal: Dedicated POS Sale-Entry Route (P4)

## Intent

Sale entry today is free-text: the cashier types a product name, and `product_id` is resolved only at submit via exact case-insensitive match. A typo silently writes `product_id: NULL` — the sale succeeds but is invisible to stock and product reporting. There is no barcode input, no product picker, and no stock signal anywhere. Three near-duplicate implementations (`sales-form.tsx`, `SaleModal.tsx` create, `SaleModal.tsx` edit) have to be kept in sync. This change gives caja, employee and encargado one fast, accurate, scan-first counter screen.

## Scope

### In Scope

- **New `/pos` route built from scratch** (not an in-place edit of `sales-form.tsx`), primary sale-entry surface for `caja`, `employee`, `encargado`; reachable by `admin`.
- Product picker: search by name/barcode, resolving a real `products.id` before the line is added; keeps a manual "producto no listado" free line so the counter is never blocked by a missing catalog entry.
- Keyboard-wedge barcode scan-to-add (fast keystrokes + `Enter`) against `products.barcode` (NOT NULL, EAN-8, globally unique).
- Non-blocking pre-submit stock check: read `branch_stock.current_stock`, show "no hay stock suficiente", allow confirm-and-continue.
- Route authorization for `/pos` in `src/proxy.ts` + `roles.ts`.
- **Retire `sales-form.tsx`** outright (no fallback copy kept).
- **New sidebar navigation for `caja`/`employee`**, replacing today's 3-tab strip (`employee-dashboard.tsx`), matching the `AdminSidebar`/`EncargadoSidebar` pattern already used by `admin`/`encargado`. New sections: `pos` (links out to `/pos`), `mis-ventas`, `caja`. This is a new deliverable beyond the original tab-strip dashboard, decided by the user during this proposal round.
- `admin`/`encargado` also get a `pos` sidebar entry (via the shared `sidebar-items.ts` used since `cash-register`), navigating to `/pos`, alongside their existing sections. Their dashboard/history views are unaffected.
- The vacated "Nueva venta" tab space in `employee-dashboard.tsx`'s dashboard is explicitly left open for future analytics (out of scope for this phase, just not filled with anything here).

### Out of Scope

- Camera-based scanning; `ReceiptModal.tsx` / `pdfGenerator.ts` changes; numeric keypad / change-due tender flow.
- Any DB schema, RLS, or trigger change. `apply_sale_item_stock()` keeps clamping to zero silently.
- `SaleModal.tsx` is untouched and narrows by usage to the correction/edit tool (`HistoryView`, `MySalesView`, admin back-office create).
- A strict catalog-only counter (rejected — free/unlisted line stays).
- Building the analytics content for the vacated dashboard space — only reserving it.

## Capabilities

### New Capabilities

- `pos-sale-entry`: the `/pos` surface — role access, product picker, barcode wedge, non-blocking stock warning, split payments, cash-session attribution, receipt handoff.

### Modified Capabilities

- None. `sale-line-items` requirements are unchanged: `/pos` writes the same rows, one per `sales.id`, and the guarantee that `/pos` always resolves a non-null `product_id` is a `pos-sale-entry` requirement, not a change to the (still nullable) column contract.

## Approach

One client route reusing `salesHelper.ts`, `cashSession.ts`, `roles.ts`, `ReceiptModal.tsx` unchanged. Extract the shared picker/line-editor so `/pos` does not become a fourth divergent form. Stock is a purely additive read of `branch_stock`; the warning lives entirely client-side.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/pos/` | New | POS route + page shell |
| `src/components/pos/` | New | Picker, barcode input, line editor, stock warning |
| `src/proxy.ts`, `src/lib/roles.ts` | Modified | `/pos` is not a protected prefix today — unauthenticated users would reach it |
| `src/components/employee/employee-dashboard.tsx` | Rewritten | 3-tab strip replaced by a sidebar shell (own sidebar or shared component), sections: `pos` (link out), `mis-ventas`, `caja` |
| `src/components/employee/sales-form.tsx` | Removed | Replaced, no fallback kept |
| `src/lib/sidebar-items.ts` | Modified | Add a `pos` section entry, shared by admin/encargado/employee sidebars |
| `src/components/admin/DashboardView.tsx`, `src/app/encargado/page.tsx`, `src/app/admin/page.tsx` | Modified | Add `pos` sidebar entry linking to `/pos`; encargado's sale creation moves to `/pos` |
| `src/components/admin/SaleModal.tsx` | Unchanged | Stays the correction tool |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `/pos` becomes a 4th near-duplicate form instead of unifying | High | Shared picker/line-editor module; delete `sales-form.tsx` in the same change rather than keeping a fallback |
| Strict picker breaks today's lenient "any name sells" contract | Med | Keep a deliberate manual/unlisted-product line path so no sale is ever blocked |
| Regression in split payments, `ref_code` grouping, or void/edit | Med | Reuse `salesHelper.ts` verbatim; preserve the `deletedIds`-count guard |
| Stock read adds latency at the counter | Low | Read is advisory; never block submit on it |
| Encargado path missed (bypasses `employee-dashboard.tsx`) | Med | Encargado entry point named explicitly as a deliverable |

## Rollback Plan

Pure application-code revert — no schema, RLS, trigger, or data migration to undo, and no historical sale shape changes. Revert the change commits: `sales-form.tsx` returns, `employee-dashboard.tsx`'s "Nueva venta" tab renders it again, and `/pos` disappears. `SaleModal.tsx` is untouched throughout, so admin/encargado retain a working create path even mid-rollback.

## Dependencies

- `products.barcode` NOT NULL / EAN-8 / unique (P1, applied).
- `branch_stock` per-branch balances (P2, applied).
- `sale_items` (applied) and `ReceiptModal.tsx` / `pdfGenerator.ts` (shipped).
- No new npm packages expected.

## Success Criteria

- [ ] `caja`, `employee`, `encargado` create sales from `/pos`; `admin` can reach it.
- [ ] Every line created via `/pos` carries a non-null `product_id`, except an explicitly-chosen unlisted-product line.
- [ ] Scanning a barcode adds the matching line without touching the mouse.
- [ ] Overselling shows the warning and still completes when confirmed; `branch_stock` still clamps at 0.
- [ ] Split payments, `ref_code` grouping, cash-session attribution, void/edit and receipts behave exactly as before.
- [ ] `sales-form.tsx` has no remaining importer; `npm run build` passes.
- [ ] `caja`/`employee` land on a sidebar shell (not the old tab strip) with `pos`/`mis-ventas`/`caja` sections; `admin`/`encargado` sidebars gain a `pos` entry.

## Proposal question round — resolved

All three items below were resolved directly by the user after this proposal's first draft; none remain open.

1. **`sales-form.tsx` disposition** — delete outright, no fallback copy.
2. **`caja`/`employee` navigation to `/pos`** — user chose (via free-text answer) to give `caja`/`employee` a full sidebar like admin/encargado, with `pos` as one of its sections, rather than keeping the tab strip. The vacated dashboard tab space is reserved for future analytics (not built now).
3. **Unlisted-product escape hatch** — kept; the counter must never block a sale for a missing catalog entry.
