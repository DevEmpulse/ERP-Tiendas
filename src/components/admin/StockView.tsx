'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StockAdjustDialog } from '@/components/stock/StockAdjustDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tags,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ShieldAlert,
  Package,
  Hash,
  DollarSign,
  Boxes,
  Power,
  PowerOff,
  Barcode as BarcodeIcon,
  History,
  Printer,
  FileSpreadsheet,
  PackagePlus,
  Search,
  FilterX,
  X,
  SlidersHorizontal,
} from 'lucide-react'
import { useToast, Toaster } from '@/components/ui/toast'
import { ProductLabelPrinter, type LabelProduct } from './ProductLabel'
import { ProductImportDialog } from './ProductImportDialog'
import { ProductExportButton } from './ProductExportButton'
import { PurchaseModal } from './PurchaseModal'
import { PurchasesHistory } from './PurchasesHistory'
import { canRecordPurchase } from '@/lib/roles'
import type { Purchase } from '@/lib/purchasesHelper'

// ─── Types ───────────────────────────────────────────────────────────────────

interface StockViewProps {
  storeId: string | null
  branchId: string | null
  branchName?: string
  role?: string | null
  userId?: string | null
  userBranchId?: string | null
}

interface Category {
  id: string
  name: string
}

interface Product {
  id: string
  store_id: string
  category_id: string | null
  name: string
  barcode: string
  purchase_price: number
  sale_price: number
  is_active: boolean
}

interface StockMovement {
  id: string
  reason: 'sale' | 'sale_reversal' | 'manual_adjustment' | 'restock' | 'import_ingress' | 'purchase' | 'purchase_reversal'
  quantity_delta: number
  applied_delta: number
  resulting_balance: number
  note: string | null
  created_at: string
}

interface PriceRule {
  id: string
  store_id: string
  product_id: string | null
  product_name: string
  quantity: number
  special_price: number
  unit_price: number
  created_at: string
}

const REASON_LABELS: Record<StockMovement['reason'], string> = {
  sale: 'Venta',
  sale_reversal: 'Reversión de venta',
  manual_adjustment: 'Ajuste manual',
  restock: 'Reposición',
  import_ingress: 'Ingreso por importación',
  purchase: 'Compra',
  purchase_reversal: 'Reversión de compra',
}

const emptyPriceRuleForm = () => ({
  product_name: '',
  quantity: '',
  special_price: '',
  unit_price: '',
})

const emptyProductForm = () => ({
  name: '',
  category_id: '' as string,
  purchase_price: '',
  sale_price: '',
})

const formatCLP = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value)

export function StockView({ storeId, branchId, branchName, role = null, userId = null, userBranchId = null }: StockViewProps) {
  const supabase = createClient()
  const { toasts, toast, dismiss } = useToast()

  const [activeTab, setActiveTab] = useState<'productos' | 'precios' | 'compras'>('productos')

  // ── Products tab state ─────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [branchStock, setBranchStock] = useState<Map<string, number>>(new Map())
  const [branchMinStock, setBranchMinStock] = useState<Map<string, number>>(new Map())
  const [productsLoading, setProductsLoading] = useState(true)

  // ── Search & Filter state ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock' | 'low_stock'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productForm, setProductForm] = useState(emptyProductForm())
  const [savingProduct, setSavingProduct] = useState(false)
  const [productErrorMsg, setProductErrorMsg] = useState<string | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)

  const [toggleProductTarget, setToggleProductTarget] = useState<Product | null>(null)
  const [togglingProduct, setTogglingProduct] = useState(false)

  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null)

  const [historyTarget, setHistoryTarget] = useState<Product | null>(null)
  const [historyMovements, setHistoryMovements] = useState<StockMovement[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set())
  const [labelQueue, setLabelQueue] = useState<LabelProduct[]>([])

  const [isImportOpen, setIsImportOpen] = useState(false)
  const [lastImported, setLastImported] = useState<LabelProduct[]>([])

  const loadCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (!error) setCategories((data as Category[]) || [])
  }, [supabase])

  const loadProducts = useCallback(async () => {
    if (!storeId) return
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, store_id, category_id, name, barcode, purchase_price, sale_price, is_active')
        .order('name', { ascending: true })
      if (error) throw error
      setProducts(
        (data || []).map((p: Record<string, unknown>) => ({
          ...p,
          purchase_price: Number(p.purchase_price),
          sale_price: Number(p.sale_price),
        } as Product))
      )

      if (branchId) {
        const { data: stockRows, error: stockErr } = await supabase
          .from('branch_stock')
          .select('product_id, current_stock, min_stock')
          .eq('branch_id', branchId)
        if (!stockErr) {
          const rows = (stockRows as { product_id: string; current_stock: number; min_stock: number }[]) || []
          setBranchStock(new Map(rows.map((s) => [s.product_id, s.current_stock])))
          setBranchMinStock(new Map(rows.map((s) => [s.product_id, s.min_stock])))
        }
      } else {
        setBranchStock(new Map())
        setBranchMinStock(new Map())
      }
    } catch (err: unknown) {
      console.error('Error loading products:', err)
    } finally {
      setProductsLoading(false)
    }
  }, [storeId, branchId, supabase])

  // Initial loads are inlined (not a bare `useEffect(() => loadX(), [loadX])`) to match
  // this codebase's established mount-effect pattern (see BranchManager.tsx); the
  // `useCallback` loaders above stay reusable for post-mutation reloads in handlers.
  useEffect(() => {
    let ignore = false
    async function run() {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (!ignore && !error) setCategories((data as Category[]) || [])
    }
    run()
    return () => { ignore = true }
  }, [supabase])

  useEffect(() => {
    let ignore = false
    async function run() {
      if (!storeId) return
      try {
        const { data, error } = await supabase
          .from('products')
          .select('id, store_id, category_id, name, barcode, purchase_price, sale_price, is_active')
          .order('name', { ascending: true })
        if (error) throw error
        if (ignore) return
        setProducts(
          (data || []).map((p: Record<string, unknown>) => ({
            ...p,
            purchase_price: Number(p.purchase_price),
            sale_price: Number(p.sale_price),
          } as Product))
        )

        if (branchId) {
          const { data: stockRows, error: stockErr } = await supabase
            .from('branch_stock')
            .select('product_id, current_stock, min_stock')
            .eq('branch_id', branchId)
          if (!ignore && !stockErr) {
            const rows = (stockRows as { product_id: string; current_stock: number; min_stock: number }[]) || []
            setBranchStock(new Map(rows.map((s) => [s.product_id, s.current_stock])))
            setBranchMinStock(new Map(rows.map((s) => [s.product_id, s.min_stock])))
          }
        } else if (!ignore) {
          setBranchStock(new Map())
          setBranchMinStock(new Map())
        }
      } catch (err: unknown) {
        console.error('Error loading products:', err)
      } finally {
        if (!ignore) setProductsLoading(false)
      }
    }
    run()
    return () => { ignore = true }
  }, [storeId, branchId, supabase])

  // ── Product create / edit ──────────────────────────────────────────────────

  const openCreateProduct = () => {
    setEditingProduct(null)
    setProductForm(emptyProductForm())
    setProductErrorMsg(null)
    setNewCategoryName('')
    setIsProductModalOpen(true)
  }

  const openEditProduct = (product: Product) => {
    setEditingProduct(product)
    setProductForm({
      name: product.name,
      category_id: product.category_id || '',
      purchase_price: String(product.purchase_price),
      sale_price: String(product.sale_price),
    })
    setProductErrorMsg(null)
    setNewCategoryName('')
    setIsProductModalOpen(true)
  }

  const handleCreateCategoryInline = async () => {
    const name = newCategoryName.trim()
    if (!name || !storeId) return
    setCreatingCategory(true)
    try {
      const { data, error } = await supabase
        .from('categories')
        .insert({ store_id: storeId, name })
        .select('id, name')
        .single()
      if (error) throw error
      setCategories((prev) => [...prev, data as Category].sort((a, b) => a.name.localeCompare(b.name)))
      setProductForm((prev) => ({ ...prev, category_id: (data as Category).id }))
      setNewCategoryName('')
      toast('Categoría creada.', 'success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear la categoría.'
      toast(msg, 'error')
    } finally {
      setCreatingCategory(false)
    }
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId) return

    const name = productForm.name.trim()
    const purchase_price = parseFloat(productForm.purchase_price) || 0
    const sale_price = parseFloat(productForm.sale_price) || 0

    if (!name) { setProductErrorMsg('El nombre del producto no puede estar vacío.'); return }
    if (sale_price < 0 || purchase_price < 0) { setProductErrorMsg('Los precios no pueden ser negativos.'); return }

    const isEditing = !!editingProduct
    const editingId = editingProduct?.id
    setIsProductModalOpen(false)
    setProductErrorMsg(null)
    setSavingProduct(true)

    try {
      if (isEditing && editingId) {
        // `barcode` is never part of this payload — it is system-generated and immutable.
        const { error } = await supabase
          .from('products')
          .update({
            name,
            category_id: productForm.category_id || null,
            purchase_price,
            sale_price,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingId)
        if (error) throw error
        toast('Producto actualizado.', 'success')
      } else {
        // `barcode` omitted -> column DEFAULT public.next_product_code() generates it.
        const { error } = await supabase
          .from('products')
          .insert({
            store_id: storeId,
            name,
            category_id: productForm.category_id || null,
            purchase_price,
            sale_price,
          })
        if (error) throw error
        toast('Producto creado.', 'success')
      }
      await loadProducts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar el producto.'
      toast(msg, 'error')
      await loadProducts()
    } finally {
      setSavingProduct(false)
    }
  }

  const confirmToggleProduct = (product: Product) => setToggleProductTarget(product)

  const handleToggleProduct = async () => {
    if (!toggleProductTarget) return
    const target = toggleProductTarget
    const nextActive = !target.is_active
    setToggleProductTarget(null)
    setTogglingProduct(true)
    try {
      const { error } = await supabase
        .from('products')
        .update({ is_active: nextActive, updated_at: new Date().toISOString() })
        .eq('id', target.id)
      if (error) throw error
      toast(nextActive ? 'Producto reactivado.' : 'Producto desactivado.', 'success')
      await loadProducts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar el producto.'
      toast(msg, 'error')
      await loadProducts()
    } finally {
      setTogglingProduct(false)
    }
  }

  // ── Stock adjustment ───────────────────────────────────────────────────────
  const openAdjustDialog = (product: Product) => {
    setAdjustTarget(product)
  }

  // ── Movement history ───────────────────────────────────────────────────────

  const openHistoryDialog = async (product: Product) => {
    setHistoryTarget(product)
    if (!branchId) return
    setLoadingHistory(true)
    try {
      const { data, error } = await supabase
        .from('stock_movements')
        .select('id, reason, quantity_delta, applied_delta, resulting_balance, note, created_at')
        .eq('branch_id', branchId)
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      setHistoryMovements((data as StockMovement[]) || [])
    } catch (err: unknown) {
      console.error('Error loading stock movements:', err)
      setHistoryMovements([])
    } finally {
      setLoadingHistory(false)
    }
  }

  // ── Filtered products calculation ──────────────────────────────────────────

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      // Search: name or barcode
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = (product.name || '').toLowerCase().includes(q)
        const matchBarcode = (product.barcode || '').toLowerCase().includes(q)
        if (!matchName && !matchBarcode) return false
      }

      // Category
      if (categoryFilter !== 'all') {
        if (categoryFilter === 'none') {
          if (product.category_id !== null && product.category_id !== '') return false
        } else if (product.category_id !== categoryFilter) {
          return false
        }
      }

      // Status (Active / Inactive)
      if (statusFilter === 'active' && !product.is_active) return false
      if (statusFilter === 'inactive' && product.is_active) return false

      // Stock level (applies when a branch is selected)
      if (stockFilter !== 'all' && branchId) {
        const currentStock = branchStock.get(product.id) ?? 0
        if (stockFilter === 'in_stock' && currentStock <= 0) return false
        if (stockFilter === 'out_of_stock' && currentStock !== 0) return false
        if (stockFilter === 'low_stock' && (currentStock <= 0 || currentStock > 5)) return false
      }

      return true
    })
  }, [products, searchQuery, categoryFilter, statusFilter, stockFilter, branchId, branchStock])

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    categoryFilter !== 'all' ||
    stockFilter !== 'all' ||
    statusFilter !== 'all'

  const resetFilters = () => {
    setSearchQuery('')
    setCategoryFilter('all')
    setStockFilter('all')
    setStatusFilter('all')
  }

  // ── Multi-select & label printing ──────────────────────────────────────────

  const allFilteredSelected =
    filteredProducts.length > 0 &&
    filteredProducts.every((p) => selectedProductIds.has(p.id))

  const someFilteredSelected =
    filteredProducts.some((p) => selectedProductIds.has(p.id)) && !allFilteredSelected

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedProductIds((prev) => {
        const next = new Set(prev)
        for (const p of filteredProducts) {
          next.delete(p.id)
        }
        return next
      })
    } else {
      setSelectedProductIds((prev) => {
        const next = new Set(prev)
        for (const p of filteredProducts) {
          next.add(p.id)
        }
        return next
      })
    }
  }

  const toggleSelectProduct = (id: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toLabelProduct = (p: Product): LabelProduct => ({
    id: p.id, barcode: p.barcode, name: p.name, sale_price: p.sale_price,
  })

  const handlePrintSingle = (product: Product) => setLabelQueue([toLabelProduct(product)])

  const handlePrintSelected = () => {
    const selected = products.filter((p) => selectedProductIds.has(p.id))
    if (selected.length === 0) return
    setLabelQueue(selected.map(toLabelProduct))
  }

  const handleImported = (createdLabelProducts: LabelProduct[]) => {
    setLastImported(createdLabelProducts)
    loadProducts()
    loadCategories()
  }

  const handlePrintImported = () => {
    if (lastImported.length === 0) return
    setLabelQueue(lastImported)
  }

  // ── Price rules tab (unchanged behaviour, moved into its own tab) ──────────

  const [rules, setRules] = useState<PriceRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(true)

  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<PriceRule | null>(null)
  const [ruleForm, setRuleForm] = useState(emptyPriceRuleForm())
  const [savingRule, setSavingRule] = useState(false)
  const [ruleErrorMsg, setRuleErrorMsg] = useState<string | null>(null)

  const [deleteRuleConfirmId, setDeleteRuleConfirmId] = useState<string | null>(null)
  const [deletingRule, setDeletingRule] = useState(false)

  const loadRules = useCallback(async () => {
    if (!storeId) return
    try {
      const { data, error } = await supabase
        .from('product_price_rules')
        .select('*')
        .order('product_name', { ascending: true })
      if (error) throw error
      setRules((data || []).map((r: Record<string, unknown>) => ({
        ...r,
        special_price: Number(r.special_price),
        unit_price: Number(r.unit_price),
        quantity: Number(r.quantity),
      } as PriceRule)))
    } catch (err: unknown) {
      console.error('Error loading price rules:', err)
    } finally {
      setRulesLoading(false)
    }
  }, [storeId, supabase])

  useEffect(() => {
    let ignore = false
    async function run() {
      if (!storeId) return
      try {
        const { data, error } = await supabase
          .from('product_price_rules')
          .select('*')
          .order('product_name', { ascending: true })
        if (error) throw error
        if (!ignore) {
          setRules((data || []).map((r: Record<string, unknown>) => ({
            ...r,
            special_price: Number(r.special_price),
            unit_price: Number(r.unit_price),
            quantity: Number(r.quantity),
          } as PriceRule)))
        }
      } catch (err: unknown) {
        console.error('Error loading price rules:', err)
      } finally {
        if (!ignore) setRulesLoading(false)
      }
    }
    run()
    return () => { ignore = true }
  }, [storeId, supabase])

  const handleRuleFormChange = (field: string, rawValue: string) => {
    setRuleForm(prev => {
      const next = { ...prev, [field]: rawValue }
      if (field === 'special_price' || field === 'quantity') {
        const sp = parseFloat(field === 'special_price' ? rawValue : prev.special_price) || 0
        const qty = parseInt(field === 'quantity' ? rawValue : prev.quantity, 10) || 0
        if (sp > 0 && qty > 0) {
          next.unit_price = Math.round(sp / qty).toString()
        }
      }
      return next
    })
  }

  const openCreateRuleModal = () => {
    setEditingRule(null)
    setRuleForm(emptyPriceRuleForm())
    setRuleErrorMsg(null)
    setIsRuleModalOpen(true)
  }

  const openEditRuleModal = (rule: PriceRule) => {
    setEditingRule(rule)
    setRuleForm({
      product_name: rule.product_name,
      quantity: rule.quantity.toString(),
      special_price: rule.special_price.toString(),
      unit_price: rule.unit_price.toString(),
    })
    setRuleErrorMsg(null)
    setIsRuleModalOpen(true)
  }

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId) return

    const product_name = ruleForm.product_name.trim()
    const quantity = parseInt(ruleForm.quantity, 10)
    const special_price = parseFloat(ruleForm.special_price)
    const unit_price = parseFloat(ruleForm.unit_price)

    if (!product_name) { setRuleErrorMsg('El nombre del producto no puede estar vacío.'); return }
    if (!quantity || quantity <= 0) { setRuleErrorMsg('La cantidad debe ser mayor a 0.'); return }
    if (!special_price || special_price <= 0) { setRuleErrorMsg('El precio especial debe ser mayor a 0.'); return }
    if (!unit_price || unit_price <= 0) { setRuleErrorMsg('El precio unitario debe ser mayor a 0.'); return }

    const isEditing = !!editingRule
    const editingId = editingRule?.id
    setIsRuleModalOpen(false)
    setRuleErrorMsg(null)
    setSavingRule(true)

    try {
      if (isEditing && editingId) {
        const { error } = await supabase
          .from('product_price_rules')
          .update({ product_name, quantity, special_price, unit_price })
          .eq('id', editingId)
        if (error) throw error
        toast('Regla actualizada.', 'success')
      } else {
        const { error } = await supabase
          .from('product_price_rules')
          .insert({ store_id: storeId, product_name, quantity, special_price, unit_price })
        if (error) throw error
        toast('Regla de precio creada.', 'success')
      }
      await loadRules()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar la regla.'
      toast(msg, 'error')
      await loadRules()
    } finally {
      setSavingRule(false)
    }
  }

  const handleDeleteRule = async (id: string) => {
    setDeleteRuleConfirmId(null)
    setRules(prev => prev.filter(r => r.id !== id))
    setDeletingRule(true)
    try {
      const { error } = await supabase
        .from('product_price_rules')
        .delete()
        .eq('id', id)
      if (error) throw error
      toast('Regla eliminada correctamente.', 'success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al eliminar.'
      toast(msg, 'error')
      await loadRules()
    } finally {
      setDeletingRule(false)
    }
  }

  // ── Purchases tab (Compras — migration.sql §23) ────────────────────────────

  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [purchasesLoading, setPurchasesLoading] = useState(true)
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false)
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null)

  const canManagePurchases = canRecordPurchase(role, userBranchId, branchId)

  const loadPurchases = useCallback(async () => {
    if (!storeId) return
    try {
      const { data, error } = await supabase
        .from('purchases')
        .select('id, store_id, branch_id, supplier_name, purchase_date, note, created_by, created_at, purchase_items(id, product_id, product_name, quantity, unit_cost, subtotal)')
        .order('purchase_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      setPurchases((data as unknown as Purchase[]) || [])
    } catch (err: unknown) {
      console.error('Error loading purchases:', err)
    } finally {
      setPurchasesLoading(false)
    }
  }, [storeId, supabase])

  useEffect(() => {
    let ignore = false
    async function run() {
      if (!storeId || activeTab !== 'compras') return
      try {
        const { data, error } = await supabase
          .from('purchases')
          .select('id, store_id, branch_id, supplier_name, purchase_date, note, created_by, created_at, purchase_items(id, product_id, product_name, quantity, unit_cost, subtotal)')
          .order('purchase_date', { ascending: false })
          .order('created_at', { ascending: false })
        if (error) throw error
        if (!ignore) setPurchases((data as unknown as Purchase[]) || [])
      } catch (err: unknown) {
        console.error('Error loading purchases:', err)
      } finally {
        if (!ignore) setPurchasesLoading(false)
      }
    }
    run()
    return () => { ignore = true }
  }, [storeId, activeTab, supabase])

  const openCreatePurchase = () => {
    setEditingPurchase(null)
    setIsPurchaseModalOpen(true)
  }

  const openEditPurchase = (purchase: Purchase) => {
    setEditingPurchase(purchase)
    setIsPurchaseModalOpen(true)
  }

  const handlePurchaseSuccess = async () => {
    await loadPurchases()
    await loadProducts()
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Toaster toasts={toasts} dismiss={dismiss} />

      <ProductLabelPrinter products={labelQueue} onPrinted={() => setLabelQueue([])} />

      <ProductImportDialog
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        storeId={storeId}
        onImported={handleImported}
      />

      {/* Purchase create / edit modal (Compras tab) */}
      <PurchaseModal
        isOpen={isPurchaseModalOpen}
        onOpenChange={setIsPurchaseModalOpen}
        storeId={storeId}
        branchId={branchId}
        createdBy={userId}
        products={products.map((p) => ({ id: p.id, name: p.name, purchase_price: p.purchase_price }))}
        purchaseToEdit={editingPurchase}
        onSuccess={handlePurchaseSuccess}
      />

      {/* Deactivate/Reactivate product confirm */}
      <Dialog open={!!toggleProductTarget} onOpenChange={(open) => { if (!open) setToggleProductTarget(null) }}>
        <DialogContent className="sm:max-w-sm bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              {toggleProductTarget?.is_active ? '¿Desactivar este producto?' : '¿Reactivar este producto?'}
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
              {toggleProductTarget?.is_active
                ? 'El producto dejará de aparecer como activo, pero su historial de ventas y movimientos se conserva.'
                : 'El producto volverá a estar disponible.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setToggleProductTarget(null)}
              disabled={togglingProduct}
              className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleToggleProduct}
              disabled={togglingProduct}
              className={`h-9 px-4 rounded-xl text-white text-xs font-semibold cursor-pointer flex items-center gap-1.5 ${
                toggleProductTarget?.is_active ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {togglingProduct ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : toggleProductTarget?.is_active ? (
                <PowerOff className="h-3.5 w-3.5" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
              {toggleProductTarget?.is_active ? 'Desactivar' : 'Reactivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product create / edit modal */}
      <Dialog open={isProductModalOpen} onOpenChange={setIsProductModalOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Package className="h-4 w-4 text-zinc-400" />
              {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {editingProduct
                ? 'El código de barras no se puede editar.'
                : 'El código de barras (EAN-8) se genera automáticamente al guardar.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveProduct}>
            <div className="px-6 py-5 space-y-4">
              {editingProduct && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <BarcodeIcon className="h-3.5 w-3.5 text-zinc-400" />
                    Código de Barras
                  </Label>
                  <div className="h-10 px-3 flex items-center rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/70 text-sm font-mono tracking-widest text-zinc-500">
                    {editingProduct.barcode}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="product-name" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-zinc-400" />
                  Nombre del Producto
                </Label>
                <Input
                  id="product-name"
                  placeholder="Ej: Remera, Gorra, Jean..."
                  value={productForm.name}
                  onChange={(e) => setProductForm(prev => ({ ...prev, name: e.target.value }))}
                  disabled={savingProduct}
                  className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  Categoría
                </Label>
                <Select
                  value={productForm.category_id || ''}
                  onValueChange={(v) => setProductForm(prev => ({ ...prev, category_id: (v as string) || '' }))}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border-zinc-200 dark:border-zinc-700 text-sm">
                    <SelectValue placeholder="Sin categoría">
                      {(value: string | null) => categories.find((c) => c.id === value)?.name ?? 'Sin categoría'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Sin categoría</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-1.5 pt-1">
                  <Input
                    placeholder="Nueva categoría..."
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    disabled={creatingCategory}
                    className="h-8 rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCreateCategoryInline}
                    disabled={creatingCategory || !newCategoryName.trim()}
                    className="h-8 px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer shrink-0"
                  >
                    {creatingCategory ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Agregar'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-zinc-400" />
                    Precio Costo
                  </Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={productForm.purchase_price}
                    onChange={(e) => setProductForm(prev => ({ ...prev, purchase_price: e.target.value.replace(/[^\d.]/g, '') }))}
                    disabled={savingProduct}
                    className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-bold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                    Precio Venta
                  </Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={productForm.sale_price}
                    onChange={(e) => setProductForm(prev => ({ ...prev, sale_price: e.target.value.replace(/[^\d.]/g, '') }))}
                    disabled={savingProduct}
                    className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-bold focus-visible:ring-emerald-500 focus-visible:border-emerald-500"
                  />
                </div>
              </div>

              {productErrorMsg && (
                <div className="flex items-start gap-2 p-3 text-xs text-red-600 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-xl font-medium">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{productErrorMsg}</span>
                </div>
              )}
            </div>

            <DialogFooter className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsProductModalOpen(false)}
                className="h-9 px-4 rounded-xl border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-9 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
              >
                {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Adjust stock dialog */}
      <StockAdjustDialog
        product={adjustTarget}
        onOpenChange={(open) => { if (!open) setAdjustTarget(null) }}
        branchId={branchId}
        branchName={branchName}
        currentStock={adjustTarget ? (branchStock.get(adjustTarget.id) ?? 0) : undefined}
        minStock={adjustTarget ? (branchMinStock.get(adjustTarget.id) ?? 0) : undefined}
        onAdjusted={async () => {
          await loadProducts()
        }}
      />

      {/* Movement history dialog */}
      <Dialog open={!!historyTarget} onOpenChange={(open) => { if (!open) setHistoryTarget(null) }}>
        <DialogContent className="sm:max-w-lg bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl p-0 overflow-hidden max-h-[80vh] flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <History className="h-4 w-4 text-zinc-400" />
              Historial de Movimientos
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {historyTarget?.name} · {branchName ?? 'Sucursal seleccionada'} · solo lectura
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-4 overflow-y-auto">
            {loadingHistory ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800/50 animate-pulse" />)}
              </div>
            ) : historyMovements.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-8">Sin movimientos registrados para esta sucursal.</p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {historyMovements.map((m) => (
                  <div key={m.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-700 dark:text-zinc-200">{REASON_LABELS[m.reason]}</p>
                      <p className="text-zinc-400 text-[10px]">
                        {new Date(m.created_at).toLocaleString('es-CL')}
                        {m.note ? ` · ${m.note}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-bold tabular-nums ${m.applied_delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {m.applied_delta >= 0 ? '+' : ''}{m.applied_delta}
                      </p>
                      <p className="text-zinc-400 text-[10px]">saldo: {m.resulting_balance}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryTarget(null)}
              className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer"
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price rule delete confirm */}
      <Dialog open={!!deleteRuleConfirmId} onOpenChange={(open) => { if (!open) setDeleteRuleConfirmId(null) }}>
        <DialogContent className="sm:max-w-sm bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              ¿Eliminar esta regla?
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
              Esta acción no se puede deshacer. La regla de precio será eliminada permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteRuleConfirmId(null)}
              disabled={deletingRule}
              className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => deleteRuleConfirmId && handleDeleteRule(deleteRuleConfirmId)}
              disabled={deletingRule}
              className="h-9 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer flex items-center gap-1.5"
            >
              {deletingRule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price rule create / edit modal */}
      <Dialog open={isRuleModalOpen} onOpenChange={setIsRuleModalOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Tags className="h-4 w-4 text-zinc-400" />
              {editingRule ? 'Editar Regla de Precio' : 'Nueva Regla de Precio'}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {editingRule
                ? 'Modificá los datos de la regla de precio especial.'
                : 'Definí un precio especial para una cantidad específica de un producto.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveRule}>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rule-product-name" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-zinc-400" />
                  Nombre del Producto
                </Label>
                <Input
                  id="rule-product-name"
                  placeholder="Ej: Remera, Gorra, Jean..."
                  value={ruleForm.product_name}
                  onChange={(e) => handleRuleFormChange('product_name', e.target.value)}
                  disabled={savingRule}
                  className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rule-quantity" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-zinc-400" />
                  Cantidad Especial
                  <span className="font-normal text-zinc-400">(Ej: 12 para docena)</span>
                </Label>
                <Input
                  id="rule-quantity"
                  type="text"
                  inputMode="numeric"
                  placeholder="12"
                  value={ruleForm.quantity}
                  onChange={(e) => handleRuleFormChange('quantity', e.target.value.replace(/\D/g, ''))}
                  disabled={savingRule}
                  className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-special-price" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                    Precio Total Especial
                  </Label>
                  <Input
                    id="rule-special-price"
                    type="text"
                    inputMode="numeric"
                    placeholder="50000"
                    value={ruleForm.special_price}
                    onChange={(e) => handleRuleFormChange('special_price', e.target.value.replace(/\D/g, ''))}
                    disabled={savingRule}
                    className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-bold focus-visible:ring-emerald-500 focus-visible:border-emerald-500"
                  />
                  {ruleForm.special_price && (
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium pl-1">
                      {formatCLP(parseFloat(ruleForm.special_price) || 0)}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rule-unit-price" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-zinc-400" />
                    P. Unitario
                    <span className="font-normal text-zinc-400">(auto)</span>
                  </Label>
                  <Input
                    id="rule-unit-price"
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={ruleForm.unit_price}
                    onChange={(e) => setRuleForm(prev => ({ ...prev, unit_price: e.target.value.replace(/\D/g, '') }))}
                    disabled={savingRule}
                    className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-bold"
                  />
                  {ruleForm.unit_price && (
                    <p className="text-[10px] text-zinc-500 font-medium pl-1">
                      {formatCLP(parseFloat(ruleForm.unit_price) || 0)} c/u
                    </p>
                  )}
                </div>
              </div>

              {ruleForm.product_name && ruleForm.quantity && ruleForm.special_price && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/40 text-xs">
                  <Tags className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <span className="text-zinc-600 dark:text-zinc-300">
                    <span className="font-bold text-zinc-900 dark:text-zinc-50">{ruleForm.quantity}× {ruleForm.product_name || '...'}</span>
                    {' → '}
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCLP(parseFloat(ruleForm.special_price) || 0)}
                    </span>
                    {' total'}
                  </span>
                </div>
              )}

              {ruleErrorMsg && (
                <div className="flex items-start gap-2 p-3 text-xs text-red-600 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-xl font-medium">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{ruleErrorMsg}</span>
                </div>
              )}
            </div>

            <DialogFooter className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRuleModalOpen(false)}
                className="h-9 px-4 rounded-xl border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-9 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
              >
                {editingRule ? 'Guardar Cambios' : 'Crear Regla'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Main View */}
      <div className="space-y-6">
        {/* Tabs */}
        <div className="flex items-center gap-1.5 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <button
            onClick={() => setActiveTab('productos')}
            className={`px-4 py-2.5 text-sm font-semibold cursor-pointer border-b-2 -mb-px transition-colors ${
              activeTab === 'productos'
                ? 'border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50'
                : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            Productos
          </button>
          <button
            onClick={() => setActiveTab('precios')}
            className={`px-4 py-2.5 text-sm font-semibold cursor-pointer border-b-2 -mb-px transition-colors ${
              activeTab === 'precios'
                ? 'border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50'
                : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            Precios Especiales
          </button>
          {canManagePurchases && (
            <button
              onClick={() => setActiveTab('compras')}
              className={`px-4 py-2.5 text-sm font-semibold cursor-pointer border-b-2 -mb-px transition-colors ${
                activeTab === 'compras'
                  ? 'border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50'
                  : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
            >
              Compras
            </button>
          )}
        </div>

        {activeTab === 'productos' && (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                  <Package className="h-5 w-5 text-zinc-400" />
                  Productos
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Stock mostrado para: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{branchName ?? 'Ninguna sucursal seleccionada'}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedProductIds.size > 0 && (
                  <Button
                    variant="outline"
                    onClick={handlePrintSelected}
                    className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Imprimir ({selectedProductIds.size})
                  </Button>
                )}
                {lastImported.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={handlePrintImported}
                    className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Imprimir importados ({lastImported.length})
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => setIsImportOpen(true)}
                  className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Importar
                </Button>
                <ProductExportButton storeId={storeId} branchId={branchId} branchName={branchName} />
                <Button
                  onClick={openCreateProduct}
                  className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex items-center gap-1.5 shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  Nuevo Producto
                </Button>
              </div>
            </div>

            {/* Filters & Search Toolbar */}
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
              {/* Left: Search input */}
              <div className="relative flex-1 min-w-[240px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                <Input
                  placeholder="Buscar por nombre o código de barra..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 h-9 rounded-xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs sm:text-sm focus-visible:ring-zinc-400"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-0.5 rounded cursor-pointer"
                    title="Limpiar búsqueda"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Right: Filter dropdowns & Clear button */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Category filter */}
                <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as string)}>
                  <SelectTrigger className="h-9 min-w-[140px] rounded-xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
                    <SelectValue>
                      {(val: string) => {
                        if (!val || val === 'all') return 'Categoría: Todas'
                        if (val === 'none') return 'Sin categoría'
                        const cat = categories.find((c) => c.id === val)
                        return cat ? `Cat: ${cat.name}` : 'Categoría: Todas'
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las categorías</SelectItem>
                    <SelectItem value="none">Sin categoría</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Stock filter (active when branchId is present) */}
                {branchId && (
                  <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as 'all' | 'in_stock' | 'out_of_stock' | 'low_stock')}>
                    <SelectTrigger className="h-9 min-w-[130px] rounded-xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
                      <SelectValue>
                        {(val: string) => {
                          if (val === 'in_stock') return 'Con stock (>0)'
                          if (val === 'low_stock') return 'Stock bajo (≤5)'
                          if (val === 'out_of_stock') return 'Sin stock (0)'
                          return 'Stock: Todos'
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los stocks</SelectItem>
                      <SelectItem value="in_stock">Con stock (&gt; 0)</SelectItem>
                      <SelectItem value="low_stock">Stock bajo (&le; 5)</SelectItem>
                      <SelectItem value="out_of_stock">Sin stock (0)</SelectItem>
                    </SelectContent>
                  </Select>
                )}

                {/* Status filter */}
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | 'active' | 'inactive')}>
                  <SelectTrigger className="h-9 min-w-[120px] rounded-xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
                    <SelectValue>
                      {(val: string) => {
                        if (val === 'active') return 'Solo activos'
                        if (val === 'inactive') return 'Solo desactivados'
                        return 'Estado: Todos'
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los estados</SelectItem>
                    <SelectItem value="active">Solo activos</SelectItem>
                    <SelectItem value="inactive">Solo desactivados</SelectItem>
                  </SelectContent>
                </Select>

                {/* Reset filters button */}
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetFilters}
                    className="h-9 px-2.5 rounded-xl text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer flex items-center gap-1.5"
                    title="Restablecer filtros"
                  >
                    <FilterX className="h-3.5 w-3.5" />
                    Limpiar
                  </Button>
                )}
              </div>
            </div>

            {/* Results count indicator */}
            {!productsLoading && products.length > 0 && (
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 px-0.5">
                <span>
                  Mostrando <strong className="text-zinc-700 dark:text-zinc-200">{filteredProducts.length}</strong> de{' '}
                  <strong className="text-zinc-700 dark:text-zinc-200">{products.length}</strong> productos
                  {hasActiveFilters && (
                    <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                      (filtros aplicados)
                    </span>
                  )}
                </span>
              </div>
            )}

            {/* Table / Empty state */}
            {productsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 animate-pulse" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-4">
                  <PackagePlus className="h-7 w-7 text-zinc-400" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Sin productos
                </h3>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs mb-5">
                  Creá tu primer producto manualmente o importá tu catálogo desde un archivo Excel.
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={openCreateProduct}
                    variant="outline"
                    className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Crear producto
                  </Button>
                  <Button
                    onClick={() => setIsImportOpen(true)}
                    variant="outline"
                    className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    Importar Excel
                  </Button>
                </div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-zinc-50/50 dark:bg-zinc-900/50">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-3">
                  <SlidersHorizontal className="h-5 w-5 text-zinc-400" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  No se encontraron productos
                </h3>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs mb-4">
                  No hay productos que coincidan con la búsqueda o los filtros seleccionados.
                </p>
                <Button
                  onClick={resetFilters}
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                >
                  <FilterX className="h-3.5 w-3.5" />
                  Limpiar filtros
                </Button>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs overflow-x-auto">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[28px_1.4fr_1fr_110px_100px_100px_90px_180px] gap-3 px-5 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someFilteredSelected
                        }}
                        onChange={toggleSelectAllFiltered}
                        className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 accent-zinc-900 dark:accent-zinc-50 cursor-pointer"
                        title={allFilteredSelected ? 'Deseleccionar todos' : 'Seleccionar todos los visibles'}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Producto</span>
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Categoría</span>
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Código</span>
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-right">Costo</span>
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-right">Venta</span>
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-center">Stock</span>
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-center">Acciones</span>
                  </div>

                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filteredProducts.map((product) => {
                      const stockVal = branchStock.get(product.id) ?? 0
                      return (
                        <div
                          key={product.id}
                          className={`grid grid-cols-[28px_1.4fr_1fr_110px_100px_100px_90px_180px] gap-3 px-5 py-3 items-center hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors duration-150 group ${
                            !product.is_active ? 'opacity-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedProductIds.has(product.id)}
                            onChange={() => toggleSelectProduct(product.id)}
                            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 accent-zinc-900 dark:accent-zinc-50 cursor-pointer"
                          />
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                            {product.name}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                            {categories.find((c) => c.id === product.category_id)?.name ?? '—'}
                          </span>
                          <span className="text-[11px] font-mono text-zinc-400 tracking-wide">{product.barcode}</span>
                          <span className="text-sm text-zinc-600 dark:text-zinc-400 text-right tabular-nums">
                            {formatCLP(product.purchase_price)}
                          </span>
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 text-right tabular-nums">
                            {formatCLP(product.sale_price)}
                          </span>
                          <span
                            className={`text-sm font-bold text-center tabular-nums ${
                              branchId
                                ? stockVal <= 0
                                  ? 'text-red-500 dark:text-red-400'
                                  : stockVal <= 5
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-zinc-900 dark:text-zinc-50'
                                : 'text-zinc-400'
                            }`}
                          >
                            {branchId ? stockVal : '—'}
                          </span>
                          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            <button
                              onClick={() => openEditProduct(product)}
                              className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                              title="Editar"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => openAdjustDialog(product)}
                              disabled={!branchId}
                              className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Ajustar stock"
                            >
                              <Boxes className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => openHistoryDialog(product)}
                              disabled={!branchId}
                              className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Historial de movimientos"
                            >
                              <History className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handlePrintSingle(product)}
                              className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                              title="Imprimir etiqueta"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => confirmToggleProduct(product)}
                              className={`h-7 w-7 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                                product.is_active
                                  ? 'text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/30'
                                  : 'text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-950/30'
                              }`}
                              title={product.is_active ? 'Desactivar' : 'Reactivar'}
                            >
                              {product.is_active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'precios' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                  <Tags className="h-5 w-5 text-zinc-400" />
                  Precios Especiales
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Definí reglas de precio por cantidad. Aparecerán como sugerencias al cargar ventas.
                </p>
              </div>
              <Button
                onClick={openCreateRuleModal}
                className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex items-center gap-1.5 shrink-0"
              >
                <Plus className="h-4 w-4" />
                Nueva Regla
              </Button>
            </div>

            {/* Table / Empty state */}
            {rulesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 animate-pulse" />
                ))}
              </div>
            ) : rules.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-4">
                  <Tags className="h-7 w-7 text-zinc-400" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Sin reglas de precio
                </h3>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs mb-5">
                  Creá tu primera regla para que aparezcan sugerencias de precio especial al cargar ventas.
                </p>
                <Button
                  onClick={openCreateRuleModal}
                  variant="outline"
                  className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Crear primera regla
                </Button>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
                <div className="grid grid-cols-[1fr_80px_130px_130px_80px] gap-3 px-5 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Producto</span>
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-center">Cantidad</span>
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-right">P. Unitario</span>
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-right">Precio Especial</span>
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-center">Acciones</span>
                </div>

                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="grid grid-cols-[1fr_80px_130px_130px_80px] gap-3 px-5 py-4 items-center hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors duration-150 group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 shrink-0">
                          <Package className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        </div>
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                          {rule.product_name}
                        </span>
                      </div>

                      <div className="text-center">
                        <span className="inline-flex items-center justify-center h-7 min-w-[2rem] px-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm font-bold text-zinc-700 dark:text-zinc-300 tabular-nums">
                          ×{rule.quantity}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400 tabular-nums">
                          {formatCLP(rule.unit_price)}
                        </span>
                        <span className="text-[10px] text-zinc-400 block">c/u</span>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {formatCLP(rule.special_price)}
                        </span>
                        <span className="text-[10px] text-zinc-400 block">total</span>
                      </div>

                      <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button
                          onClick={() => openEditRuleModal(rule)}
                          className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                          title="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteRuleConfirmId(rule.id)}
                          className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/30 transition-all cursor-pointer"
                          title="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Info box */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/40 text-xs text-zinc-500 dark:text-zinc-400">
              <Tags className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">¿Cómo funcionan las reglas?</span>
                <p className="mt-0.5 leading-relaxed">
                  Cuando un empleado carga una venta y escribe un producto que coincide con una regla,
                  verá una sugerencia de precio especial. También puede editar el importe total directamente
                  en cualquier momento.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'compras' && canManagePurchases && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                  <PackagePlus className="h-5 w-5 text-zinc-400" />
                  Compras
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Registrá lo que le comprás a tus proveedores: sube el stock y actualiza el costo actual.
                </p>
              </div>
              <Button
                onClick={openCreatePurchase}
                className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex items-center gap-1.5 shrink-0"
              >
                <Plus className="h-4 w-4" />
                Nueva Compra
              </Button>
            </div>

            <PurchasesHistory
              purchases={purchases}
              loading={purchasesLoading}
              role={role}
              userBranchId={userBranchId}
              onEdit={openEditPurchase}
              onPurchasesChange={handlePurchaseSuccess}
            />
          </div>
        )}
      </div>
    </>
  )
}
