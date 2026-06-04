'use client'

import { EmployeeReport } from '@/components/admin/EmployeeReport'
import { TrendingUp } from 'lucide-react'

interface EmployeesViewProps {
  showAmounts?: boolean
}

export function EmployeesView({ showAmounts = true }: EmployeesViewProps) {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Title Header */}
      <div className="flex flex-col gap-1.5 border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2.5">
          <TrendingUp className="h-6 w-6 text-zinc-900 dark:text-white" />
          Rendimiento de empleado/as
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Analiza el monto acumulado, cantidad de órdenes y cuotas de mercado de cada empleado/a en tu local.
        </p>
      </div>

      {/* Main Employee Performance Report component */}
      <EmployeeReport showAmounts={showAmounts} />
    </div>
  )
}
