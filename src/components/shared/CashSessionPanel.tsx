'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Wallet, Lock, LockOpen, ArrowDownCircle, ArrowUpCircle, Loader2 } from 'lucide-react'
import { useToast, Toaster } from '@/components/ui/toast'
import { fetchOpenSession, openSession, closeSession, addCashMovement, type CashSession } from '@/lib/cashSession'
import { canOperateCashSession } from '@/lib/roles'

interface CashSessionPanelProps {
  storeId: string | null
  branchId: string | null
  branchName?: string | null
  role: string | null
  userId: string | null
  userBranchId?: string | null
  onChange?: () => void
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(val)

export function CashSessionPanel({
  storeId,
  branchId,
  branchName,
  role,
  userId,
  userBranchId,
  onChange,
}: CashSessionPanelProps) {
  const supabase = createClient()
  const { toasts, toast, dismiss } = useToast()

  const [session, setSession] = useState<CashSession | null>(null)
  const [runningExpected, setRunningExpected] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const [openDialogOpen, setOpenDialogOpen] = useState(false)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [movementDialogOpen, setMovementDialogOpen] = useState(false)

  const [openingAmount, setOpeningAmount] = useState('')
  const [countedAmount, setCountedAmount] = useState('')
  const [movementType, setMovementType] = useState<'cash_in' | 'cash_out'>('cash_out')
  const [movementAmount, setMovementAmount] = useState('')
  const [movementReason, setMovementReason] = useState('')
  const [movementNote, setMovementNote] = useState('')

  const [submitting, setSubmitting] = useState(false)

  const canOperate = canOperateCashSession(role, userBranchId ?? branchId, branchId)

  const loadSession = useCallback(async () => {
    if (!branchId) { setSession(null); setLoading(false); return }
    setLoading(true)
    const s = await fetchOpenSession(supabase, branchId)
    setSession(s)
    setLoading(false)
  }, [supabase, branchId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount/branch change
    loadSession()
  }, [loadSession])

  // Running expected preview (informational only — the real number is
  // frozen server-side by close_cash_session at close time).
  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing a stale preview when the session closes
      setRunningExpected(null)
      return
    }
    let cancelled = false

    async function loadPreview() {
      const [{ data: salesData }, { data: movementsData }] = await Promise.all([
        supabase.from('sales').select('total_amount').eq('cash_session_id', session!.id).eq('payment_method', 'cash'),
        supabase.from('cash_movements').select('type, amount').eq('cash_session_id', session!.id),
      ])
      if (cancelled) return
      const cashSales = (salesData ?? []).reduce((acc: number, r: { total_amount: number | string }) => acc + Number(r.total_amount), 0)
      const cashIn = (movementsData ?? []).filter((m: { type: string }) => m.type === 'cash_in').reduce((acc: number, m: { amount: number | string }) => acc + Number(m.amount), 0)
      const cashOut = (movementsData ?? []).filter((m: { type: string }) => m.type === 'cash_out').reduce((acc: number, m: { amount: number | string }) => acc + Number(m.amount), 0)
      setRunningExpected(session!.opening_amount + cashSales + cashIn - cashOut)
    }
    loadPreview()
    return () => { cancelled = true }
  }, [session, supabase])

  if (!branchId) {
    return (
      <Card className="rounded-2xl border-zinc-200/80 dark:border-zinc-800/80 bg-white/70 backdrop-blur-xl dark:bg-zinc-900/60 shadow-xs">
        <CardContent className="p-5 text-center text-xs text-zinc-400">
          Selecciona una sucursal para gestionar la caja.
        </CardContent>
      </Card>
    )
  }

  const handleOpen = async () => {
    if (!storeId || !branchId || !userId) return
    const amount = parseInt(openingAmount || '0', 10)
    if (isNaN(amount) || amount < 0) {
      toast('Ingresa un monto de apertura válido.', 'error')
      return
    }
    setSubmitting(true)
    const { session: newSession, error } = await openSession(supabase, {
      storeId, branchId, openedBy: userId, openingAmount: amount,
    })
    setSubmitting(false)
    if (error) {
      toast(error, 'error')
      return
    }
    setSession(newSession)
    setOpeningAmount('')
    setOpenDialogOpen(false)
    toast('Caja abierta con éxito.', 'success')
    onChange?.()
  }

  const handleClose = async () => {
    if (!session) return
    const amount = parseInt(countedAmount || '0', 10)
    if (isNaN(amount) || amount < 0) {
      toast('Ingresa el monto contado.', 'error')
      return
    }
    setSubmitting(true)
    const { session: closed, error } = await closeSession(supabase, {
      sessionId: session.id, countedAmount: amount,
    })
    setSubmitting(false)
    if (error) {
      toast(error, 'error')
      return
    }
    setSession(null)
    setCountedAmount('')
    setCloseDialogOpen(false)
    const discrepancy = closed?.discrepancy ?? 0
    toast(
      discrepancy === 0
        ? 'Caja cerrada sin diferencias.'
        : `Caja cerrada con una diferencia de ${formatCurrency(discrepancy)}.`,
      discrepancy === 0 ? 'success' : 'error'
    )
    onChange?.()
  }

  const handleMovement = async () => {
    if (!session || !storeId || !branchId || !userId) return
    const amount = parseInt(movementAmount || '0', 10)
    if (isNaN(amount) || amount <= 0) {
      toast('Ingresa un monto válido.', 'error')
      return
    }
    if (!movementReason.trim()) {
      toast('Ingresa un motivo.', 'error')
      return
    }
    setSubmitting(true)
    const { error } = await addCashMovement(supabase, {
      cashSessionId: session.id, storeId, branchId,
      type: movementType, amount, reason: movementReason.trim(),
      note: movementNote.trim() || null, createdBy: userId,
    })
    setSubmitting(false)
    if (error) {
      toast(error, 'error')
      return
    }
    setMovementAmount('')
    setMovementReason('')
    setMovementNote('')
    setMovementDialogOpen(false)
    toast('Movimiento registrado.', 'success')
    onChange?.()
  }

  const openedAtLabel = session
    ? new Date(session.opened_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <>
      <Toaster toasts={toasts} dismiss={dismiss} />

      <Card className="rounded-2xl border-zinc-200/80 dark:border-zinc-800/80 bg-white/70 backdrop-blur-xl dark:bg-zinc-900/60 shadow-xs">
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
              session ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
            }`}>
              <Wallet className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              {loading ? (
                <p className="text-xs text-zinc-400">Cargando estado de caja...</p>
              ) : session ? (
                <>
                  <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-1.5">
                    Caja abierta
                    {branchName && <span className="text-zinc-400 font-medium">· {branchName}</span>}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Desde {openedAtLabel}
                    {runningExpected !== null && <> · Esperado: <span className="font-semibold">{formatCurrency(runningExpected)}</span></>}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-zinc-500 dark:text-zinc-400">
                    Sin sesión de caja abierta
                    {branchName && <span className="text-zinc-400 font-medium"> · {branchName}</span>}
                  </p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    Las ventas se registrarán sin atribuir a una caja.
                  </p>
                </>
              )}
            </div>
          </div>

          {canOperate && !loading && (
            <div className="flex items-center gap-2 shrink-0">
              {session ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMovementDialogOpen(true)}
                    className="h-8 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    <ArrowDownCircle className="h-3.5 w-3.5 mr-1" />
                    Ingreso/Egreso
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setCloseDialogOpen(true)}
                    className="h-8 rounded-lg text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer"
                  >
                    <Lock className="h-3.5 w-3.5 mr-1" />
                    Cerrar caja
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setOpenDialogOpen(true)}
                  className="h-8 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  <LockOpen className="h-3.5 w-3.5 mr-1" />
                  Abrir caja
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Open dialog */}
      <Dialog open={openDialogOpen} onOpenChange={setOpenDialogOpen}>
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Abrir caja</DialogTitle>
            <DialogDescription>Ingresa el monto inicial (fondo) con el que abres la caja.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="opening-amount">Monto de apertura ($)</Label>
            <Input
              id="opening-amount"
              type="text"
              inputMode="numeric"
              value={openingAmount}
              onChange={(e) => setOpeningAmount(e.target.value.replace(/\D/g, ''))}
              placeholder="0"
              disabled={submitting}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialogOpen(false)} disabled={submitting} className="cursor-pointer">
              Cancelar
            </Button>
            <Button onClick={handleOpen} disabled={submitting} className="cursor-pointer">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Abrir caja'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Cerrar caja</DialogTitle>
            <DialogDescription>
              Cuenta el efectivo físico e ingresa el monto. Esta acción es definitiva: la sesión no puede reabrirse.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {runningExpected !== null && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Esperado (estimado): <span className="font-semibold text-zinc-800 dark:text-zinc-200">{formatCurrency(runningExpected)}</span>
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="counted-amount">Monto contado ($)</Label>
              <Input
                id="counted-amount"
                type="text"
                inputMode="numeric"
                value={countedAmount}
                onChange={(e) => setCountedAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                disabled={submitting}
              />
            </div>
            {countedAmount && runningExpected !== null && (
              <p className={`text-xs font-semibold ${
                parseInt(countedAmount, 10) - runningExpected === 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}>
                Diferencia estimada: {formatCurrency(parseInt(countedAmount, 10) - runningExpected)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)} disabled={submitting} className="cursor-pointer">
              Cancelar
            </Button>
            <Button onClick={handleClose} disabled={submitting} className="cursor-pointer">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar cierre'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Movement dialog */}
      <Dialog open={movementDialogOpen} onOpenChange={setMovementDialogOpen}>
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Registrar movimiento de caja</DialogTitle>
            <DialogDescription>Entradas o salidas manuales de efectivo (no ventas).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMovementType('cash_in')}
                className={`flex-1 h-9 rounded-xl text-xs font-semibold cursor-pointer ${
                  movementType === 'cash_in' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : ''
                }`}
              >
                <ArrowUpCircle className="h-3.5 w-3.5 mr-1" /> Ingreso
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMovementType('cash_out')}
                className={`flex-1 h-9 rounded-xl text-xs font-semibold cursor-pointer ${
                  movementType === 'cash_out' ? 'border-red-500 bg-red-500/10 text-red-600 dark:text-red-400' : ''
                }`}
              >
                <ArrowDownCircle className="h-3.5 w-3.5 mr-1" /> Egreso
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="movement-amount">Monto ($)</Label>
              <Input
                id="movement-amount"
                type="text"
                inputMode="numeric"
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="movement-reason">Motivo</Label>
              <Input
                id="movement-reason"
                value={movementReason}
                onChange={(e) => setMovementReason(e.target.value)}
                placeholder="Ej. Pago a proveedor"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="movement-note">Nota (opcional)</Label>
              <Input
                id="movement-note"
                value={movementNote}
                onChange={(e) => setMovementNote(e.target.value)}
                placeholder="Detalle adicional..."
                disabled={submitting}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementDialogOpen(false)} disabled={submitting} className="cursor-pointer">
              Cancelar
            </Button>
            <Button onClick={handleMovement} disabled={submitting} className="cursor-pointer">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
