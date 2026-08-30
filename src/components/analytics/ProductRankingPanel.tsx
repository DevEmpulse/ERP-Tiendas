'use client'

import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Award } from 'lucide-react'
import { formatCurrency, type ProductRankingRow } from '@/lib/analytics'

interface ProductRankingPanelProps {
  rows: ProductRankingRow[]
  loading: boolean
}

type Metric = 'units_sold' | 'revenue' | 'margin_estimated'
type Direction = 'best' | 'worst'

const METRIC_LABELS: Record<Metric, string> = {
  units_sold: 'Unidades',
  revenue: 'Ingresos',
  margin_estimated: 'Margen',
}

const COUNT_OPTIONS = [5, 10, 20] as const

export function ProductRankingPanel({ rows, loading }: ProductRankingPanelProps) {
  const [metric, setMetric] = useState<Metric>('revenue')
  const [direction, setDirection] = useState<Direction>('best')
  const [count, setCount] = useState<(typeof COUNT_OPTIONS)[number]>(10)

  const top10 = useMemo(() => {
    return [...rows]
      .sort((a, b) => (direction === 'best' ? b[metric] - a[metric] : a[metric] - b[metric]))
      .slice(0, count)
      .map((r) => ({
        ...r,
        // Recharts YAxis label — truncate long names so bars stay readable
        shortName: r.product_name.length > 22 ? `${r.product_name.slice(0, 22)}…` : r.product_name,
      }))
  }, [rows, metric, direction, count])

  return (
    <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl">
      <CardHeader className="flex flex-col gap-3 pb-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <Award className="h-4 w-4 text-indigo-500" />
            Ranking de Productos
          </CardTitle>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60 text-xs">
            {(['best', 'worst'] as Direction[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  direction === d
                    ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-200'
                }`}
              >
                {d === 'best' ? 'Mejores' : 'Peores'}
              </button>
            ))}
          </div>
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60 text-xs">
            {COUNT_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCount(c)}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  count === c
                    ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60 text-xs">
            {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  metric === m
                    ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-200'
                }`}
              >
                {METRIC_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : top10.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-400">
            Sin ventas registradas en este período.
          </div>
        ) : (
          <>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top10} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e4e7" />
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => (metric === 'units_sold' ? String(v) : formatCurrency(v))}
                    fontSize={11}
                  />
                  <YAxis type="category" dataKey="shortName" width={140} fontSize={11} />
                  <Tooltip
                    formatter={(value) =>
                      metric === 'units_sold' ? String(value) : formatCurrency(Number(value))
                    }
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.product_name ?? ''}
                  />
                  <Bar dataKey={metric} fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
