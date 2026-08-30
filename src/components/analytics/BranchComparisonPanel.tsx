'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Building2, DollarSign, ShoppingBag, Boxes } from 'lucide-react'
import { formatCurrency, type BranchComparisonRow } from '@/lib/analytics'

interface BranchComparisonPanelProps {
  rows: BranchComparisonRow[]
  loading: boolean
}

/**
 * Grouped bar chart across branches for admin. For encargado, the RPC
 * already returns exactly one row (their own branch) — a bar chart with a
 * single bar communicates nothing, so it degenerates to KPI cards instead.
 */
export function BranchComparisonPanel({ rows, loading }: BranchComparisonPanelProps) {
  const isSingleBranch = rows.length <= 1

  return (
    <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-indigo-500" />
          Comparación de Sucursales
        </CardTitle>
        <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
          Ingresos, ventas y stock por sucursal
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-400">
            Sin datos de sucursales para este período.
          </div>
        ) : isSingleBranch ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/50 p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <DollarSign className="h-3.5 w-3.5" /> Ingresos
              </div>
              <p className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50">
                {formatCurrency(rows[0].revenue)}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/50 p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <ShoppingBag className="h-3.5 w-3.5" /> Ventas
              </div>
              <p className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50">
                {rows[0].sales_count}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/50 p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <Boxes className="h-3.5 w-3.5" /> Stock
              </div>
              <p className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50">
                {rows[0].stock_units}
              </p>
            </div>
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="branch_name" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip
                  formatter={(value, name) =>
                    name === 'revenue' ? formatCurrency(Number(value)) : String(value)
                  }
                />
                <Legend
                  formatter={(value: string) =>
                    value === 'revenue' ? 'Ingresos' : value === 'sales_count' ? 'Ventas' : 'Stock'
                  }
                />
                <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sales_count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="stock_units" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
