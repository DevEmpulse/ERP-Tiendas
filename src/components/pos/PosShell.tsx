'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { EncargadoSidebar } from '@/components/encargado/EncargadoSidebar'
import { EmployeeSidebar } from '@/components/employee/EmployeeSidebar'
import { BarcodeWedgeListener } from './BarcodeWedgeListener'
import { ProductPicker, type ProductPickerHandle } from './ProductPicker'
import { PosCart } from './PosCart'
import { PosSubmitPanel, type SplitAmounts } from './PosSubmitPanel'
import { StockWarningDialog } from './StockWarningDialog'
import { ConfirmSaleDialog } from './ConfirmSaleDialog'
import { ReceiptModal, type ReceiptData } from '@/components/shared/ReceiptModal'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LogOut, Store, Menu, CheckCircle2, AlertCircle, ShoppingCart } from 'lucide-react'
import { fetchOpenSession } from '@/lib/cashSession'
import {
  ADMIN_MENU_ITEMS,
  type AdminSection,
} from '@/components/admin/sidebar-items'
import type { Role } from '@/lib/roles'
import type { CartLine, PosProduct, StockWarningItem, PriceRule } from './types'

interface Branch {
  id: string
  name: string
}

interface Profile {
  id: string
  store_id: string
  name: string | null
  role: Role
  email: string | null
  branch_id: string | null
}

interface PosShellProps {
  profile: Profile
  storeName: string
  branchName: string
  paperWidth: '58mm' | '80mm'
}

function formatCLP(value: number | string): string {
  const num = typeof value === 'number' ? value : parseInt(value as string, 10)
  if (isNaN(num)) return ''
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(num)
}

function newLineId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

export function PosShell({ profile, storeName, branchName, paperWidth }: PosShellProps) {
  const router = useRouter()
  const supabase = createClient()

  const [products, setProducts] = useState<PosProduct[]>([])
  const [lines, setLines] = useState<CartLine[]>([])
  const [priceRules, setPriceRules] = useState<PriceRule[]>([])

  // Admin-only branch selector — admins have no fixed profile.branch_id, so
  // /pos needs its own selector mirroring admin/page.tsx's header pattern.
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'card'>('cash')
  const [isCombined, setIsCombined] = useState(false)
  const [splitAmounts, setSplitAmounts] = useState<SplitAmounts>({ cash: '', transfer: '', card: '' })
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')

  const [discountType, setDiscountType] = useState<'percent' | 'fixed' | null>(null)
  const [discountValue, setDiscountValue] = useState('')

  const [stockWarning, setStockWarning] = useState<StockWarningItem[] | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const [loading, setLoading] = useState(false)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [addedLineId, setAddedLineId] = useState<string | null>(null)

  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [logoutLoading, setLogoutLoading] = useState(false)

  const productPickerRef = useRef<ProductPickerHandle>(null)

  // ── Product catalog fetch (includes sale_price) ───────────────────────────
  useEffect(() => {
    supabase
      .from('products')
      .select('id, name, barcode, sale_price')
      .eq('store_id', profile.store_id)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .then(({ data }) =>
        setProducts(
          (data ?? []).map((p: { id: string; name: string; barcode: string | null; sale_price: number }) => ({
            id: p.id,
            name: p.name,
            barcode: p.barcode,
            salePrice: Number(p.sale_price ?? 0),
          }))
        )
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a fresh client per render (createClient() has no module-level singleton), so it is intentionally omitted to avoid re-running this fetch on every render
  }, [profile.store_id])

  // ── Price rules fetch (quantity-based special-price suggestions) ──────────
  useEffect(() => {
    supabase
      .from('product_price_rules')
      .select('id, product_id, product_name, quantity, special_price, unit_price')
      .then(({ data }) => {
        if (data) {
          setPriceRules(
            data.map((r: Record<string, unknown>) => ({
              ...r,
              quantity: Number(r.quantity),
              special_price: Number(r.special_price),
              unit_price: Number(r.unit_price),
            } as PriceRule))
          )
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a fresh client per render (createClient() has no module-level singleton), so it is intentionally omitted to avoid re-running this fetch on every render
  }, [profile.store_id])

  // Get matching price rule for a cart line — ported verbatim from the
  // deleted sales-form.tsx / SaleModal.tsx logic.
  const getMatchingRule = useCallback((productName: string, quantity: number, productId?: string | null): PriceRule | null => {
    if (productId) {
      const byProductId = priceRules.find(r => r.product_id === productId && r.quantity === quantity)
      if (byProductId) return byProductId
    }
    const lower = productName.trim().toLowerCase()
    return priceRules.find(r => r.product_name.toLowerCase() === lower && r.quantity === quantity) || null
  }, [priceRules])

  // ── Admin-only branch selector: admins have no fixed branch, so fetch the
  // active branch list the same way admin/page.tsx does. Other roles keep
  // using their fixed profile.branch_id and never need this fetch. ─────────
  useEffect(() => {
    if (profile.role !== 'admin') return

    supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error('Error fetching branches:', error)
          return
        }
        const activeBranches = (data as Branch[]) || []
        setBranches(activeBranches)
        setSelectedBranchId(prev => prev ?? activeBranches[0]?.id ?? null)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a fresh client per render (createClient() has no module-level singleton), so it is intentionally omitted to avoid re-running this fetch on every render
  }, [profile.role, profile.store_id])

  // Branch actually used to scope stock checks, cash-session attribution and
  // the sale itself. Non-admin roles keep their fixed profile.branch_id.
  const effectiveBranchId = profile.role === 'admin' ? selectedBranchId : profile.branch_id

  // ── Keyboard shortcut: "/" jumps focus to the product search box ──────────
  // (unless already typing in a text input/textarea, mirroring
  // BarcodeWedgeListener's activeElement tag-checking convention).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        productPickerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = (message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Cart Line Add (smart increment if already in cart) ─────────────────────
  const addLine = useCallback((line: Omit<CartLine, 'lineId' | 'subtotal'>) => {
    setLines(prev => {
      // Check if product already exists in cart (catalog item)
      if (!line.isUnlisted && line.productId !== null) {
        const existingIdx = prev.findIndex(l => !l.isUnlisted && l.productId === line.productId)
        if (existingIdx >= 0) {
          const updated = [...prev]
          const existing = updated[existingIdx]
          const newQty = existing.quantity + (line.quantity || 1)
          const newPrice = line.unitPrice > 0 ? line.unitPrice : existing.unitPrice

          updated[existingIdx] = {
            ...existing,
            quantity: newQty,
            unitPrice: newPrice,
            subtotal: newQty * newPrice,
          }

          setAddedLineId(existing.lineId)
          setTimeout(() => setAddedLineId(null), 1200)
          showToast(`✓ ${line.productName} (x${newQty}) actualizado`, 'info')
          return updated
        }
      }

      // New line
      const lineId = newLineId()
      const newLine: CartLine = {
        ...line,
        lineId,
        subtotal: line.quantity * line.unitPrice,
      }

      setAddedLineId(lineId)
      setTimeout(() => setAddedLineId(null), 1200)
      showToast(`✓ ${line.productName} agregado`, 'info')
      return [...prev, newLine]
    })
  }, [])

  const updateLine = (lineId: string, patch: Partial<CartLine>) => {
    setLines(prev =>
      prev.map(l => l.lineId === lineId ? { ...l, ...patch } : l)
    )
  }

  const removeLine = (lineId: string) => {
    setLines(prev => prev.filter(l => l.lineId !== lineId))
  }

  // ── Barcode scan handler ───────────────────────────────────────────────────
  const handleScan = useCallback((barcode: string) => {
    const match = products.find(p => p.barcode === barcode)
    if (!match) {
      showToast(`Código no encontrado: ${barcode}`, 'error')
      return
    }
    addLine({
      productId: match.id,
      productName: match.name,
      barcode,
      quantity: 1,
      unitPrice: match.salePrice ?? 0,
      isUnlisted: false,
    })
  }, [products, addLine])

  // ── Totals ────────────────────────────────────────────────────────────────
  // Whole-sale discount: adjusts only the final total to charge — never the
  // individual CartLines/sale_items, which always keep full per-line prices.
  const subtotalBeforeDiscount = lines.reduce((sum, l) => sum + l.subtotal, 0)
  const rawDiscountAmount = discountType === 'percent'
    ? Math.round(subtotalBeforeDiscount * (parseFloat(discountValue || '0') / 100))
    : discountType === 'fixed'
      ? parseFloat(discountValue || '0')
      : 0
  const discountAmount = Math.min(Math.max(rawDiscountAmount || 0, 0), subtotalBeforeDiscount)
  const finalTotal = subtotalBeforeDiscount - discountAmount
  const cashNum = parseInt(splitAmounts.cash || '0', 10)
  const transferNum = parseInt(splitAmounts.transfer || '0', 10)
  const cardNum = parseInt(splitAmounts.card || '0', 10)

  // ── Logout ────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    setLogoutLoading(true)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // ── Reset form ────────────────────────────────────────────────────────────
  const resetForm = () => {
    setLines([])
    setPaymentMethod('cash')
    setIsCombined(false)
    setSplitAmounts({ cash: '', transfer: '', card: '' })
    setClientName('')
    setClientPhone('')
    setDiscountType(null)
    setDiscountValue('')
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const doInsert = async () => {
    setLoading(true)
    try {
      const storeId = profile.store_id
      const employeeId = profile.id
      const branchId = effectiveBranchId

      let clientId: string | null = null
      if (clientName.trim()) {
        const { data: existing } = await supabase
          .from('clients')
          .select('id')
          .eq('store_id', storeId)
          .ilike('name', clientName.trim())
          .maybeSingle()
        if (existing) {
          clientId = existing.id
        } else {
          const { data: newC } = await supabase
            .from('clients')
            .insert({ store_id: storeId, name: clientName.trim(), phone: clientPhone.trim() || null })
            .select('id').single()
          if (newC) clientId = newC.id
        }
      }

      const compiledDesc = lines
        .map(l => `${l.quantity}x ${l.productName} (${formatCLP(l.unitPrice)})`)
        .join(', ')

      const openSession = await fetchOpenSession(supabase, branchId)
      const cashSessionId = openSession?.id ?? null

      const buildSaleItems = (saleId: string) =>
        lines.map(l => ({
          store_id: storeId,
          sale_id: saleId,
          product_id: l.productId,
          product_name: l.productName,
          quantity: l.quantity,
          unit_price: l.unitPrice,
          subtotal: l.subtotal,
        }))

      const receiptProducts = lines.map(l => ({
        cant: l.quantity,
        detalle: l.productName,
        p_unit: l.unitPrice,
        importe: l.subtotal,
      }))

      const discountLabel = discountType === 'percent'
        ? `Descuento (${discountValue || '0'}%)`
        : discountType === 'fixed'
          ? 'Descuento'
          : null

      if (isCombined) {
        const txnRef = (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().slice(0, 4) : 'XPOS').toUpperCase()

        const rows: { method: 'cash' | 'transfer' | 'card'; amount: number; description: string }[] = []
        if (cashNum > 0)     rows.push({ method: 'cash',     amount: cashNum,     description: `${compiledDesc} (Efectivo - Ref: #${txnRef})` })
        if (transferNum > 0) rows.push({ method: 'transfer', amount: transferNum, description: `${compiledDesc} (Transferencia - Ref: #${txnRef})` })
        if (cardNum > 0)     rows.push({ method: 'card',     amount: cardNum,     description: `${compiledDesc} (Tarjeta - Ref: #${txnRef})` })

        // Distribute the whole-sale discount_amount proportionally by each
        // row's share of finalTotal; the last row absorbs the rounding
        // remainder so the group's discount_amount values sum exactly to
        // discountAmount. Every row shares the same discount_type/value.
        let assignedDiscount = 0
        const rowDiscounts = rows.map((row, idx) => {
          if (idx === rows.length - 1) {
            return discountAmount - assignedDiscount
          }
          const share = finalTotal > 0 ? Math.round(discountAmount * (row.amount / finalTotal)) : 0
          assignedDiscount += share
          return share
        })

        const salesToInsert: Record<string, unknown>[] = rows.map((row, idx) => ({
          store_id: storeId,
          employee_id: employeeId,
          branch_id: branchId,
          description: row.description,
          payment_method: row.method,
          total_amount: row.amount,
          client_id: clientId,
          cash_session_id: cashSessionId,
          discount_type: discountType,
          discount_value: discountType ? parseFloat(discountValue || '0') : null,
          discount_amount: rowDiscounts[idx],
        }))

        const { data: insertedSales, error } = await supabase.from('sales').insert(salesToInsert).select('id')
        if (error) throw error

        const items = (insertedSales ?? []).flatMap((s: { id: string }) => buildSaleItems(s.id))
        if (items.length > 0) {
          const { error: itemsErr } = await supabase.from('sale_items').insert(items)
          if (itemsErr) throw itemsErr
        }

        setReceiptData({
          storeName,
          employeeName: profile.name ?? 'Colaborador/a',
          clientName: clientName.trim() || null,
          clientPhone: clientPhone.trim() || null,
          createdAt: new Date().toISOString(),
          products: receiptProducts,
          payments: rows.map(r => ({ method: r.method, amount: r.amount })),
          totalAmount: cashNum + transferNum + cardNum,
          isCombined: true,
          paperWidth,
          subtotal: subtotalBeforeDiscount,
          discountLabel,
          discountAmount,
        })
      } else {
        const { data: inserted, error } = await supabase
          .from('sales')
          .insert({
            store_id: storeId,
            employee_id: employeeId,
            branch_id: branchId,
            description: compiledDesc,
            payment_method: paymentMethod,
            total_amount: finalTotal,
            client_id: clientId,
            cash_session_id: cashSessionId,
            discount_type: discountType,
            discount_value: discountType ? parseFloat(discountValue || '0') : null,
            discount_amount: discountAmount,
          })
          .select('id').single()
        if (error) throw error

        if (inserted) {
          const { error: itemsErr } = await supabase.from('sale_items').insert(buildSaleItems(inserted.id))
          if (itemsErr) throw itemsErr
        }

        setReceiptData({
          storeName,
          employeeName: profile.name ?? 'Colaborador/a',
          clientName: clientName.trim() || null,
          clientPhone: clientPhone.trim() || null,
          createdAt: new Date().toISOString(),
          products: receiptProducts,
          payments: [{ method: paymentMethod, amount: finalTotal }],
          totalAmount: finalTotal,
          isCombined: false,
          paperWidth,
          subtotal: subtotalBeforeDiscount,
          discountLabel,
          discountAmount,
        })
      }

      setShowReceipt(true)
    } catch (err) {
      console.error('Error registering sale:', err)
      showToast(err instanceof Error ? err.message : 'Error al registrar la venta', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Submit validation ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (profile.role === 'admin' && !effectiveBranchId) {
      showToast('Seleccioná una sucursal para vender', 'error')
      return
    }

    if (lines.length === 0) {
      showToast('Agregá al menos un producto al carrito', 'error')
      return
    }

    if (finalTotal <= 0) {
      showToast('El total debe ser mayor a $0', 'error')
      return
    }

    if (isCombined) {
      const combinedTotal = cashNum + transferNum + cardNum
      if (combinedTotal !== finalTotal) {
        showToast(`La suma combinada ($${formatCLP(combinedTotal)}) no coincide con el total ($${formatCLP(finalTotal)})`, 'error')
        return
      }
    }

    setShowConfirmDialog(true)
  }

  const handleConfirmSale = async () => {
    setShowConfirmDialog(false)

    const catalogProductIds = lines.filter(l => l.productId !== null).map(l => l.productId as string)

    if (catalogProductIds.length > 0 && effectiveBranchId) {
      const { data: stockRows } = await supabase
        .from('branch_stock')
        .select('product_id, current_stock')
        .eq('branch_id', effectiveBranchId)
        .in('product_id', catalogProductIds)

      const stockMap = new Map(
        (stockRows ?? []).map((r: { product_id: string; current_stock: number }) => [r.product_id, r.current_stock])
      )

      const offenders: StockWarningItem[] = lines
        .filter(l => l.productId !== null && l.quantity > (stockMap.get(l.productId!) ?? 0))
        .map(l => ({
          productId: l.productId!,
          productName: l.productName,
          requested: l.quantity,
          available: stockMap.get(l.productId!) ?? 0,
        }))

      if (offenders.length > 0) {
        setStockWarning(offenders)
        return
      }
    }

    await doInsert()
  }

  const handleStockConfirm = async () => {
    setStockWarning(null)
    await doInsert()
  }

  const handleReceiptClose = () => {
    setShowReceipt(false)
    setReceiptData(null)
    resetForm()
    showToast('¡Venta registrada con éxito!', 'success')
  }

  // ── Sidebar Section Navigation ─────────────────────────────────────────────
  const handleSetSection = (section: AdminSection) => {
    if (section === 'pos') return // already on POS
    if (section === 'analytics') {
      router.push('/analytics')
      return
    }

    if (profile.role === 'admin') {
      router.push(section === 'dashboard' ? '/admin' : `/admin?section=${section}`)
      return
    }
    if (profile.role === 'encargado') {
      router.push(section === 'dashboard' ? '/encargado' : `/encargado?section=${section}`)
      return
    }
    // employee / caja
    router.push(section === 'my_sales' ? '/employee' : `/employee?section=${section}`)
  }

  const displayName = profile.name || (profile.email ? profile.email.split('@')[0] : 'Colaborador/a')

  // ── Sidebar Dispatch by Role ───────────────────────────────────────────────
  const sidebarProps = {
    currentSection: 'pos' as AdminSection,
    setSection: handleSetSection,
    storeName,
    adminName: displayName,
    adminEmail: profile.email ?? '',
    isOpen: isSidebarOpen,
    setIsOpen: setIsSidebarOpen,
    onLogout: handleLogout,
  }

  const renderSidebar = () => {
    switch (profile.role) {
      case 'admin':
        return <AdminSidebar {...sidebarProps} items={ADMIN_MENU_ITEMS} portalLabel="Portal Admin" />
      case 'encargado':
        return <EncargadoSidebar {...sidebarProps} />
      default:
        return <EmployeeSidebar {...sidebarProps} />
    }
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans text-zinc-900 dark:text-zinc-50 antialiased">

      <BarcodeWedgeListener onScan={handleScan} />

      {/* Role-Aware Sidebar */}
      {renderSidebar()}

      <div className="flex-1 md:pl-64 flex flex-col min-w-0 min-h-screen">

        {/* Header */}
        <header className="sticky top-0 z-20 h-16 w-full border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-900/80 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200/60 dark:border-zinc-800 cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="hidden md:flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                <Store className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
              </span>
              <h2 className="text-xs sm:text-sm font-bold text-zinc-800 dark:text-zinc-200">{storeName}</h2>
              {profile.role !== 'admin' && branchName && (
                <span className="text-xs text-zinc-400 font-medium">· {branchName}</span>
              )}
            </div>

            {/* Admin-only branch selector — admins have no fixed branch_id */}
            {profile.role === 'admin' && branches.length > 0 && (
              <Select
                value={selectedBranchId ?? ''}
                onValueChange={(v) => setSelectedBranchId(v as string)}
              >
                <SelectTrigger size="sm" className="h-8 gap-1.5 rounded-lg border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
                  <Store className="h-3.5 w-3.5 text-zinc-400" />
                  <SelectValue placeholder="Sucursal...">
                    {(value: string | null) => branches.find((b) => b.id === value)?.name ?? 'Sucursal...'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Button
            variant="outline" size="xs" onClick={handleLogout} disabled={logoutLoading}
            className="h-8 gap-1.5 rounded-lg border-zinc-200 text-zinc-600 hover:text-red-600 hover:bg-red-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-red-400 dark:hover:bg-red-950/20 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </header>

        {/* Floating Toast */}
        {toast && (
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold transition-all whitespace-nowrap animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ${
            toast.type === 'success' ? 'bg-emerald-600 text-white shadow-emerald-600/20'
            : toast.type === 'error' ? 'bg-red-600 text-white shadow-red-600/20'
            : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-zinc-950/20'
          }`}>
            {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
            {toast.type === 'error'   && <AlertCircle  className="h-4 w-4 shrink-0" />}
            {toast.type === 'info'    && <ShoppingCart className="h-4 w-4 shrink-0 text-emerald-400 dark:text-emerald-600" />}
            {toast.message}
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Punto de Venta</h1>
              <p className="text-xs text-zinc-400 mt-0.5">
                Buscá productos por nombre o escaneá con el lector de código de barras
              </p>
            </div>
          </div>

          {/* Product Picker Search Bar */}
          <div className="mb-5">
            <ProductPicker
              ref={productPickerRef}
              products={products}
              onAddLine={addLine}
              onIdleEnter={handleSubmit}
            />
          </div>

          {/* POS Grid: Cart + Submit Panel */}
          <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xs">
              <PosCart
                lines={lines}
                addedLineId={addedLineId}
                onUpdateLine={updateLine}
                onRemoveLine={removeLine}
                getMatchingRule={getMatchingRule}
              />
            </div>

            <PosSubmitPanel
              subtotal={subtotalBeforeDiscount}
              paymentMethod={paymentMethod}
              isCombined={isCombined}
              splitAmounts={splitAmounts}
              clientName={clientName}
              clientPhone={clientPhone}
              loading={loading}
              discountType={discountType}
              discountValue={discountValue}
              discountAmount={discountAmount}
              finalTotal={finalTotal}
              onPaymentMethodChange={setPaymentMethod}
              onIsCombinedChange={setIsCombined}
              onSplitAmountsChange={setSplitAmounts}
              onClientNameChange={setClientName}
              onClientPhoneChange={setClientPhone}
              onDiscountTypeChange={setDiscountType}
              onDiscountValueChange={setDiscountValue}
              onSubmit={handleSubmit}
            />
          </div>
        </main>
      </div>

      <ConfirmSaleDialog
        open={showConfirmDialog}
        total={finalTotal}
        onConfirm={handleConfirmSale}
        onCancel={() => setShowConfirmDialog(false)}
      />

      <StockWarningDialog
        items={stockWarning}
        onConfirm={handleStockConfirm}
        onCancel={() => setStockWarning(null)}
      />

      <ReceiptModal open={showReceipt} onClose={handleReceiptClose} data={receiptData} />
    </div>
  )
}
