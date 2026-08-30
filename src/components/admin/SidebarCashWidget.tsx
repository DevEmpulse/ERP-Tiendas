'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { fetchOpenSession, type CashSession } from '@/lib/cashSession'
import { Wallet } from 'lucide-react'
import { AdminSection } from './sidebar-items'

interface SidebarCashWidgetProps {
  branchId: string | null
  refreshKey?: number
  onManage: (section: AdminSection) => void
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(val)

const formatElapsed = (openedAt: string, now: number) => {
  const elapsedMs = Math.max(0, now - new Date(openedAt).getTime())
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Compact "Mi Caja" summary card shown in the sidebar between the nav and
 * the user footer — status, live expected cash total, and elapsed open time.
 */
export function SidebarCashWidget({ branchId, refreshKey, onManage }: SidebarCashWidgetProps) {
  const supabase = createClient()
  const [session, setSession] = useState<CashSession | null | undefined>(undefined)
  const [expected, setExpected] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const loadSession = useCallback(async () => {
    if (!branchId) { setSession(null); return }
    const s = await fetchOpenSession(supabase, branchId)
    setSession(s)
  }, [supabase, branchId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount/branch change
    loadSession()
  }, [loadSession, refreshKey])

  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing a stale preview when the session closes
      setExpected(null)
      return
    }
    let cancelled = false

    async function loadExpected() {
      const [{ data: salesData }, { data: movementsData }] = await Promise.all([
        supabase.from('sales').select('total_amount').eq('cash_session_id', session!.id).eq('payment_method', 'cash'),
        supabase.from('cash_movements').select('type, amount').eq('cash_session_id', session!.id),
      ])
      if (cancelled) return
      const cashSales = (salesData ?? []).reduce((acc: number, r: { total_amount: number | string }) => acc + Number(r.total_amount), 0)
      const cashIn = (movementsData ?? []).filter((m: { type: string }) => m.type === 'cash_in').reduce((acc: number, m: { amount: number | string }) => acc + Number(m.amount), 0)
      const cashOut = (movementsData ?? []).filter((m: { type: string }) => m.type === 'cash_out').reduce((acc: number, m: { amount: number | string }) => acc + Number(m.amount), 0)
      setExpected(session!.opening_amount + cashSales + cashIn - cashOut)
    }
    loadExpected()
    return () => { cancelled = true }
  }, [session, supabase])

  useEffect(() => {
    if (!session) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [session])

  if (!branchId || session === undefined) return null

  const isOpen = !!session

  return (
    <div className="mx-4 mb-4 rounded-xl border border-zinc-100 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-850/40 p-3.5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-200">
          <Wallet className="h-4 w-4 text-zinc-400" />
          Mi Caja
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${isOpen
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
              : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
        >
          {isOpen ? 'Abierta' : 'Cerrada'}
        </span>
      </div>

      {isOpen && session ? (
        <div className="space-y-1.5 mb-3.5">
          <p className="text-[11px] text-zinc-400">
            Mi efectivo: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{expected === null ? '...' : formatCurrency(expected)}</span>
          </p>
          <p className="text-[11px] text-zinc-400">
            Abierta: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{formatElapsed(session.opened_at, now)}</span>
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-zinc-400 mb-3.5">
          No hay ninguna sesión de caja abierta.
        </p>
      )}

      <button
        onClick={() => onManage('cash')}
        className="w-full text-center text-xs font-semibold py-2 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 hover:opacity-90 cursor-pointer"
      >
        Gestionar Caja
      </button>
    </div>
  )
}
