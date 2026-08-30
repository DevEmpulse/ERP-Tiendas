'use client'

import { useMemo } from 'react'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Layers } from 'lucide-react'
import { formatCurrency, type CategoryComparisonRow } from '@/lib/analytics'

interface CategoryComparisonPanelProps {
  rows: CategoryComparisonRow[]
  loading: boolean
}

export function CategoryComparisonPanel({ rows, loading }: CategoryComparisonPanelProps) {
  const chartRows = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        // Recharts YAxis label — truncate long names so bars stay readable
        shortName: r.category_name.length > 22 ? `${r.category_name.slice(0, 22)}…` : r.category_name,
      })),
    [rows]
  )

  return (
    <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <Layers className="h-4 w-4 text-indigo-500" />
          Comparación por Categorías
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : chartRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-400">
            Sin ventas registradas en este período.
          </div>
        ) : (
          <>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e4e7" />
                  <XAxis type="number" tickFormatter={(v: number) => formatCurrency(v)} fontSize={11} />
                  <YAxis type="category" dataKey="shortName" width={140} fontSize={11} />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.category_name ?? ''}
                  />
                  <Bar dataKey="revenue" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead className="text-right">Ingresos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chartRows.map((r) => (
                  <TableRow key={r.category_id ?? 'sin-categoria'}>
                    <TableCell className="font-medium">{r.category_name}</TableCell>
                    <TableCell className="text-right">{r.units_sold}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  )
}
