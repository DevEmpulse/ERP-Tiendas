'use client'

import { KpiCards } from '@/components/admin/KpiCards'
import { SalesTable } from '@/components/admin/SalesTable'
import { LayoutDashboard } from 'lucide-react'

import { GroupedSale } from '@/lib/salesHelper'

interface DashboardViewProps {
  sales: GroupedSale[]
  dailyIncome: number
  dailySalesCount: number
  previousIncome: number
  loading: boolean
  highlightedSaleIds?: string[]
}

export function DashboardView({
  sales,
  dailyIncome,
  dailySalesCount,
  previousIncome,
  loading,
  highlightedSaleIds = [],
}: DashboardViewProps) {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Title Header */}
      <div className="flex flex-col gap-1.5 border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2.5">
          <LayoutDashboard className="h-6 w-6 text-zinc-900 dark:text-white" />
          Dashboard Resumen
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Monitorea las ventas acumuladas e ingresos del día de hoy en tiempo real.
        </p>
      </div>

      {/* KPI Cards */}
      <KpiCards
        loading={loading}
        dailyIncome={dailyIncome}
        dailySalesCount={dailySalesCount}
        previousIncome={previousIncome}
        highlightedSaleIds={highlightedSaleIds}
      />

      {/* Today's Sales Table */}
      <SalesTable
        sales={sales}
        loading={loading}
        highlightedSaleIds={highlightedSaleIds}
      />
    </div>
  )
}
