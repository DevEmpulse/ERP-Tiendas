'use client'

import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp } from 'lucide-react'
import { formatCurrency, type SalesTrendRow } from '@/lib/analytics'

interface SalesTrendPanelProps {
  rows: SalesTrendRow[]
  loading: boolean
}

// `day` comes back from analytics_sales_trend as a plain 'YYYY-MM-DD' date
// string (no time component) — parsed manually instead of `new Date(day)` to
// avoid a UTC-midnight-to-local-date off-by-one shift in negative offsets.
const formatDay = (dateStr: string) => {
  const [, month, day] = dateStr.split('-')
  return month && day ? `${day}/${month}` : dateStr
}

export function SalesTrendPanel({ rows, loading }: SalesTrendPanelProps) {
  // Only days that actually had sales are returned by the RPC (sparse, not
  // one row per calendar day) — plotted as-is, no zero-fill.
  const chartData = useMemo(
    () => rows.map((r) => ({ day: formatDay(r.day), revenue: r.revenue })),
    [rows]
  )

  return (
    <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-500" />
          Ventas por Día
        </CardTitle>
        <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
          Ingresos diarios en el período seleccionado
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : chartData.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-400">
            Sin ventas registradas en este período.
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v: number) => formatCurrency(v)} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
