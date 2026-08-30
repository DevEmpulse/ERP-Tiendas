# Tasks: POS UI — Dedicated Sale-Entry Route (P4)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1400 total (T1 ~80 / T2 ~130 / T3 ~350 / T4 ~250 / T5 ~320 / T6 ~270) |
| 400-line budget risk | High |
| Chained work units recommended | Yes |
| Suggested split | 6 sequential units — each compilable and independently verifiable |
| Delivery strategy | ask-on-risk |

### Suggested Work Units

| Unit | Goal | Files | Verification |
|---|---|---|---|
| T1 | Auth & routing foundation | `proxy.ts`, `roles.ts`, `app/pos/page.tsx` | `npm run build`; unauthenticated → `/login`, `stock` role → `/employee` |
| T2 | Sidebar plumbing | `sidebar-items.ts`, `EmployeeSidebar.tsx`, `admin/page.tsx`, `encargado/page.tsx` | Build; admin/encargado see "Punto de Venta" entry; click → navigates `/pos` |
| T3 | Employee dashboard rewrite | `employee-dashboard.tsx`, delete `sales-form.tsx` | Build; `grep -r "sales-form" src/` → 0; `caja` dashboard shows sidebar |
| T4 | Product picker + barcode listener | `ProductPicker.tsx`, `BarcodeWedgeListener.tsx` | Build; picker filters by name/barcode; unlisted hatch visible |
| T5 | Cart + stock warning + submit panel | `PosCart.tsx`, `StockWarningDialog.tsx`, `PosSubmitPanel.tsx` | Build |
| T6 | PosShell + E2E wire-up | `PosShell.tsx` | Build; full manual E2E — scan, pick, oversell, split payment, receipt |

---

## T1: Auth & Routing Foundation

- [ ] 1.1 `src/lib/roles.ts` — export `POS_ENTRY_ROLES = ['admin', 'encargado', 'caja', 'employee'] as const`
- [ ] 1.2 `src/proxy.ts` — add §10 `/pos` access-control block after §9 (line 128): allow `admin`, `encargado`, `POS_ROLES`; redirect others to `homeFor(role)`
- [ ] 1.3 `src/app/pos/page.tsx` — new client component: `getSession()` guard → profile+store+branch query → role check against `POS_ENTRY_ROLES` → render `<PosShell>` or loading skeleton (reuse admin skeleton shape from `admin/page.tsx:437–472`)
- [ ] 1.4 `npm run build` — must pass
- [ ] 1.5 Verify: unauthenticated `GET /pos` → redirect `/login`; `stock` role → redirect `/employee`; `caja` role → renders (skeleton acceptable)

---

## T2: Sidebar Plumbing

- [ ] 2.1 `src/components/admin/sidebar-items.ts` — add `ShoppingCart`, `Receipt`, `Wallet` to lucide imports; extend `AdminSection` union with `'pos'` and `'my_sales'`; prepend `pos` entry to `ADMIN_MENU_ITEMS`; export new `EMPLOYEE_MENU_ITEMS` (`pos`, `my_sales`, `cash`)
- [ ] 2.2 `src/components/employee/EmployeeSidebar.tsx` — new file; thin wrapper over `AdminSidebar` with `EMPLOYEE_MENU_ITEMS` and `portalLabel="Portal Caja"`
- [ ] 2.3 `src/app/admin/page.tsx` — extract `handleSetSection`: if `section === 'pos'` → `router.push('/pos')`; else `setActiveSection(section)`; pass `handleSetSection` to `<AdminSidebar setSection=...>`
- [ ] 2.4 `src/app/encargado/page.tsx` — same `handleSetSection` pattern; pass to `<EncargadoSidebar setSection=...>`
- [ ] 2.5 `npm run build` — must pass
- [ ] 2.6 Verify: admin sidebar shows "Punto de Venta" as first item; clicking it navigates to `/pos`; encargado sidebar identical; existing sections unaffected

---

## T3: Employee Dashboard Rewrite + Delete sales-form.tsx

- [ ] 3.1 `src/components/employee/employee-dashboard.tsx` — remove: `SalesForm` import (line 6), `activeTab` state (line 39), `PlusCircle` import (line 12), 3-tab strip (lines 110–148), `SalesForm` render (line 152)
- [ ] 3.2 `employee-dashboard.tsx` — add: `EmployeeSidebar` import, `isSidebarOpen`/`setIsSidebarOpen` state, `activeSection` state typed `'my_sales' | 'cash'` (default `'my_sales'`), `handleSetSection` with `router.push('/pos')` intercept
- [ ] 3.3 `employee-dashboard.tsx` — rewrite layout to sidebar shell + sticky header + main content (mirror `admin/page.tsx:474–566`); section dispatch: `my_sales` → `<MySalesView>`, `cash` → `<CashSessionPanel>` + `<CashSessionHistoryView>`
- [ ] 3.4 `employee-dashboard.tsx` — preserve `isStockRole` branch unchanged (lines 49, 92–95 equivalent): `stock` roles render `<StockAdjustmentView>` in the existing header-only layout
- [ ] 3.5 Delete `src/components/employee/sales-form.tsx`
- [ ] 3.6 `npm run build` — must pass
- [ ] 3.7 Verify: `grep -r "sales-form" src/` → 0 results; `caja` user landing on `/employee` sees sidebar with "Punto de Venta", "Mis ventas", "Caja"; clicking "Mis ventas" shows today's sales; "Caja" shows session panel

---

## T4: Product Picker + Barcode Wedge Listener

- [ ] 4.1 `src/components/pos/ProductPicker.tsx` — Shadcn `Popover` + `Command` combobox; props: `products[]`, `onAddLine`; search filters by `name` and `barcode` (case-insensitive); unlisted escape hatch always last in list; on catalog select: `onAddLine({ productId, productName, barcode, unitPrice: 0, quantity: 1, isUnlisted: false })`; on unlisted select: inline name+price form then `onAddLine({ productId: null, ..., isUnlisted: true })`
- [ ] 4.2 `src/components/pos/BarcodeWedgeListener.tsx` — invisible `null`-returning component; global `keydown` listener on `document`; 50 ms threshold between consecutive keystrokes; ignore events when `document.activeElement` is `INPUT`/`TEXTAREA`; sequence ≥ 6 chars ending in `Enter` within threshold → call `onScan(buffer)`; stale buffer reset on gap > threshold; props: `{ onScan: (barcode: string) => void }`
- [ ] 4.3 `npm run build` — must pass
- [ ] 4.4 Verify (visual, no DB): picker opens; typing partial name filters list; "producto no listado" always visible; barcode digits typed fast → `onScan` fires; same digits typed slowly → `onScan` does not fire

---

## T5: Cart + Stock Warning + Submit Panel

- [ ] 5.1 Define shared `CartLine` type in `src/components/pos/types.ts` (or inline in `PosShell.tsx`): `{ lineId, productId, productName, barcode, quantity, unitPrice, subtotal, isUnlisted }`
- [ ] 5.2 `src/components/pos/PosCart.tsx` — renders `CartLine[]` as table/card list; editable qty + unit price inputs (subtotal recomputes on change); unlisted lines show editable name; delete button per row; grand total below; empty state hint; props: `{ lines, onUpdateLine, onRemoveLine }`
- [ ] 5.3 `src/components/pos/StockWarningDialog.tsx` — Shadcn `AlertDialog`; props: `{ items: StockWarningItem[] | null, onConfirm, onCancel }`; lists offending products with available vs. requested stock; "Cancelar" + "Confirmar de todas formas" actions
- [ ] 5.4 `src/components/pos/PosSubmitPanel.tsx` — payment method toggle (cash/transfer/card) + combined toggle + split amount inputs (ported from `sales-form.tsx:54–82`); client name+phone optional fields (from `sales-form.tsx:65–68`); grand total display; submit button with loading state; props: all controlled values + callbacks + `onSubmit`
- [ ] 5.5 `npm run build` — must pass

---

## T6: PosShell + Full Wire-Up

- [ ] 6.1 `src/components/pos/PosShell.tsx` — full-page layout: `EmployeeSidebar` (currentSection=`'pos'`) + sticky header (store/branch name, logout) + `<BarcodeWedgeListener onScan={handleScan}>` + two-column grid (`PosCart` left, `PosSubmitPanel` right sticky desktop) + `<StockWarningDialog>` + `<ReceiptModal>`
- [ ] 6.2 `PosShell.tsx` — product fetch on mount: `products` table, `store_id` + `is_active=true`, store in state
- [ ] 6.3 `PosShell.tsx` — `handleScan(barcode)`: client-side match against `products` array; hit → `addLine`; miss → transient toast "Código no encontrado: XXXX"
- [ ] 6.4 `PosShell.tsx` — `handleSubmit()`: port logic from `sales-form.tsx:250–478` with: `lines` replacing `validProducts`; `line.productId` (resolved at add-time) replacing the submit-time `productIdByName.get(name)` lookup; pre-submit stock read → `StockWarningDialog` if offenders; `fetchOpenSession` fresh at submit; `ref_code` grouping preserved; `sale_items` insert shape unchanged; receipt handoff to `<ReceiptModal>` on success; form reset on receipt close
- [ ] 6.5 Wire `<PosShell>` into `src/app/pos/page.tsx` — replace skeleton with actual shell once profile loaded
- [ ] 6.6 `npm run build` — must pass; `grep -r "sales-form" src/` → 0
- [ ] 6.7 Manual E2E — full counter flow:
  - [ ] 6.7.1 `caja` opens `/pos` → sidebar shows, "Punto de Venta" active
  - [ ] 6.7.2 Scan valid barcode → line added automatically, no mouse needed
  - [ ] 6.7.3 Scan unknown barcode → toast "Código no encontrado", no line added
  - [ ] 6.7.4 Search by name → select → line added with non-null `product_id`
  - [ ] 6.7.5 Add "producto no listado" → line added with `product_id: NULL`
  - [ ] 6.7.6 Edit qty and unit price inline → subtotal updates
  - [ ] 6.7.7 Submit with oversell quantity → stock warning dialog appears → confirm → sale recorded; `branch_stock` clamped to 0
  - [ ] 6.7.8 Split payment (cash + transfer) → two `sales` rows sharing `Ref: #XXXX`
  - [ ] 6.7.9 Receipt modal opens → thermal/PDF output
  - [ ] 6.7.10 `encargado` opens `/pos` → same flow works
  - [ ] 6.7.11 Verify every catalog line in DB has non-null `product_id`
  - [ ] 6.7.12 Verify `sales-form.tsx` is gone and `/employee` sidebar works for `caja`
