'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { groupSales, deleteSaleGroup, type GroupedSale, type Sale } from '@/lib/salesHelper'
import { SaleModal } from '@/components/admin/SaleModal'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
  DollarSign,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Receipt,
  CreditCard,
  ArrowLeftRight,
  Coins,
} from 'lucide-react'
import { useToast } from '@/components/ui/toast'

interface Profile {
  id: string
  store_id: string
  name: string | null
  role: string | null
  email: string | null
  branch_id: string | null
}

interface MySalesViewProps {
  profile: Profile
  storeName?: string
  paperWidth?: '58mm' | '80mm'
}

export function MySalesView({
  profile,
  storeName = 'Mi Tienda',
  paperWidth = '58mm',
}: MySalesViewProps) {
  const supabase = createClient()
  const { toast } = useToast()

  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSale, setEditingSale] = useState<GroupedSale | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [voidTarget, setVoidTarget] = useState<GroupedSale | null>(null)
  const [voiding, setVoiding] = useState(false)

  // Local midnight ISO boundary
  const getTodayLocalMidnightISO = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today.toISOString()
  }

  const loadMySales = useCallback(async () => {
    if (!profile.store_id || !profile.id) return
    setLoading(true)

    try {
      const todayMidnight = getTodayLocalMidnightISO()

      let query = supabase
        .from('sales')
        .select(`
          id,
          created_at,
          description,
          payment_method,
          total_amount,
          employee_id,
          branch_id,
          cash_session_id,
          client_id,
          clients (
            id,
            phone
          ),
          profiles (
            id,
            name,
            email
          ),
          sale_items (
            id,
            product_id,
            product_name,
            quantity,
            unit_price,
            subtotal
          )
        `)
        .eq('store_id', profile.store_id)
        .eq('employee_id', profile.id)
        .gte('created_at', todayMidnight)
        .order('created_at', { ascending: false })

      if (profile.branch_id) {
        query = query.eq('branch_id', profile.branch_id)
      }

      const { data, error } = await query

      if (error) throw error

      const mapped: Sale[] = (data ?? []).map((s: Record<string, unknown>) => ({
        id: String(s.id),
        created_at: String(s.created_at),
        description: String(s.description ?? ''),
        payment_method: (s.payment_method as 'cash' | 'transfer' | 'card') || 'cash',
        total_amount: Number(s.total_amount ?? 0),
        employee_id: String(s.employee_id),
        branch_id: s.branch_id ? String(s.branch_id) : null,
        cash_session_id: s.cash_session_id ? String(s.cash_session_id) : null,
        client_id: s.client_id ? String(s.client_id) : null,
        clients: s.clients as { id: string; phone: string | null } | null,
        profiles: s.profiles as { id: string; name: string | null; email: string | null } | null,
        sale_items: (s.sale_items as Array<{
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          unit_price: number | string
          subtotal: number | string
        }>) ?? null,
      }))

      setSales(mapped)
    } catch (err) {
      console.error('Error loading my sales:', err)
      toast('Error al cargar las ventas de hoy.', 'error')
    } finally {
      setLoading(false)
    }
  }, [profile.store_id, profile.id, profile.branch_id, supabase, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    loadMySales()
  }, [loadMySales])

  const groupedSales = useMemo(() => {
    return groupSales(sales)
  }, [sales])

  const totalAmountToday = useMemo(() => {
    return groupedSales.reduce((acc, s) => acc + s.total_amount, 0)
  }, [groupedSales])

  const handleVoidSale = async () => {
    if (!voidTarget) return
    setVoiding(true)

    try {
      const ids = voidTarget.payments.map((p) => p.id)
      const { deletedIds, error } = await deleteSaleGroup(supabase, ids)

      if (error) throw error

      // RLS can silently block the delete (0 rows, no error) — for example
      // once migration.sql §17.8 denies a caja voiding a sale whose session
      // has since closed. Surface that as a clear denial instead of a false
      // success.
      if (deletedIds.length < ids.length) {
        toast('Esta venta pertenece a una caja ya cerrada y no puede anularse.', 'error')
        setVoidTarget(null)
        await loadMySales()
        return
      }

      toast('Venta anulada con éxito y stock revertido.', 'success')
      setVoidTarget(null)
      await loadMySales()
    } catch (err: unknown) {
      console.error('Error voiding sale:', err)
      const msg = err instanceof Error ? err.message : 'Error al anular la venta.'
      toast(msg, 'error')
    } finally {
      setVoiding(false)
    }
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(val)
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getPaymentIcon = (method: string) => {
    switch (method) {
      case 'cash':
        return <Coins className="h-3.5 w-3.5 text-emerald-600" />
      case 'transfer':
        return <ArrowLeftRight className="h-3.5 w-3.5 text-blue-600" />
      case 'card':
        return <CreditCard className="h-3.5 w-3.5 text-purple-600" />
      default:
        return <DollarSign className="h-3.5 w-3.5 text-zinc-500" />
    }
  }

  return (
    <div className="space-y-4">
      {/* Today summary card */}
      <Card className="rounded-2xl border-zinc-200/80 dark:border-zinc-800/80 bg-white/70 backdrop-blur-xl dark:bg-zinc-900/60 shadow-xs">
        <CardContent className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Mis ventas de hoy
            </p>
            <h3 className="text-2xl font-black text-zinc-900 dark:text-zinc-50 mt-0.5">
              {formatCurrency(totalAmountToday)}
            </h3>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              {groupedSales.length} {groupedSales.length === 1 ? 'operación' : 'operaciones'}
            </p>
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={loadMySales}
            disabled={loading}
            className="h-9 w-9 rounded-xl border-zinc-200 dark:border-zinc-700 cursor-pointer"
            title="Actualizar ventas"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardContent>
      </Card>

      {/* Sales list */}
      <Card className="rounded-2xl border-zinc-200/80 dark:border-zinc-800/80 bg-white/70 backdrop-blur-xl dark:bg-zinc-900/60 shadow-xs">
        <CardHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-800 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-zinc-400" />
              Historial de Hoy
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Ventas realizadas por tu usuario en esta sucursal durante el día.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando ventas...
            </div>
          ) : groupedSales.length === 0 ? (
            <div className="py-16 text-center text-zinc-400 text-xs">
              Aún no has registrado ventas hoy.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {groupedSales.map((sale) => (
                <div
                  key={sale.id}
                  className="p-4 flex items-center justify-between gap-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 font-mono">
                        {formatTime(sale.created_at)}
                      </span>
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                        {formatCurrency(sale.total_amount)}
                      </span>
                      {sale.is_combined && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
                          Combinado
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1 line-clamp-1">
                      {sale.description}
                    </p>

                    <div className="flex items-center gap-2 mt-1.5">
                      {sale.payments.map((p, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400"
                        >
                          {getPaymentIcon(p.method)}
                          <span>{p.method === 'cash' ? 'Efectivo' : p.method === 'transfer' ? 'Transf.' : 'Tarjeta'}</span>
                          {sale.is_combined && (
                            <span className="font-mono text-[10px] text-zinc-400">({formatCurrency(p.amount)})</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setEditingSale(sale)
                        setIsEditModalOpen(true)
                      }}
                      className="h-8 w-8 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 cursor-pointer"
                      title="Editar venta"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setVoidTarget(sale)}
                      className="h-8 w-8 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 dark:hover:text-red-400 cursor-pointer"
                      title="Anular venta"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sale Edit Modal */}
      {isEditModalOpen && (
        <SaleModal
          isOpen={isEditModalOpen}
          onOpenChange={(open) => {
            setIsEditModalOpen(open)
            if (!open) setEditingSale(null)
          }}
          storeId={profile.store_id}
          branchId={profile.branch_id}
          callerRole={profile.role}
          employees={[
            {
              id: profile.id,
              name: profile.name,
              email: profile.email,
              role: profile.role,
            },
          ]}
          saleToEdit={editingSale}
          onSuccess={async () => {
            await loadMySales()
          }}
          storeName={storeName}
          paperWidth={paperWidth}
        />
      )}

      {/* Void confirmation dialog */}
      <Dialog open={!!voidTarget} onOpenChange={(open) => { if (!open) setVoidTarget(null) }}>
        <DialogContent className="sm:max-w-sm bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl p-6">
          <DialogHeader>
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 mb-2">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <DialogTitle className="text-center text-base font-bold text-zinc-900 dark:text-zinc-50">
              ¿Anular esta venta?
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Esta acción eliminará la venta de {voidTarget ? formatCurrency(voidTarget.total_amount) : ''} y revertirá el stock de los productos vendidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 sm:justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVoidTarget(null)}
              disabled={voiding}
              className="h-9 px-4 rounded-xl border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold flex-1"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleVoidSale}
              disabled={voiding}
              className="h-9 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white cursor-pointer text-xs font-semibold flex-1 flex items-center justify-center gap-1.5"
            >
              {voiding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Sí, anular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
