# Design: Dedicated POS Sale-Entry Route (P4)

> Capability: `pos-sale-entry` — spec at `specs/pos-sale-entry/spec.md`
> Depends on: `exploration.md`, `proposal.md`

---

## 1. File Map

```
src/
├── app/
│   └── pos/
│       └── page.tsx                         [NEW] Route shell — auth, profile fetch, renders <PosShell>
├── components/
│   ├── pos/
│   │   ├── PosShell.tsx                     [NEW] Full-page layout (sidebar + header + content area)
│   │   ├── PosCart.tsx                      [NEW] Line-item list + add-line controls + subtotals
│   │   ├── ProductPicker.tsx                [NEW] Search-by-name-or-barcode combobox, unlisted escape hatch
│   │   ├── BarcodeWedgeListener.tsx         [NEW] Global keyboard listener; fires onScan(barcode)
│   │   ├── StockWarningDialog.tsx           [NEW] Pre-submit oversell warning + confirm/cancel
│   │   └── PosSubmitPanel.tsx               [NEW] Payment method toggle, split amounts, client fields, submit
│   ├── employee/
│   │   ├── employee-dashboard.tsx           [MODIFY] Strip sales-form import; replace 3-tab strip with sidebar shell
│   │   ├── EmployeeSidebar.tsx              [NEW] Thin wrapper over AdminSidebar with EMPLOYEE_MENU_ITEMS
│   │   └── sales-form.tsx                   [DELETE]
│   └── admin/
│       └── sidebar-items.ts                 [MODIFY] Add `pos`/`my_sales` entries; new EMPLOYEE_MENU_ITEMS export
├── lib/
│   └── roles.ts                             [MODIFY] Export POS_ENTRY_ROLES constant
├── app/
│   ├── admin/page.tsx                       [MODIFY] handleSetSection redirect for `pos`
│   └── encargado/page.tsx                   [MODIFY] handleSetSection redirect for `pos`
└── proxy.ts                                 [MODIFY] Add §10 /pos access-control block
```

---

## 2. Routing & Auth Gate

### `src/proxy.ts` — add §10

Insert after the existing §9 `/employee` block (line 128):

```ts
// 10. Access control for /pos
if (pathname.startsWith('/pos')) {
  const isPosAllowed =
    role === 'admin' ||
    role === 'encargado' ||
    (POS_ROLES as readonly string[]).includes(role ?? '')
  if (!isPosAllowed) {
    return redirectWithCookies(homeFor(role))
  }
}
```

`POS_ROLES` is already imported at line 3. No new imports needed.

**Roles that reach `/pos`:** `admin`, `encargado`, `caja`, `employee`.
**Roles denied:** `stock`, `superadmin`, unauthenticated.

### `src/lib/roles.ts` — add POS_ENTRY_ROLES

```ts
// Who may create sales via /pos (mirrors proxy §10)
export const POS_ENTRY_ROLES = ['admin', 'encargado', 'caja', 'employee'] as const
```

`homeFor` stays unchanged — `encargado` home remains `/encargado`, `caja`/`employee` home remains `/employee`. `/pos` is a secondary destination reached via sidebar, not `homeFor`.

---

## 3. Route Shell — `src/app/pos/page.tsx`

Client component. Pattern mirrors `src/app/employee/page.tsx` (lines 19–152):

1. `getSession()` — redirect `/login` if none.
2. Single Supabase query: `profiles` joined to `stores(name, thermal_paper_width)` and `branches(name)` via `branch_id`.
3. Role check: if not in `POS_ENTRY_ROLES`, redirect `homeFor(role)`.
4. Sets `profile`, `storeName`, `branchName`, `paperWidth` state.
5. Renders `<PosShell>` once loaded; shows skeleton while loading (reuse admin loading skeleton pattern from `admin/page.tsx:437–472`).

**Props passed to PosShell:**
```ts
interface PosShellProps {
  profile: {
    id: string
    store_id: string
    name: string | null
    role: Role
    email: string | null
    branch_id: string | null
  }
  storeName: string
  branchName: string
  paperWidth: '58mm' | '80mm'
}
```

---

## 4. Sidebar Items — `src/components/admin/sidebar-items.ts`

**Extend `AdminSection` union:**
```ts
export type AdminSection =
  | 'pos'       // ← new: navigates to /pos (handled via router.push, not local section)
  | 'my_sales'  // ← new: employee-only local section
  | 'dashboard'
  | 'history'
  | 'employees'
  | 'staff'
  | 'clients'
  | 'stock'
  | 'cash'
  | 'branches'
  | 'settings'
```

**Add `ShoppingCart` to imports** (lucide-react).

**Prepend `pos` to `ADMIN_MENU_ITEMS`:**
```ts
{
  id: 'pos',
  label: 'Punto de Venta',
  icon: ShoppingCart,
  description: 'Registrar ventas',
},
```

**`ENCARGADO_MENU_ITEMS`** — already derived from `ADMIN_MENU_ITEMS.filter(...)` at line 89; does not exclude `pos`, so inherits automatically.

**New `EMPLOYEE_MENU_ITEMS` export:**
```ts
export const EMPLOYEE_MENU_ITEMS: SidebarItem[] = [
  { id: 'pos',      label: 'Punto de Venta', icon: ShoppingCart, description: 'Registrar ventas' },
  { id: 'my_sales', label: 'Mis ventas',     icon: Receipt,      description: 'Ventas del día' },
  { id: 'cash',     label: 'Caja',           icon: Wallet,       description: 'Apertura y cierre' },
]
```

Add `Receipt` and `Wallet` to the imports in `sidebar-items.ts`.

---

## 5. Employee Sidebar — `src/components/employee/EmployeeSidebar.tsx`

Thin wrapper — identical pattern to `EncargadoSidebar.tsx` (26 lines):

```tsx
'use client'

import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { EMPLOYEE_MENU_ITEMS, type AdminSection } from '@/components/admin/sidebar-items'

interface EmployeeSidebarProps {
  currentSection: AdminSection
  setSection: (section: AdminSection) => void
  storeName: string
  adminName: string
  adminEmail: string
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
  onLogout: () => void
}

export function EmployeeSidebar(props: EmployeeSidebarProps) {
  return (
    <AdminSidebar
      {...props}
      items={EMPLOYEE_MENU_ITEMS}
      portalLabel="Portal Caja"
    />
  )
}
```

---

## 6. Employee Dashboard Rewrite — `src/components/employee/employee-dashboard.tsx`

**Remove:**
- `SalesForm` import (line 6) and its usage (line 152)
- `activeTab` state (line 39) and its type `'form' | 'my_sales' | 'cash'`
- The 3-tab strip block (lines 110–148)
- `PlusCircle` icon import (line 12)

**Add:**
- `EmployeeSidebar` import
- `isSidebarOpen`/`setIsSidebarOpen` state
- `activeSection` state typed as `'my_sales' | 'cash'` (default `'my_sales'`)
- Sidebar + header + main layout (mirroring `admin/page.tsx:474–566`)

**Section dispatch:**
```ts
type EmployeeSection = 'my_sales' | 'cash'

const renderSection = () => {
  switch (activeSection) {
    case 'my_sales':
      return <MySalesView profile={profile} storeName={storeName} paperWidth={paperWidth} />
    case 'cash':
      return (
        <>
          <CashSessionPanel storeId={profile.store_id} branchId={profile.branch_id}
            branchName={branchName} role={profile.role} userId={profile.id}
            userBranchId={profile.branch_id} />
          <CashSessionHistoryView storeId={profile.store_id} branchId={profile.branch_id} />
        </>
      )
    default:
      return null
  }
}
```

**POS nav item → router.push:**
```tsx
const handleSetSection = (section: AdminSection) => {
  if (section === 'pos') {
    router.push('/pos')
    return
  }
  setActiveSection(section as EmployeeSection)
}
```

**`isStockRole` branch** (lines 49, 92–95): kept intact — `stock` roles continue to render `StockAdjustmentView` inside the existing header-only shell without a sidebar.

---

## 7. Admin & Encargado — sidebar `pos` entry

In `src/app/admin/page.tsx` and `src/app/encargado/page.tsx`, intercept `pos` clicks:

```tsx
const handleSetSection = (section: AdminSection) => {
  if (section === 'pos') {
    router.push('/pos')
    return
  }
  setActiveSection(section)
}
```

Pass `handleSetSection` where `setActiveSection` is currently passed as the `setSection` prop to `AdminSidebar`/`EncargadoSidebar`. No other changes to these files.

---

## 8. POS Shell — `src/components/pos/PosShell.tsx`

Full-page layout. Mirrors `admin/page.tsx`'s top-level structure:

```
<div flex min-h-screen bg-zinc-50>
  <EmployeeSidebar currentSection="pos" ... />      ← always "pos" active
  <div flex-1 md:pl-64 flex flex-col>
    <header sticky>                                  ← store name, branch badge, logout
    <main flex-1 p-6>
      <BarcodeWedgeListener onScan={handleScan} />  ← invisible, always mounted
      <div grid lg:grid-cols-[1fr_400px] gap-6>
        <PosCart lines={lines} ... />               ← left column (scrollable)
        <PosSubmitPanel ... />                      ← right column (sticky desktop)
      </div>
      <StockWarningDialog ... />
      <ReceiptModal ... />
    </main>
  </div>
</div>
```

**State managed in PosShell:**
```ts
const [products, setProducts] = useState<Product[]>([])        // fetched once on mount
const [lines, setLines] = useState<CartLine[]>([])
const [paymentMethod, setPaymentMethod] = useState<'cash'|'transfer'|'card'>('cash')
const [isCombined, setIsCombined] = useState(false)
const [splitAmounts, setSplitAmounts] = useState({ cash: '', transfer: '', card: '' })
const [clientName, setClientName] = useState('')
const [clientPhone, setClientPhone] = useState('')
const [stockWarning, setStockWarning] = useState<StockWarningItem[] | null>(null)
const [pendingSubmit, setPendingSubmit] = useState(false)  // true when user confirmed stock warning
const [loading, setLoading] = useState(false)
const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
const [showReceipt, setShowReceipt] = useState(false)
```

**`CartLine` type:**
```ts
interface CartLine {
  lineId: string           // crypto.randomUUID() — local only, never persisted
  productId: string | null // null = unlisted product
  productName: string
  barcode: string | null
  quantity: number
  unitPrice: number
  subtotal: number         // quantity * unitPrice, recomputed on change
  isUnlisted: boolean
}
```

**Product fetch (on mount):**
```ts
useEffect(() => {
  supabase
    .from('products')
    .select('id, name, barcode')
    .eq('store_id', profile.store_id)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .then(({ data }) => setProducts(data ?? []))
}, [profile.store_id])
```

---

## 9. Product Picker — `src/components/pos/ProductPicker.tsx`

Uses Shadcn `Popover` + `Command` (cmdk — already in the project).

**Search** filters by `name.toLowerCase().includes(query)` or `barcode?.includes(query)`.

**Results list:**
```
┌─────────────────────────────────────┐
│ 🔍  Buscar producto o escanear...   │
├─────────────────────────────────────┤
│ Remera talle M              1234567 │
│ Gorra azul                  7654321 │
│ ...                                 │
├─────────────────────────────────────┤
│ + Agregar producto no listado       │  ← always last
└─────────────────────────────────────┘
```

**On catalog select:** `onAddLine({ productId, productName, barcode, unitPrice: 0, quantity: 1, isUnlisted: false })`.

**On unlisted select:** inline form (description + price) before calling `onAddLine({ productId: null, ..., isUnlisted: true })`.

**Props:**
```ts
interface ProductPickerProps {
  products: { id: string; name: string; barcode: string | null }[]
  onAddLine: (line: Omit<CartLine, 'lineId' | 'subtotal'>) => void
}
```

---

## 10. Barcode Wedge Listener — `src/components/pos/BarcodeWedgeListener.tsx`

Invisible component; global `keydown` listener on `document`. Treats a sequence of characters ending in `Enter` as a scan only when consecutive keystrokes arrive ≤ 50 ms apart. Ignores events when focus is inside an `INPUT` or `TEXTAREA`.

```ts
const SCAN_THRESHOLD_MS = 50

useEffect(() => {
  let buffer = ''
  let lastKeyTime = 0

  const handleKeyDown = (e: KeyboardEvent) => {
    const tag = (document.activeElement as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    const now = Date.now()

    if (e.key === 'Enter') {
      if (buffer.length >= 6 && (now - lastKeyTime) <= SCAN_THRESHOLD_MS) {
        onScan(buffer)
      }
      buffer = ''
      return
    }

    if (e.key.length === 1) {
      if (now - lastKeyTime > SCAN_THRESHOLD_MS && buffer.length > 0) {
        buffer = '' // stale — reset
      }
      buffer += e.key
      lastKeyTime = now
    }
  }

  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}, [onScan])

return null
```

**`handleScan` in PosShell** (client-side, no round-trip):
```ts
const handleScan = (barcode: string) => {
  const match = products.find(p => p.barcode === barcode)
  if (!match) {
    // transient toast: "Código no encontrado: XXXX"
    return
  }
  addLine({ productId: match.id, productName: match.name, barcode, unitPrice: 0, quantity: 1, isUnlisted: false })
}
```

---

## 11. Cart — `src/components/pos/PosCart.tsx`

Renders `lines[]`. Each row:

| Qty | Producto | P. Unit | Subtotal | ✕ |
|-----|----------|---------|----------|---|
| `<Input type="number">` | name (editable if unlisted) | `<Input type="number">` | computed | button |

Grand total below. Empty state: hint text.

```ts
interface PosCartProps {
  lines: CartLine[]
  onUpdateLine: (lineId: string, patch: Partial<CartLine>) => void
  onRemoveLine: (lineId: string) => void
}
```

---

## 12. Stock Warning Dialog — `src/components/pos/StockWarningDialog.tsx`

Shadcn `AlertDialog`. Triggered from `PosShell.handleSubmit()` when any catalog line's quantity exceeds `branch_stock.current_stock`.

**Pre-submit stock read:**
```ts
const catalogProductIds = lines
  .filter(l => l.productId !== null)
  .map(l => l.productId as string)

const { data: stockRows } = await supabase
  .from('branch_stock')
  .select('product_id, current_stock')
  .eq('branch_id', profile.branch_id)
  .in('product_id', catalogProductIds)

const stockMap = new Map(stockRows?.map(r => [r.product_id, r.current_stock]) ?? [])

const offenders = lines.filter(l =>
  l.productId !== null &&
  l.quantity > (stockMap.get(l.productId) ?? 0)
)
```

If `offenders.length > 0`, set `stockWarning = offenders` and abort. Dialog shows offenders list. "Confirmar de todas formas" calls `doInsert()`. "Cancelar" clears `stockWarning`.

---

## 13. Submit Panel — `src/components/pos/PosSubmitPanel.tsx`

UI-only component. Payment toggle + split inputs + client fields + submit button. Identical logic to `sales-form.tsx:54–82` (payment states) and `sales-form.tsx:65–68` (client states), lifted into props.

---

## 14. Submit Logic — `PosShell.handleSubmit()`

Ported from `sales-form.tsx:250–478` with targeted changes:

| Old (`sales-form.tsx`) | New (`PosShell`) |
|---|---|
| `validProducts` from free-text rows | `lines` from `CartLine[]` |
| `productIdByName.get(name)` at submit | `line.productId` already resolved at add-time |
| No stock check | Stock read → `StockWarningDialog` if offenders |
| `compiledDesc` from free text | `line.productName + line.quantity + formatCurrency(line.unitPrice)` |
| `buildSaleItemsForSale(saleId)` | Same, from `CartLine` fields |

**Preserved unchanged:**
- `fetchOpenSession(supabase, branchId)` — fresh call at submit time
- `ref_code` pattern: `crypto.randomUUID().slice(0,4).toUpperCase()` for combined payments
- `sale_items` insert shape: `{ store_id, sale_id, product_id, product_name, quantity, unit_price, subtotal }`
- Receipt handoff: build `ReceiptData`, `setShowReceipt(true)`

**After receipt close:** reset `lines = []`, reset payment state, show success toast.

---

## 15. Deletion of `sales-form.tsx`

Delete `src/components/employee/sales-form.tsx` after `employee-dashboard.tsx` no longer imports it.

Verification:
```bash
grep -r "sales-form" src/
# Expected: 0 results
```

---

## 16. File Change Summary

| File | Action |
|------|--------|
| `src/app/pos/page.tsx` | NEW |
| `src/components/pos/PosShell.tsx` | NEW |
| `src/components/pos/PosCart.tsx` | NEW |
| `src/components/pos/ProductPicker.tsx` | NEW |
| `src/components/pos/BarcodeWedgeListener.tsx` | NEW |
| `src/components/pos/StockWarningDialog.tsx` | NEW |
| `src/components/pos/PosSubmitPanel.tsx` | NEW |
| `src/components/employee/EmployeeSidebar.tsx` | NEW |
| `src/components/employee/employee-dashboard.tsx` | REWRITE |
| `src/components/employee/sales-form.tsx` | DELETE |
| `src/components/admin/sidebar-items.ts` | MODIFY |
| `src/app/admin/page.tsx` | MODIFY |
| `src/app/encargado/page.tsx` | MODIFY |
| `src/proxy.ts` | MODIFY |
| `src/lib/roles.ts` | MODIFY |

**Unchanged (reused as-is):**
`salesHelper.ts`, `cashSession.ts`, `ReceiptModal.tsx`, `pdfGenerator.ts`, `SaleModal.tsx`, `MySalesView.tsx`, `migration.sql`, all RLS.

---

## 17. Build Verification

```bash
npm run build
# Expected: 0 TypeScript errors

grep -r "sales-form" src/
# Expected: 0 results

grep -r "from.*pos/" src/ | grep -v "^src/app/pos\|^src/components/pos"
# Expected: 0 results (no cross-layer leaks)
```
