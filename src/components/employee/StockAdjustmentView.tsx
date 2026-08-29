'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StockAdjustDialog } from '@/components/stock/StockAdjustDialog'
import {
  Boxes,
  Search,
  History,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react'

interface Product {
  id: string
  name: string
  barcode: string | null
  sale_price: number
  is_active: boolean
}

interface StockMovement {
  id: string
  product_id: string
  product_name?: string
  reason: string
  quantity_delta: number
  applied_delta: number
  resulting_balance: number
  note: string | null
  created_at: string
}

interface StockAdjustmentViewProps {
  profile: {
    id: string
    store_id: string
    name: string | null
    role: string | null
    branch_id: string | null
  }
  branchName?: string
}

export function StockAdjustmentView({ profile, branchName }: StockAdjustmentViewProps) {
  const supabase = createClient()

  const [products, setProducts] = useState<Product[]>([])
  const [branchStock, setBranchStock] = useState<Map<string, number>>(new Map())
  const [recentMovements, setRecentMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null)
  const [activeTab, setActiveTab] = useState<'inventory' | 'history'>('inventory')

  const branchId = profile.branch_id
  const storeId = profile.store_id

  const loadData = useCallback(async () => {
    if (!storeId || !branchId) return
    setLoading(true)

    try {
      // 1. Fetch active products
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('id, name, barcode, sale_price, is_active')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (productsError) throw productsError

      // 2. Fetch branch stock
      const { data: stockData, error: stockError } = await supabase
        .from('branch_stock')
        .select('product_id, current_stock')
        .eq('branch_id', branchId)

      if (stockError) throw stockError

      const stockMap = new Map<string, number>()
      for (const row of stockData ?? []) {
        stockMap.set(row.product_id, row.current_stock)
      }

      setProducts(productsData ?? [])
      setBranchStock(stockMap)
    } catch (err) {
      console.error('Error loading inventory data:', err)
    } finally {
      setLoading(false)
    }
  }, [storeId, branchId, supabase])

  const loadRecentMovements = useCallback(async () => {
    if (!storeId || !branchId) return
    setMovementsLoading(true)

    try {
      const { data, error } = await supabase
        .from('stock_movements')
        .select(`
          id,
          product_id,
          reason,
          quantity_delta,
          applied_delta,
          resulting_balance,
          note,
          created_at,
          products (
            name
          )
        `)
        .eq('branch_id', branchId)
        .order('created_at', { ascending: false })
        .limit(30)

      if (error) throw error

      const mapped: StockMovement[] = (data ?? []).map((m: Record<string, unknown>) => {
        const prod = m.products as { name?: string } | null
        return {
          id: String(m.id),
          product_id: String(m.product_id),
          product_name: prod?.name ?? 'Producto',
          reason: String(m.reason),
          quantity_delta: Number(m.quantity_delta),
          applied_delta: Number(m.applied_delta),
          resulting_balance: Number(m.resulting_balance),
          note: m.note ? String(m.note) : null,
          created_at: String(m.created_at),
        }
      })

      setRecentMovements(mapped)
    } catch (err) {
      console.error('Error loading stock movements:', err)
    } finally {
      setMovementsLoading(false)
    }
  }, [storeId, branchId, supabase])

  useEffect(() => {
    loadData()
    loadRecentMovements()
  }, [loadData, loadRecentMovements])

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products
    const q = searchQuery.toLowerCase().trim()
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    )
  }, [products, searchQuery])

  const formatReason = (reason: string) => {
    switch (reason) {
      case 'manual_adjustment':
        return 'Ajuste manual'
      case 'restock':
        return 'Reposición'
      case 'sale':
        return 'Venta'
      case 'sale_reversal':
        return 'Reversión venta'
      case 'import_ingress':
        return 'Ingreso importación'
      default:
        return reason
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2.5">
            <Boxes className="h-6 w-6 text-zinc-700 dark:text-zinc-300" />
            Control de Stock
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {branchName ? `Sucursal: ${branchName}` : 'Gestión de inventario'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1 border border-zinc-200 dark:border-zinc-700">
            <button
              onClick={() => setActiveTab('inventory')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'inventory'
                  ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Inventario ({filteredProducts.length})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Movimientos recientes
            </button>
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              loadData()
              loadRecentMovements()
            }}
            disabled={loading || movementsLoading}
            className="h-9 w-9 rounded-xl border-zinc-200 dark:border-zinc-700 cursor-pointer"
            title="Refrescar"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {activeTab === 'inventory' && (
        <Card className="rounded-2xl border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 shadow-xs">
          <CardHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Package className="h-4 w-4 text-zinc-400" />
                Catálogo de Productos
              </CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                <Input
                  placeholder="Buscar por nombre o código..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9 text-xs rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/50"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-zinc-400 text-sm gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Cargando inventario...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="py-16 text-center text-zinc-400 text-xs">
                {searchQuery ? 'No se encontraron productos coincidentes.' : 'No hay productos disponibles.'}
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredProducts.map((product) => {
                  const stock = branchStock.get(product.id) ?? 0
                  const isOutOfStock = stock <= 0

                  return (
                    <div
                      key={product.id}
                      className="p-4 sm:px-6 flex items-center justify-between gap-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {product.name}
                          </p>
                          {product.barcode && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                              {product.barcode}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                          ${product.sale_price.toLocaleString('es-CL')}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                              isOutOfStock
                                ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/40'
                            }`}
                          >
                            {stock} en stock
                          </span>
                        </div>

                        <Button
                          size="sm"
                          onClick={() => setAdjustTarget(product)}
                          className="h-8 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          Ajustar
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'history' && (
        <Card className="rounded-2xl border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 shadow-xs">
          <CardHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <History className="h-4 w-4 text-zinc-400" />
              Últimos Movimientos de Stock
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Registro de ajustes y cambios de inventario en esta sucursal.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {movementsLoading ? (
              <div className="flex items-center justify-center py-16 text-zinc-400 text-sm gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Cargando historial de movimientos...
              </div>
            ) : recentMovements.length === 0 ? (
              <div className="py-16 text-center text-zinc-400 text-xs">
                No hay movimientos registrados para esta sucursal.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {recentMovements.map((mov) => {
                  const isPositive = mov.applied_delta > 0
                  const isNegative = mov.applied_delta < 0

                  return (
                    <div
                      key={mov.id}
                      className="p-4 sm:px-6 flex items-center justify-between gap-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {mov.product_name}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                            {formatReason(mov.reason)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                          <span>{formatTime(mov.created_at)}</span>
                          {mov.note && (
                            <>
                              <span>·</span>
                              <span className="truncate italic">"{mov.note}"</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 text-right">
                        <span
                          className={`inline-flex items-center gap-0.5 text-xs font-bold ${
                            isPositive
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : isNegative
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-zinc-500'
                          }`}
                        >
                          {isPositive && <ArrowUpRight className="h-3.5 w-3.5" />}
                          {isNegative && <ArrowDownRight className="h-3.5 w-3.5" />}
                          {isPositive ? `+${mov.applied_delta}` : mov.applied_delta}
                        </span>

                        <div className="w-16 text-right">
                          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                            Saldo: {mov.resulting_balance}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Adjust Dialog */}
      <StockAdjustDialog
        product={adjustTarget}
        onOpenChange={(open) => {
          if (!open) setAdjustTarget(null)
        }}
        branchId={branchId}
        branchName={branchName}
        currentStock={adjustTarget ? branchStock.get(adjustTarget.id) ?? 0 : undefined}
        onAdjusted={() => {
          loadData()
          loadRecentMovements()
        }}
      />
    </div>
  )
}
