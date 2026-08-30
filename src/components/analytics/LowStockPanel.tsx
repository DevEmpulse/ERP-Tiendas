'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertTriangle } from 'lucide-react'
import type { LowStockRow } from '@/lib/analytics'

interface LowStockPanelProps {
  rows: LowStockRow[]
  loading: boolean
  showBranchColumn: boolean
}

/** Table only — a chart adds nothing to a flat list of deficits. */
export function LowStockPanel({ rows, loading, showBranchColumn }: LowStockPanelProps) {
  return (
    <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Alertas de Stock Bajo
        </CardTitle>
        <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
          Productos en o por debajo de su stock mínimo configurado
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-400">
            Ningún producto está por debajo de su stock mínimo.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                {showBranchColumn && <TableHead>Sucursal</TableHead>}
                <TableHead className="text-right">Stock actual</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead className="text-right">Déficit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.branch_id}-${r.product_id}`}>
                  <TableCell className="font-medium">{r.product_name}</TableCell>
                  {showBranchColumn && (
                    <TableCell className="text-zinc-500 dark:text-zinc-400">{r.branch_name}</TableCell>
                  )}
                  <TableCell className="text-right">{r.current_stock}</TableCell>
                  <TableCell className="text-right">{r.min_stock}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-[11px] font-bold px-2 py-0.5">
                      -{r.deficit}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
