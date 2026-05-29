'use client'

import { SalesHistory } from '@/components/admin/SalesHistory'
import { Calendar } from 'lucide-react'

import { GroupedSale } from '@/lib/salesHelper'

interface HistoryViewProps {
  sales: GroupedSale[]
  loading: boolean
}

export function HistoryView({ sales, loading }: HistoryViewProps) {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Title Header */}
      <div className="flex flex-col gap-1.5 border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2.5">
          <Calendar className="h-6 w-6 text-zinc-900 dark:text-white" />
          Historial de Ventas
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Consulta y agrupa las ventas históricas totales acumuladas de fechas anteriores.
        </p>
      </div>

      {/* Main Historical component */}
      <SalesHistory
        sales={sales}
        loading={loading}
      />
    </div>
  )
}
