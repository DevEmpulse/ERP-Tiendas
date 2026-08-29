'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, Loader2, History, AlertTriangle, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'

interface CashSessionHistoryViewProps {
  storeId: string | null
  /** Admin's branch selector, if applicable. RLS already scopes encargado/caja
   * to their own branch, so this prop is only needed to narrow admin's
   * store-wide view down to one branch. */
  branchId?: string | null
}

interface SessionRow {
  id: string
  branch_id: string
  opened_by: string | null
  opened_at: string
  opening_amount: number
  status: 'open' | 'closed'
  closed_by: string | null
  closed_at: string | null
  counted_amount: number | null
  expected_amount: number | null
  discrepancy: number | null
  opener_name?: string | null
  closer_name?: string | null
  branch_name?: string | null
}

interface MovementRow {
  id: string
  type: 'cash_in' | 'cash_out'
  amount: number
  reason: string
  note: string | null
  created_at: string
  created_by: string | null
  creator_name?: string | null
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(val)

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function CashSessionHistoryView({ storeId, branchId }: CashSessionHistoryViewProps) {
  const supabase = createClient()

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [movementsBySession, setMovementsBySession] = useState<Record<string, MovementRow[]>>({})
  const [movementsLoading, setMovementsLoading] = useState<string | null>(null)
  const [unattributedCount, setUnattributedCount] = useState<{ count: number; total: number } | null>(null)

  const loadSessions = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    try {
      let query = supabase
        .from('cash_sessions')
        .select(`
          id, branch_id, opened_by, opened_at, opening_amount, status,
          closed_by, closed_at, counted_amount, expected_amount, discrepancy,
          opener:profiles!cash_sessions_opened_by_fkey ( name ),
          closer:profiles!cash_sessions_closed_by_fkey ( name ),
          branches ( name )
        `)
        .order('opened_at', { ascending: false })

      if (branchId) query = query.eq('branch_id', branchId)

      const { data, error } = await query
      if (error) throw error

      const mapped: SessionRow[] = (data ?? []).map((row: Record<string, unknown>) => {
        const opener = row.opener as { name: string | null } | { name: string | null }[] | null
        const closer = row.closer as { name: string | null } | { name: string | null }[] | null
        const branch = row.branches as { name: string | null } | { name: string | null }[] | null
        return {
          id: String(row.id),
          branch_id: String(row.branch_id),
          opened_by: row.opened_by ? String(row.opened_by) : null,
          opened_at: String(row.opened_at),
          opening_amount: Number(row.opening_amount),
          status: row.status as 'open' | 'closed',
          closed_by: row.closed_by ? String(row.closed_by) : null,
          closed_at: row.closed_at ? String(row.closed_at) : null,
          counted_amount: row.counted_amount === null ? null : Number(row.counted_amount),
          expected_amount: row.expected_amount === null ? null : Number(row.expected_amount),
          discrepancy: row.discrepancy === null ? null : Number(row.discrepancy),
          opener_name: Array.isArray(opener) ? opener[0]?.name : opener?.name,
          closer_name: Array.isArray(closer) ? closer[0]?.name : closer?.name,
          branch_name: Array.isArray(branch) ? branch[0]?.name : branch?.name,
        }
      })

      setSessions(mapped)
    } catch (err) {
      console.error('Error loading cash session history:', err)
    } finally {
      setLoading(false)
    }
  }, [storeId, branchId, supabase])

  // "Efectivo sin caja" — unattributed cash sales today (cash_session_id IS NULL)
  const loadUnattributed = useCallback(async () => {
    if (!storeId) return
    try {
      const todayMidnight = new Date()
      todayMidnight.setHours(0, 0, 0, 0)

      let query = supabase
        .from('sales')
        .select('total_amount')
        .eq('payment_method', 'cash')
        .is('cash_session_id', null)
        .gte('created_at', todayMidnight.toISOString())

      if (branchId) query = query.eq('branch_id', branchId)

      const { data, error } = await query
      if (error) throw error

      const rows = (data ?? []) as { total_amount: number | string }[]
      setUnattributedCount({
        count: rows.length,
        total: rows.reduce((acc, r) => acc + Number(r.total_amount), 0),
      })
    } catch (err) {
      console.error('Error loading unattributed cash sales:', err)
    }
  }, [storeId, branchId, supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount/branch change
    loadSessions()
    loadUnattributed()
  }, [loadSessions, loadUnattributed])

  const toggleExpand = async (sessionId: string) => {
    if (expandedId === sessionId) {
      setExpandedId(null)
      return
    }
    setExpandedId(sessionId)
    if (movementsBySession[sessionId]) return

    setMovementsLoading(sessionId)
    try {
      const { data, error } = await supabase
        .from('cash_movements')
        .select(`
          id, type, amount, reason, note, created_at, created_by,
          creator:profiles ( name )
        `)
        .eq('cash_session_id', sessionId)
        .order('created_at', { ascending: true })

      if (error) throw error

      const mapped: MovementRow[] = (data ?? []).map((row: Record<string, unknown>) => {
        const creator = row.creator as { name: string | null } | { name: string | null }[] | null
        return {
          id: String(row.id),
          type: row.type as 'cash_in' | 'cash_out',
          amount: Number(row.amount),
          reason: String(row.reason),
          note: row.note ? String(row.note) : null,
          created_at: String(row.created_at),
          created_by: row.created_by ? String(row.created_by) : null,
          creator_name: Array.isArray(creator) ? creator[0]?.name : creator?.name,
        }
      })

      setMovementsBySession(prev => ({ ...prev, [sessionId]: mapped }))
    } catch (err) {
      console.error('Error loading movements for session:', err)
    } finally {
      setMovementsLoading(null)
    }
  }

  const showBranchColumn = useMemo(() => !branchId, [branchId])

  return (
    <div className="space-y-4">
      {unattributedCount && unattributedCount.count > 0 && (
        <Card className="rounded-2xl border-amber-200 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/20">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              {unattributedCount.count} venta{unattributedCount.count !== 1 ? 's' : ''} en efectivo de hoy sin sesión de caja
              ({formatCurrency(unattributedCount.total)}) — abre una caja para que se atribuyan.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-zinc-200/80 dark:border-zinc-800/80 bg-white/70 backdrop-blur-xl dark:bg-zinc-900/60 shadow-xs">
        <CardHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <History className="h-4 w-4 text-zinc-400" />
            Historial de Caja
          </CardTitle>
          <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
            Sesiones abiertas y cerradas, con su reconciliación.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando historial...
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-16 text-center text-zinc-400 text-xs">
              Aún no hay sesiones de caja registradas.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sessions.map((s) => {
                const isExpanded = expandedId === s.id
                const movements = movementsBySession[s.id] ?? []
                const isOver = (s.discrepancy ?? 0) > 0
                const isShort = (s.discrepancy ?? 0) < 0

                return (
                  <div key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(s.id)}
                      className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                            s.status === 'open'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                          }`}>
                            {s.status === 'open' ? 'Abierta' : 'Cerrada'}
                          </span>
                          {showBranchColumn && s.branch_name && (
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">{s.branch_name}</span>
                          )}
                          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                            {formatDateTime(s.opened_at)}
                            {s.closed_at && <> → {formatDateTime(s.closed_at)}</>}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                          Abierta por {s.opener_name ?? '—'} · Apertura {formatCurrency(s.opening_amount)}
                          {s.status === 'closed' && (
                            <>
                              {' '}· Contado {formatCurrency(s.counted_amount ?? 0)}
                              {' '}· Esperado {formatCurrency(s.expected_amount ?? 0)}
                              {' '}· <span className={isOver ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : isShort ? 'text-red-600 dark:text-red-400 font-semibold' : 'font-semibold'}>
                                Diferencia {formatCurrency(s.discrepancy ?? 0)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-zinc-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />}
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 bg-zinc-50/40 dark:bg-zinc-950/20">
                        {movementsLoading === s.id ? (
                          <div className="flex items-center justify-center py-6 text-zinc-400 text-xs gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Cargando movimientos...
                          </div>
                        ) : movements.length === 0 ? (
                          <p className="text-xs text-zinc-400 py-4 text-center">Sin movimientos manuales en esta sesión.</p>
                        ) : (
                          <div className="space-y-1.5 pt-2">
                            {movements.map((m) => {
                              const isPostClose = s.closed_at ? new Date(m.created_at) > new Date(s.closed_at) : false
                              return (
                                <div key={m.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg bg-white dark:bg-zinc-900/60 border border-zinc-100 dark:border-zinc-800">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {m.type === 'cash_in'
                                      ? <ArrowUpCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                      : <ArrowDownCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                                    <div className="min-w-0">
                                      <p className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">{m.reason}</p>
                                      <p className="text-[10px] text-zinc-400">
                                        {formatDateTime(m.created_at)} · {m.creator_name ?? '—'}
                                        {isPostClose && <span className="ml-1 text-amber-600 dark:text-amber-400 font-semibold">· post-cierre</span>}
                                      </p>
                                    </div>
                                  </div>
                                  <span className={`font-bold shrink-0 ${m.type === 'cash_in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {m.type === 'cash_in' ? '+' : '-'}{formatCurrency(m.amount)}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => { loadSessions(); loadUnattributed() }} className="h-8 rounded-lg text-xs cursor-pointer">
          Actualizar
        </Button>
      </div>
    </div>
  )
}
