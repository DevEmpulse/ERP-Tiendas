'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Calendar, DollarSign, Receipt, BarChart2, TrendingUp } from 'lucide-react'

import { GroupedSale } from '@/lib/salesHelper'

interface SalesHistoryProps {
  sales: GroupedSale[]
  loading: boolean
}

export function SalesHistory({ sales, loading }: SalesHistoryProps) {
  // Default date filters: start of current month to today
  const defaultStartDate = () => {
    const d = new Date()
    // Go back 30 days as default
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  }

  const defaultEndDate = () => {
    return new Date().toISOString().split('T')[0]
  }

  const [startDateStr, setStartDateStr] = useState(defaultStartDate())
  const [endDateStr, setEndDateStr] = useState(defaultEndDate())

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0
    }).format(value)
  }

  // Filter sales by selected date range (local day boundaries)
  const filteredSales = useMemo(() => {
    if (!startDateStr || !endDateStr) return sales

    const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number)
    const start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0)

    const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number)
    const end = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999)

    return sales.filter((sale) => {
      const saleDate = new Date(sale.created_at)
      return saleDate >= start && saleDate <= end
    })
  }, [sales, startDateStr, endDateStr])


  // Aggregate stats
  const stats = useMemo(() => {
    let total = 0
    let count = filteredSales.length
    let cash = 0
    let transfer = 0
    let card = 0

    filteredSales.forEach((sale) => {
      total += sale.total_amount
      sale.payments.forEach((p) => {
        if (p.method === 'cash') cash += p.amount
        if (p.method === 'transfer') transfer += p.amount
        if (p.method === 'card') card += p.amount
      })
    })

    const avg = count > 0 ? Math.round(total / count) : 0

    return { total, count, avg, cash, transfer, card }
  }, [filteredSales])

  // Grouped by Day: Date (YYYY-MM-DD) -> { total, count, cash, transfer, card }
  const dailyData = useMemo(() => {
    const groups: Record<string, { dateStr: string; total: number; count: number; cash: number; transfer: number; card: number }> = {}

    filteredSales.forEach((sale) => {
      try {
        const localDateStr = new Date(sale.created_at).toLocaleDateString('es-CL', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        })

        if (!groups[localDateStr]) {
          groups[localDateStr] = {
            dateStr: localDateStr,
            total: 0,
            count: 0,
            cash: 0,
            transfer: 0,
            card: 0
          }
        }

        groups[localDateStr].total += sale.total_amount
        groups[localDateStr].count += 1
        
        sale.payments.forEach((p) => {
          if (p.method === 'cash') groups[localDateStr].cash += p.amount
          if (p.method === 'transfer') groups[localDateStr].transfer += p.amount
          if (p.method === 'card') groups[localDateStr].card += p.amount
        })
      } catch (e) {
        console.error('Error grouping sale by date', e)
      }
    })

    // Return sorted by date (newest first)
    return Object.values(groups).sort((a, b) => {
      // Re-parse formatted date 'DD/MM/YYYY' for comparison
      const [dayA, monthA, yearA] = a.dateStr.split('/').map(Number)
      const [dayB, monthB, yearB] = b.dateStr.split('/').map(Number)
      const dateA = new Date(yearA, monthA - 1, dayA)
      const dateB = new Date(yearB, monthB - 1, dayB)
      return dateB.getTime() - dateA.getTime()
    })
  }, [filteredSales])

  return (
    <div className="space-y-6">
      {/* Date Filter Card */}
      <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl">
        <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Fecha Inicio
              </label>
              <Input
                type="date"
                value={startDateStr}
                onChange={(e) => setStartDateStr(e.target.value)}
                className="h-9 bg-zinc-50/50 border-zinc-200 focus-visible:ring-zinc-400 dark:bg-zinc-950/30 dark:border-zinc-850 rounded-lg text-sm w-full"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Fecha Fin
              </label>
              <Input
                type="date"
                value={endDateStr}
                onChange={(e) => setEndDateStr(e.target.value)}
                className="h-9 bg-zinc-50/50 border-zinc-200 focus-visible:ring-zinc-400 dark:bg-zinc-950/30 dark:border-zinc-850 rounded-lg text-sm w-full"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date()
                const weekAgo = new Date()
                weekAgo.setDate(today.getDate() - 7)
                setStartDateStr(weekAgo.toISOString().split('T')[0])
                setEndDateStr(today.toISOString().split('T')[0])
              }}
              className="h-9 px-3 text-xs font-medium cursor-pointer border-zinc-200 dark:border-zinc-800"
            >
              Últimos 7 días
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date()
                const monthAgo = new Date()
                monthAgo.setDate(today.getDate() - 30)
                setStartDateStr(monthAgo.toISOString().split('T')[0])
                setEndDateStr(today.toISOString().split('T')[0])
              }}
              className="h-9 px-3 text-xs font-medium cursor-pointer border-zinc-200 dark:border-zinc-800"
            >
              Últimos 30 días
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Aggregate Stats Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {/* Total Income */}
        <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Recaudado</span>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {formatCurrency(stats.total)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1">En el rango seleccionado</div>
        </Card>

        {/* Total Sales */}
        <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Ventas Totales</span>
            <Receipt className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {stats.count}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1">Transacciones exitosas</div>
        </Card>

        {/* Average Sales */}
        <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Ticket Promedio</span>
            <TrendingUp className="h-4 w-4 text-purple-500" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {formatCurrency(stats.avg)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1">Valor medio por venta</div>
        </Card>

        {/* Payment Methods breakdown */}
        <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Métodos de Pago</span>
            <BarChart2 className="h-4 w-4 text-zinc-500" />
          </div>
          <div className="space-y-1.5 mt-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-zinc-500">Efectivo:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(stats.cash)}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-zinc-500">Transf:</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">{formatCurrency(stats.transfer)}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-zinc-500">Tarjeta:</span>
              <span className="font-semibold text-purple-600 dark:text-purple-400">{formatCurrency(stats.card)}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Daily Accumulations Table */}
      <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl overflow-hidden">
        <CardHeader className="border-b border-zinc-100 dark:border-zinc-800/80 pb-4">
          <CardTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            Acumulado por Día
          </CardTitle>
          <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
            Resumen diario de ventas y montos agregados en el rango de fechas.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {dailyData.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-400">
              No hay datos para las fechas seleccionadas.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-zinc-50/75 dark:bg-zinc-950/30 border-b border-zinc-100 dark:border-zinc-800/80">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="py-2.5 pl-6 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Fecha
                  </TableHead>
                  <TableHead className="py-2.5 text-center text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Ventas
                  </TableHead>
                  <TableHead className="py-2.5 text-right text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Efectivo
                  </TableHead>
                  <TableHead className="py-2.5 text-right text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Transferencia
                  </TableHead>
                  <TableHead className="py-2.5 text-right text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Tarjeta
                  </TableHead>
                  <TableHead className="py-2.5 text-right pr-6 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Total Recaudado
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {dailyData.map((row) => (
                  <TableRow key={row.dateStr} className="hover:bg-zinc-50/30 dark:hover:bg-zinc-800/20">
                    <TableCell className="py-3 pl-6 font-medium text-zinc-800 dark:text-zinc-200">
                      {row.dateStr}
                    </TableCell>
                    <TableCell className="py-3 text-center font-semibold text-zinc-600 dark:text-zinc-450">
                      {row.count}
                    </TableCell>
                    <TableCell className="py-3 text-right text-emerald-600 dark:text-emerald-400 font-medium">
                      {formatCurrency(row.cash)}
                    </TableCell>
                    <TableCell className="py-3 text-right text-blue-600 dark:text-blue-400 font-medium">
                      {formatCurrency(row.transfer)}
                    </TableCell>
                    <TableCell className="py-3 text-right text-purple-600 dark:text-purple-400 font-medium">
                      {formatCurrency(row.card)}
                    </TableCell>
                    <TableCell className="py-3 text-right pr-6 font-bold text-zinc-900 dark:text-zinc-50">
                      {formatCurrency(row.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
