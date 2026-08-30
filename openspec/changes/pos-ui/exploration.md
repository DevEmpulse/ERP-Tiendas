# Exploration: pos-ui (P4 — Dedicated POS UI / Punto de Venta)

## Current State

Sale creation in ERP Tiendas is currently split across two main form implementations and three distinct user paths, none of which provide a dedicated, scan-first point-of-sale experience:

1. **`caja` / legacy `employee`** → Handled via `src/components/employee/employee-dashboard.tsx` (`lines 111-158`), which renders a 3-tab layout (*"Nueva venta"*, *"Mis ventas de hoy"*, *"Caja"*). The *"Nueva venta"* tab embeds `src/components/employee/sales-form.tsx` (a mobile-card-per-product vertical scrolling form).
2. **`admin` / `encargado`** → Both land on full sidebar dashboards (`src/app/admin/page.tsx`, `src/app/encargado/page.tsx`). In both dashboards, `DashboardView.tsx` (`lines 8, 113`) and `HistoryView.tsx` trigger `src/components/admin/SaleModal.tsx` (a compact `Dialog` with a 5-column table grid) for both sale creation and edits. Notably, **`encargado` never uses `sales-form.tsx`**—their daily sale entry goes through `SaleModal.tsx` (`encargado/page.tsx:8,300` -> `DashboardView.tsx:8,113`).
3. **Employee Self-Correction / Void** → `src/components/employee/MySalesView.tsx` (`lines 351-374`) reuses `SaleModal.tsx` in edit mode for editing today's sales, while providing a dedicated void action (`lines 162-193`).

Both `sales-form.tsx` and `SaleModal.tsx` have been patched across every previous phase (catalog `product_id` resolution, branch attribution, cash session tagging, role-gated client editing), leading to significant code duplication and severe functional POS gaps.

---

### Product Entry & Lookup: Free-Text vs. Catalog Resolution

- **Free-text inputs**: Both forms use a plain `<Input type="text">` for entering product details (`sales-form.tsx:584-591` `detail`, `SaleModal.tsx:628-635` `detalle`).
- **Submit-time resolution**: `product_id` is never selected from a picker or resolved interactively. Instead, it is resolved **only at submit time** via an exact case-insensitive name match against all active products in the store (`sales-form.tsx:322-331`, `SaleModal.tsx:393-401`):
  ```typescript
  productIdByName.get(p.detail.trim().toLowerCase()) ?? null
  ```
- **Silent failure on typos**: A slight typo or unmatched description silently sets `product_id: null` and `sale_items.product_id: null`. The sale still succeeds, but:
  1. No stock deduction occurs (`apply_sale_item_stock()` no-ops when `product_id IS NULL`, `migration.sql:930`).
  2. The sale cannot be tracked in future product-level sales reports.
- **No autocomplete or picker component**: There is no reusable product search, dropdown, or autocomplete widget anywhere in `src/components/`. `StockView.tsx` (`lines 435-468`) has an in-memory filter, and `StockAdjustDialog.tsx` operates on pre-selected product rows, but no standalone product picker exists.

---

### Barcode Scanning & Hardware Integration

- **Phase 2 Barcode Foundation**: Phase 2 added automatic EAN-8 generation upon product creation (`migration.sql:750-785`), barcode label printing (`src/components/admin/ProductLabel.tsx` using `jsbarcode`), and Excel import/export matching (`ProductImportDialog.tsx:140-150`, `ProductExportButton.tsx`).
- **Zero Scan-to-Add Support**: Neither `sales-form.tsx` nor `SaleModal.tsx` contains any listener for barcode scanner input (keyboard-wedge rapid keystrokes + `Enter`) or camera-based video scanner.
- **Cashier Friction**: To register a sold item with a barcode label, a cashier currently has to manually read the product name from the label and type it into the free-text description box, hoping for an exact name match.

---

### Stock Awareness & Overselling Behavior

- **Database Trigger Behavior (`migration.sql:919-968`)**:
  ```sql
  UPDATE public.branch_stock
     SET current_stock = GREATEST(v_before + v_delta, 0), updated_at = now()
   WHERE branch_id = v_item.branch_id AND product_id = v_item.product_id
  ```
  `apply_sale_item_stock()` clamps `current_stock` to `0` and **never raises an exception**.
- **Silent Oversell**: If a branch has 0 units of an item and 5 units are sold, the sale succeeds immediately, the stock remains 0, and `stock_movements` records `quantity_delta = -5, applied_delta = 0, resulting_balance = 0` (`migration.sql:960-965`).
- **Zero UI Visibility**: Neither `sales-form.tsx` nor `SaleModal.tsx` fetches `branch_stock` or displays available stock quantities during sale entry. The cashier has no indication whether an item is in stock, low on stock, or out of stock.

---

### Cash Session Integration UX

- **Core Invariant**: Per `src/lib/cashSession.ts` (`lines 3-6`) and `docs/features.md` (§5.1), **no sale is ever blocked by cash session state**. If no session is open at the branch, the sale is recorded with `cash_session_id = null` (unattributed).
- **Submit-Time Fresh Fetch**: Both forms call `fetchOpenSession(supabase, branchId)` fresh during submit (`sales-form.tsx:337-338`, `SaleModal.tsx:342-343`).
- **UI Communication Discrepancy**:
  - `sales-form.tsx`: Contains **no internal session indicator**. `employee-dashboard.tsx` (`lines 99-108`) renders `<CashSessionPanel>` as ambient context *above* the tab strip, displaying *"Sin sesión de caja abierta · Las ventas se registrarán sin atribuir"* (`CashSessionPanel.tsx:227-236`).
  - `SaleModal.tsx` (`lines 558-564`): Displays a subtle one-line static label indicating the open session timestamp or warning that the sale will be unattributed.
  - Neither form warns the user immediately prior to submission if they are making a `cash` payment without an active cash drawer session.

---

### Payment Handling & Split Payments

- **Single Payment**: Offers 3 toggle buttons (`cash`, `transfer`, `card`) (`sales-form.tsx:883-937`, `SaleModal.tsx:821-840`).
- **Combined / Split Payments**:
  - Activated via a switch toggle (`sales-form.tsx:721-748`, `SaleModal.tsx:720-743`).
  - Requires manual entry into 3 separate numeric inputs (`cash`, `transfer`, `card`).
  - Cashier must perform manual arithmetic to match the products total. A mismatch warning banner displays *"Faltan registrar $X"* or *"Sobra un excedente de $X"* (`sales-form.tsx:854-863`).
  - Submitting inserts $N$ separate rows into `sales` sharing one 4-character `ref_code` (e.g., `#A4F9`) (`sales-form.tsx:353-400`, `SaleModal.tsx:415-450`).
  - `src/lib/salesHelper.ts` (`groupSales()`, `lines 131-231`) merges these rows for display in history tables by parsing `Ref: #XXXX` or falling back to `cleanDesc_employeeId_timeMinute`.
- **Missing POS Tender Features**: No fast-cash buttons (e.g., exact amount, $1.000, $2.000, $5.000, $10.000, $20.000), no numeric keypad (*numpad*), and no *"Amount Tendered vs. Change Due"* (Vuelto) calculator.

---

### Receipt Generation & Thermal Printing Status

- **Already Shipped (`docs/features.md` §2, `src/components/shared/ReceiptModal.tsx`)**:
  - Fully functional modal triggered immediately upon successful sale submission (`sales-form.tsx:442-470`, `SaleModal.tsx:482-520`).
  - Configurable thermal printer formatting (**58mm** and **80mm**) stored in `stores.thermal_paper_width` and passed as props (`sales-form.tsx:42`, `SaleModal.tsx:46`).
  - Uses `window.open` with self-contained CSS (`@page { size: 58mm auto; }`) for thermal posnets (`ReceiptModal.tsx:77-178`).
  - PDF receipt generation powered by `jsPDF` (`src/lib/pdfGenerator.ts:10-85`).
- **Scope Assessment**: The receipt and printing pipeline is **mature, tested, and complete**. P4 should treat `ReceiptModal` as a dependency to reuse as-is; it does **not** need to modify or rebuild ticket generation.

---

### Sale Correction & Post-Close Immutability

- **Database-Level Guard (`migration.sql:1904-1960`, section 17.8)**:
  - RLS policies prevent `caja`, `employee`, and `encargado` from updating or deleting sales once the associated `cash_sessions` row has `status = 'closed'`. `admin` and `superadmin` are exempt.
- **Client-Side Delete Handling (`salesHelper.ts:242-251`, `deleteSaleGroup()`)**:
  - When editing a sale in `SaleModal.tsx` (`lines 377-386`) or voiding in `MySalesView.tsx` (`lines 167-181`), the app executes `deleteSaleGroup()` and verifies that `deletedIds.length === ids.length`.
  - If RLS silently drops the delete (returning 0 rows affected), the UI aborts recreation and shows: *"No se pudo editar/anular esta venta: pertenece a una sesión de caja ya cerrada"*.
  - This pattern prevents duplicate sales and double stock deductions.

---

### Role Matrix & User Journeys

| Role | Sale Creation Entry Point | Sale Edit / Void Flow | Stock Adjustment Access | Cash Session Operation |
| :--- | :--- | :--- | :--- | :--- |
| **`caja`** | `sales-form.tsx` (Tab 1 in `employee-dashboard.tsx`) | `MySalesView.tsx` (Void + `SaleModal` edit for own sales today) | None (hidden) | Open / Close / Movements at own branch |
| **`employee`** *(legacy)* | Identical to `caja` | Identical to `caja` | None (hidden) | Open / Close / Movements at own branch |
| **`stock`** | **Blocked**: Routed to `StockAdjustmentView` (`employee-dashboard.tsx:49, 92-95`) | None | Manual adjustment & restock at own branch | None |
| **`encargado`** | `SaleModal.tsx` (via `DashboardView.tsx:113` in `encargado/page.tsx`) | `SaleModal.tsx` edit via `SalesTable.tsx` / `HistoryView.tsx` | Full stock & product management at own branch | Open / Close / Movements at own branch |
| **`admin`** | `SaleModal.tsx` (via `DashboardView.tsx:113` in `admin/page.tsx`) | `SaleModal.tsx` edit via `SalesTable.tsx` / `HistoryView.tsx` (exempt from post-close lock) | Full stock & catalog store-wide | Open / Close / Movements across all branches |

---

## Affected Areas

- `src/components/employee/sales-form.tsx`: Legacy employee sale form; lacks barcode scan, product picker, stock visibility, and modern POS layout.
- `src/components/admin/SaleModal.tsx`: Admin/encargado modal; contains duplicate sale-item calculation and submit logic; currently acts as both creation and correction modal.
- `src/components/employee/employee-dashboard.tsx`: Hosts the 3-tab layout (`Nueva venta`, `Mis ventas`, `Caja`).
- `src/app/encargado/page.tsx` & `src/components/encargado/EncargadoSidebar.tsx`: Encargado dashboard and navigation shell.
- `src/app/admin/page.tsx` & `src/components/admin/AdminSidebar.tsx`: Admin dashboard and navigation shell.
- `src/components/admin/sidebar-items.ts`: Shared sidebar navigation definitions across administrative roles.
- `src/proxy.ts` & `src/lib/roles.ts`: Route proxy authentication/authorization checks and role helper constants.
- `src/lib/salesHelper.ts`: `Sale`, `GroupedSale`, `groupSales()`, `deleteSaleGroup()`.
- `src/lib/cashSession.ts`: `fetchOpenSession()`, `openSession()`, `closeSession()`.
- `src/components/shared/ReceiptModal.tsx` & `src/lib/pdfGenerator.ts`: Thermal and PDF receipt rendering components (reused as-is).
- `migration.sql`: Only affected if stock overselling behavior is changed from trigger-clamped to hard-blocking (see Fork 3).

---

## Open Forks Requiring a Product Decision (for `sdd-propose`)

### Fork 1 — Architecture: Dedicated `/pos` Route vs. In-Place Redesign of `sales-form.tsx`
- **Option A (Dedicated `/pos` Route)**: Build a clean, dedicated full-screen or focused layout route (`/pos`) tailored for cashier workflows (product search bar, barcode listener, item list, tender panel). Unify `caja`, `employee`, and `encargado` sale creation on this route, while leaving `SaleModal.tsx` strictly as a back-office edit/correction modal.
- **Option B (In-Place Redesign of `sales-form.tsx`)**: Refactor `sales-form.tsx` inside the existing `employee-dashboard.tsx` tab strip.
- **Option C (Shared Core Extraction Only)**: Extract shared hooks/components (`ProductPicker`, `ProductLineEditor`, `useSaleCalculation`) without changing the outer page structures.

### Fork 2 — Barcode Scanner Scope: Hardware Keyboard-Wedge Only vs. Camera Scanner
- **Option A (Keyboard-Wedge USB/Bluetooth Only)**: Listen for fast sequential keystrokes terminating in `Enter` (`event.key === 'Enter'`) or focus a dedicated scan input. Compatible with 99% of retail handheld barcode guns. Zero third-party camera libraries or browser media permissions needed.
- **Option B (Hardware Wedge + Camera Scanner)**: In addition to keyboard-wedge, provide an interactive video scanner button using device camera (e.g. `html5-qrcode` or `@zxing/library`) for mobile/tablet cashiering.

### Fork 3 — Stock Enforcement: Non-Blocking Warning vs. Hard DB Block vs. Silent Status Quo
- **Option A (Non-Blocking UI Warning — Recommended)**: Client checks `branch_stock.current_stock` when adding/editing line items. If requested quantity exceeds available stock, displays a visible amber badge/toast (*"Stock insuficiente: disponible X"*), but allows the cashier to confirm and sell. Preserves the DB trigger (`apply_sale_item_stock()`) clamping at zero without schema changes.
- **Option B (Hard DB / Trigger Block)**: Modify `apply_sale_item_stock()` in `migration.sql` to `RAISE EXCEPTION` when `v_before + v_delta < 0`. Blocks any oversell across all sale channels (POS, Admin, API).
- **Option C (Keep Silent Status Quo)**: No stock display or check during sale entry.

### Fork 4 — Unification of `encargado` Sale Entry
- **Option A (Unify on New POS)**: Move `encargado` to the new POS interface for creating sales, aligning them with `caja`/`employee`. `SaleModal.tsx` remains exclusively for editing/correcting past sales.
- **Option B (Keep Split)**: `encargado` continues creating sales via `SaleModal.tsx` from `DashboardView.tsx`, while only `caja`/`employee` use the new POS interface.

### Fork 5 — Receipt & Ticket Printing Scope
- **Option A (Reuse `ReceiptModal.tsx` As-Is)**: Treat the existing 58mm/80mm thermal and PDF receipt generation as completely sufficient. No new receipt features in P4.
- **Option B (Expand Receipt Capabilities)**: Add custom receipt footers, logo uploads, or auto-print triggers.

---

## Approaches

### Approach 1: Dedicated `/pos` Route with Unified Cashier Experience (Recommended)
Create a new route `/pos` and page shell optimized for speed, keyboard navigation, and touchscreen tablets.
- **Components**:
  - `ProductSearchPicker`: Autocomplete input searching `products` by name, category, or EAN-8 `barcode`.
  - `BarcodeWedgeListener`: Captures fast scanner input and adds/increments item lines automatically.
  - `CartTable` / `CartList`: Clean item list displaying quantity, unit price, discounts/price rules, available branch stock badge, and subtotal.
  - `PaymentPanel`: Quick single-method selection (`cash`, `transfer`, `card`), fast cash tender buttons ($1.000, $5.000, $10.000, $20.000), change-due calculation, and split payment breakdown.
  - `ManualLineItem`: Escape hatch to add unlisted/ad-hoc products (`product_id: null`) if an item is not yet in the catalog.
- **Routing & Roles**:
  - Add `/pos` to `src/proxy.ts` and `src/lib/roles.ts` (accessible by `admin`, `encargado`, `caja`, `employee`).
  - Provide direct navigation links in `AdminSidebar`, `EncargadoSidebar`, and `employee-dashboard.tsx`.
- **Pros**: Clean slate without legacy debt; unifies all front-line sellers; optimized for desktop, POS terminals, and tablets.
- **Cons**: Requires building a new route shell and updating navigation.
- **Effort**: High

### Approach 2: In-Place Redesign of `sales-form.tsx`
Keep the existing route structure and rewrite `sales-form.tsx` inside `employee-dashboard.tsx`.
- **Pros**: Avoids new route setup in `proxy.ts`.
- **Cons**: Leaves `encargado` using the completely different `SaleModal.tsx`; constrains layout within a dashboard tab card; does not cleanly solve desktop/tablet POS ergonomics.
- **Effort**: Medium

### Approach 3: Shared Core Extraction Only
Extract `ProductPicker` and `ProductLineEditor` into shared components and embed them into both `sales-form.tsx` and `SaleModal.tsx`.
- **Pros**: Reduces code duplication across existing forms with minimal risk.
- **Cons**: Fails to deliver a true "POS experience" (fast keyboard flows, full-screen counter layout, tender buttons).
- **Effort**: Medium

---

## Recommendation

**Approach 1 (Dedicated `/pos` Route with Unified Cashier Experience)**, combined with extracting the shared product picker/cart state logic.

**Rationale**:
1. Retail POS operators require a distraction-free, full-height workspace with rapid item entry, barcode scanning, clear running totals, and simple tender completion.
2. `encargado` and `caja` perform the identical physical task (ringing up customers at the counter); forcing them through different UIs (`SaleModal` vs. `sales-form`) creates maintenance overhead and UI divergence.
3. Keeping `SaleModal.tsx` strictly as a back-office correction/edit tool preserves all existing edit-mode and post-close lock guarantees without complicating the primary sales counter.
4. `ReceiptModal.tsx` and `cashSession.ts` can be plugged into `/pos` with zero modification.

---

## Risks

- **Catalog Completeness & Flexibility Risk**: If the POS strictly enforces catalog selection, cashiers could get stuck if a physical product has not yet been registered in `products`. *Mitigation*: Include a clear "Producto no listado / Venta libre" toggle to allow entering an ad-hoc description and price (`product_id: null`).
- **Oversell / Stock Warning Confusion**: If stock warnings are too intrusive or block transactions, cashier speed will degrade; if too subtle, cashiers will ignore stock levels. *Mitigation*: Use a clear, non-blocking inline badge on cart rows with an amber warning banner if total quantity exceeds stock.
- **Barcode Scanner Keystroke Collision**: Rapid typing by a fast cashier on a physical keyboard might occasionally be misinterpreted as a scanner event or vice versa. *Mitigation*: Differentiate scanner wedge input by timing intervals (< 30ms between characters) or dedicate an auto-focused search/scan input field.
- **Route Authorization Gaps**: `/pos` must be properly gated in `src/proxy.ts` and `src/lib/roles.ts` to prevent unauthorized access while allowing `admin`, `encargado`, `caja`, and `employee`.

---

## Ready for Proposal

**Yes.** The technical findings, file paths, role interactions, and architectural alternatives are fully mapped out.

Before moving to `sdd-propose`, the following product decisions (open forks) should be confirmed with the user:
1. **Fork 1**: Dedicated `/pos` route vs. in-place redesign of `sales-form.tsx`.
2. **Fork 2**: Keyboard-wedge barcode scanning only vs. adding camera-based video scanning.
3. **Fork 3**: Non-blocking stock warning vs. hard database rejection.
4. **Fork 4**: Unifying `encargado` on the new POS route.
5. **Fork 5**: Confirming `ReceiptModal.tsx` thermal/PDF capabilities are sufficient as-is.

---

## Key Findings Log

1. **Three Sale-Entry Code Paths Exist**: `sales-form.tsx` (caja/employee), `SaleModal.tsx` in create mode (admin and encargado via `DashboardView.tsx:113`), and `SaleModal.tsx` in edit mode (admin, encargado, and employee self-correction via `MySalesView.tsx:351`).
2. **Product Matching is Strictly Post-Hoc**: Free-text inputs resolve `product_id` only at submit time via exact name match (`sales-form.tsx:329-331`, `SaleModal.tsx:399-401`); typos silently write `product_id: null` with no stock deduction.
3. **No Barcode Scanner Flow in UI**: EAN-8 barcodes exist in the schema and label printer (`ProductLabel.tsx`), but no UI component listens for scanner inputs or performs barcode search at sale entry.
4. **Stock Clamping is Built-in**: `apply_sale_item_stock()` (`migration.sql:954`) clamps negative balances to 0 with `GREATEST(v_before + v_delta, 0)` and never raises exceptions.
5. **Cash Sessions Never Block Sales**: `src/lib/cashSession.ts:6` and `docs/features.md` (§5.1) mandate that sales without an open session proceed with `cash_session_id = null`.
6. **Receipt Printing is Fully Shipped**: `ReceiptModal.tsx` supports 58mm/80mm thermal receipts via raw HTML and PDF generation via `pdfGenerator.ts`, ready for immediate reuse in P4.
7. **Post-Close Edit Guard is Implemented**: `deleteSaleGroup()` (`salesHelper.ts:242-251`) checks affected rows against expected counts to detect RLS rejection on closed sessions (`migration.sql:1904-1960`).
