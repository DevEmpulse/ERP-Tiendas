'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Calendar,
  DollarSign,
  Receipt,
  TrendingUp,
  Pencil,
  Trash2,
  Truck,
  ShieldAlert,
  Loader2,
  HelpCircle,
} from 'lucide-react'
import { useToast, Toaster } from '@/components/ui/toast'
import { canRecordPurchase } from '@/lib/roles'
import { deletePurchaseGroup, purchaseTotal, type Purchase } from '@/lib/purchasesHelper'

interface PurchasesHistoryProps {
  purchases: Purchase[]
  loading: boolean
  role: string | null
  userBranchId: string | null
  onEdit: (purchase: Purchase) => void
  onPurchasesChange: () => void
}

const formatCLP = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value)

const getLocalTodayStr = () => {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getLocalDaysAgoStr = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toLocalDateStr = (isoString: string) => {
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return ''
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatDateDMY = (dateStr: string) => dateStr.split('-').reverse().join('/')

export function PurchasesHistory({
  purchases,
  loading,
  role,
  userBranchId,
  onEdit,
  onPurchasesChange,
}: PurchasesHistoryProps) {
  const supabase = createClient()
  const { toasts, toast, dismiss } = useToast()

  const [startDateStr, setStartDateStr] = useState(getLocalDaysAgoStr(29))
  const [endDateStr, setEndDateStr] = useState(getLocalTodayStr())
  const [activeQuickFilter, setActiveQuickFilter] = useState<'today' | '7d' | '30d' | 'month' | 'custom'>('30d')

  const [voidTarget, setVoidTarget] = useState<Purchase | null>(null)
  const [voiding, setVoiding] = useState(false)

  const applyQuickFilter = (filter: 'today' | '7d' | '30d' | 'month') => {
    setActiveQuickFilter(filter)
    const today = getLocalTodayStr()
    if (filter === 'today') {
      setStartDateStr(today)
      setEndDateStr(today)
    } else if (filter === '7d') {
      setStartDateStr(getLocalDaysAgoStr(6))
      setEndDateStr(today)
    } else if (filter === '30d') {
      setStartDateStr(getLocalDaysAgoStr(29))
      setEndDateStr(today)
    } else if (filter === 'month') {
      const d = new Date()
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      setStartDateStr(`${year}-${month}-01`)
      setEndDateStr(today)
    }
  }

  const filteredPurchases = (!startDateStr || !endDateStr)
    ? purchases
    : purchases.filter((p) => {
        const localDate = toLocalDateStr(p.created_at)
        return localDate >= startDateStr && localDate <= endDateStr
      })

  const sortedPurchases = [...filteredPurchases].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  const total = filteredPurchases.reduce((acc, p) => acc + purchaseTotal(p), 0)
  const count = filteredPurchases.length
  const avg = count > 0 ? Math.round(total / count) : 0

  const handleVoid = async () => {
    if (!voidTarget) return
    setVoiding(true)
    try {
      const { deletedIds, error } = await deletePurchaseGroup(supabase, [voidTarget.id])
      if (error) throw error

      // RLS can silently block the delete (0 rows, no error) — same pattern
      // as deleteSaleGroup: an encargado targeting another branch's purchase.
      if (deletedIds.length < 1) {
        toast('No tenés permiso para anular esta compra.', 'error')
        setVoidTarget(null)
        onPurchasesChange()
        return
      }

      toast('Compra anulada con éxito y stock revertido.', 'success')
      setVoidTarget(null)
      onPurchasesChange()
    } catch (err: unknown) {
      console.error('Error voiding purchase:', err)
      const msg = err instanceof Error ? err.message : 'Error al anular la compra.'
      toast(msg, 'error')
    } finally {
      setVoiding(false)
    }
  }

  return (
    <div className="space-y-6">
      <Toaster toasts={toasts} dismiss={dismiss} />

      {/* Void confirmation */}
      <Dialog open={!!voidTarget} onOpenChange={(open) => { if (!open) setVoidTarget(null) }}>
        <DialogContent className="sm:max-w-sm bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              ¿Anular esta compra?
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
              Se revertirá el stock ingresado por esta compra. El costo actual del producto (
              <span className="font-semibold">precio de costo</span>) no se modifica.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVoidTarget(null)}
              disabled={voiding}
              className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleVoid}
              disabled={voiding}
              className="h-9 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer flex items-center gap-1.5"
            >
              {voiding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Sí, Anular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Date Filter Card */}
      <Card className="border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/50 dark:bg-zinc-900 rounded-2xl overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800/60 flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <Calendar className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 leading-none">Filtro de período</p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              {filteredPurchases.length} {filteredPurchases.length === 1 ? 'compra encontrada' : 'compras encontradas'}
            </p>
          </div>
        </div>

        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'today', label: 'Hoy' },
              { key: '7d', label: 'Últimos 7 días' },
              { key: '30d', label: 'Últimos 30 días' },
              { key: 'month', label: 'Este mes' },
            ].map(({ key, label }) => {
              const isActive = activeQuickFilter === key
              return (
                <button
                  key={key}
                  onClick={() => applyQuickFilter(key as 'today' | '7d' | '30d' | 'month')}
                  className={[
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer',
                    isActive
                      ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  ].join(' ')}
                >
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-zinc-900 inline-block" />}
                  {label}
                </button>
              )
            })}
            {activeQuickFilter === 'custom' && (
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900">
                <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-zinc-900 inline-block" />
                Rango personalizado
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-1.5">
                Desde
              </label>
              <Input
                type="date"
                value={startDateStr}
                onChange={(e) => { setStartDateStr(e.target.value); setActiveQuickFilter('custom') }}
                className="h-10 bg-zinc-50 border-zinc-200 dark:bg-zinc-800/50 dark:border-zinc-700 rounded-xl text-sm font-medium"
              />
            </div>
            <div className="relative">
              <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-1.5">
                Hasta
              </label>
              <Input
                type="date"
                value={endDateStr}
                onChange={(e) => { setEndDateStr(e.target.value); setActiveQuickFilter('custom') }}
                className="h-10 bg-zinc-50 border-zinc-200 dark:bg-zinc-800/50 dark:border-zinc-700 rounded-xl text-sm font-medium"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Aggregate Stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Gastado</span>
            <DollarSign className="h-4 w-4 text-red-500" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {formatCLP(total)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1">En el rango seleccionado</div>
        </Card>
        <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Compras</span>
            <Receipt className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {count}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1">Registradas en el rango</div>
        </Card>
        <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Promedio</span>
            <TrendingUp className="h-4 w-4 text-purple-500" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {formatCLP(avg)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1">Valor medio por compra</div>
        </Card>
      </div>

      {/* Purchases Table */}
      <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl overflow-hidden">
        <CardHeader className="border-b border-zinc-100 dark:border-zinc-800/80 pb-4">
          <CardTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            Historial de Compras
          </CardTitle>
          <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
            Listado de compras registradas en el rango de fechas, más reciente primero.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-lg bg-zinc-100 dark:bg-zinc-800/50 animate-pulse" />
              ))}
            </div>
          ) : sortedPurchases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-150 dark:border-zinc-700/50 mb-3">
                <HelpCircle className="h-6 w-6 text-zinc-400" />
              </div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                No hay compras en este rango
              </p>
              <p className="text-xs text-zinc-400 mt-1 max-w-xs">
                Las compras que registres aparecerán acá.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {sortedPurchases.map((purchase) => {
                const canManage = canRecordPurchase(role, userBranchId, purchase.branch_id)
                return (
                  <div
                    key={purchase.id}
                    className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-zinc-50/40 dark:hover:bg-zinc-800/20 transition-colors group"
                  >
                    <div className="min-w-0 flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
                        <Truck className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                          {purchase.supplier_name || 'Sin proveedor'}
                        </p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">
                          {formatDateDMY(purchase.purchase_date)} · {(purchase.purchase_items ?? []).length} ítem
                          {(purchase.purchase_items ?? []).length !== 1 ? 's' : ''}
                          {purchase.note ? ` · ${purchase.note}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
                        {formatCLP(purchaseTotal(purchase))}
                      </span>
                      {canManage && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => onEdit(purchase)}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setVoidTarget(purchase)}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/30 transition-all cursor-pointer"
                            title="Anular"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
