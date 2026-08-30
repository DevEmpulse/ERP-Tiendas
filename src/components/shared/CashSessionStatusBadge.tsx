'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { fetchOpenSession } from '@/lib/cashSession'
import { Wallet } from 'lucide-react'

interface CashSessionStatusBadgeProps {
  branchId: string | null
  /** Bump this (e.g. the same key CashSessionPanel's onChange triggers) to refetch. */
  refreshKey?: number
}

/**
 * Small persistent indicator of the selected branch's cash-register status,
 * meant to sit in the page header next to the branch selector so it's visible
 * from every section, not just the Caja tab (migration.sql §17).
 */
export function CashSessionStatusBadge({ branchId, refreshKey }: CashSessionStatusBadgeProps) {
  const supabase = createClient()
  const [status, setStatus] = useState<'open' | 'closed' | 'loading'>('loading')

  useEffect(() => {
    let ignore = false
    if (!branchId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to loading when there is no branch to check
      setStatus('loading')
      return
    }
    setStatus('loading')
    fetchOpenSession(supabase, branchId).then((session) => {
      if (!ignore) setStatus(session ? 'open' : 'closed')
    })
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, refreshKey])

  if (!branchId || status === 'loading') return null

  const isOpen = status === 'open'

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
        isOpen
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50'
          : 'bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
      }`}
      title={isOpen ? 'La caja de esta sucursal está abierta' : 'La caja de esta sucursal está cerrada'}
    >
      <Wallet className="h-3.5 w-3.5" />
      <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
      {isOpen ? 'Caja abierta' : 'Caja cerrada'}
    </div>
  )
}
