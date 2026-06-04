'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Calendar, DollarSign, Receipt, BarChart2, TrendingUp, Download } from 'lucide-react'

import { GroupedSale } from '@/lib/salesHelper'
import { SalesTable } from './SalesTable'
import { generateSalesReportPdf } from '@/lib/pdfGenerator'

interface SalesHistoryProps {
  sales: GroupedSale[]
  loading: boolean
  employees?: any[]
  storeId?: string | null
  storeName?: string
  onSalesChange?: () => void
  showAmounts?: boolean
}

// Robust helper to extract local YYYY-MM-DD from UTC ISO string
const toLocalDateStr = (isoString: string) => {
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return ''
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getLocalTodayStr = () => {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getLocalDaysAgoStr = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function SalesHistory({
  sales,
  loading,
  employees = [],
  storeId = null,
  storeName = 'ERP Tiendas',
  onSalesChange = () => {},
  showAmounts = true
}: SalesHistoryProps) {
  const [startDateStr, setStartDateStr] = useState(getLocalDaysAgoStr(30))
  const [endDateStr, setEndDateStr] = useState(getLocalTodayStr())

  const handleDownloadPdf = () => {
    const startFormatted = startDateStr.split('-').reverse().join('/')
    const endFormatted = endDateStr.split('-').reverse().join('/')
    
    generateSalesReportPdf({
      title: 'Reporte de Ventas por Rango',
      subtitle: `Ventas registradas entre el ${startFormatted} y el ${endFormatted}`,
      sales: filteredSales,
      storeName,
      fileName: `reporte-ventas-${startDateStr}-a-${endDateStr}.pdf`
    })
  }

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(value)
  }

  // Filter sales by selected date range (local day boundaries)
  const filteredSales = useMemo(() => {
    if (!startDateStr || !endDateStr) return sales

    return sales.filter((sale) => {
      const localDate = toLocalDateStr(sale.created_at)
      return localDate >= startDateStr && localDate <= endDateStr
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

  // Grouped by Day: Date (DD/MM/YYYY) -> { total, count, cash, transfer, card }
  const dailyData = useMemo(() => {
    const groups: Record<string, { dateStr: string; total: number; count: number; cash: number; transfer: number; card: number }> = {}

    filteredSales.forEach((sale) => {
      try {
        const d = new Date(sale.created_at)
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const localDateStr = `${day}/${month}/${year}`

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
      const [dayA, monthA, yearA] = a.dateStr.split('/').map(Number)
      const [dayB, monthB, yearB] = b.dateStr.split('/').map(Number)
      const dateA = new Date(yearA, monthA - 1, dayA)
      const dateB = new Date(yearB, monthB - 1, dayB)
      return dateB.getTime() - dateA.getTime()
    })
  }, [filteredSales])

  // Track active quick-filter
  const [activeQuickFilter, setActiveQuickFilter] = useState<'today' | '7d' | '30d' | 'month' | 'custom'>('30d')

  const applyQuickFilter = (filter: 'today' | '7d' | '30d' | 'month') => {
    setActiveQuickFilter(filter)
    const today = getLocalTodayStr()
    if (filter === 'today') {
      setStartDateStr(today)
      setEndDateStr(today)
    } else if (filter === '7d') {
      setStartDateStr(getLocalDaysAgoStr(6))
      setEndDateStr(today)
    } else if (filter === '30d') {
      setStartDateStr(getLocalDaysAgoStr(29))
      setEndDateStr(today)
    } else if (filter === 'month') {
      const d = new Date()
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      setStartDateStr(`${year}-${month}-01`)
      setEndDateStr(today)
    }
  }

  return (
    <div className="space-y-6">
      {/* Date Filter Card — Redesigned */}
      <Card className="border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/50 dark:bg-zinc-900 rounded-2xl overflow-hidden">
        {/* Header strip */}
        <div className="px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <Calendar className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 leading-none">Filtro de período</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                {filteredSales.length} {filteredSales.length === 1 ? 'venta encontrada' : 'ventas encontradas'}
              </p>
            </div>
          </div>
          <Button
            onClick={handleDownloadPdf}
            disabled={loading || filteredSales.length === 0}
            size="sm"
            className="h-8 px-3.5 rounded-lg bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 cursor-pointer text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar PDF
          </Button>
        </div>

        <CardContent className="p-5 space-y-4">
          {/* Quick filter pills */}
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'today', label: 'Hoy' },
              { key: '7d',    label: 'Últimos 7 días' },
              { key: '30d',   label: 'Últimos 30 días' },
              { key: 'month', label: 'Este mes' },
            ].map(({ key, label }) => {
              const isActive = activeQuickFilter === key
              return (
                <button
                  key={key}
                  onClick={() => applyQuickFilter(key as any)}
                  className={[
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer',
                    isActive
                      ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  ].join(' ')}
                >
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-zinc-900 inline-block" />}
                  {label}
                </button>
              )
            })}
            {activeQuickFilter === 'custom' && (
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900">
                <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-zinc-900 inline-block" />
                Rango personalizado
              </span>
            )}
          </div>

          {/* Date range inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-1.5">
                Desde
              </label>
              <div className="relative group">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none z-10" />
                <Input
                  type="date"
                  value={startDateStr}
                  onChange={(e) => {
                    setStartDateStr(e.target.value)
                    setActiveQuickFilter('custom')
                  }}
                  className="pl-9 h-10 bg-zinc-50 border-zinc-200 hover:border-zinc-300 focus-visible:ring-2 focus-visible:ring-zinc-900/20 focus-visible:border-zinc-400 dark:bg-zinc-800/50 dark:border-zinc-700 dark:hover:border-zinc-600 rounded-xl text-sm font-medium text-zinc-800 dark:text-zinc-200 transition-all cursor-pointer"
                />
              </div>
            </div>
            <div className="relative">
              <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-1.5">
                Hasta
              </label>
              <div className="relative group">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none z-10" />
                <Input
                  type="date"
                  value={endDateStr}
                  onChange={(e) => {
                    setEndDateStr(e.target.value)
                    setActiveQuickFilter('custom')
                  }}
                  className="pl-9 h-10 bg-zinc-50 border-zinc-200 hover:border-zinc-300 focus-visible:ring-2 focus-visible:ring-zinc-900/20 focus-visible:border-zinc-400 dark:bg-zinc-800/50 dark:border-zinc-700 dark:hover:border-zinc-600 rounded-xl text-sm font-medium text-zinc-800 dark:text-zinc-200 transition-all cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Active range summary badge */}
          {startDateStr && endDateStr && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800/60 w-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  {startDateStr.split('-').reverse().join('/')}
                </span>
                {' → '}
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  {endDateStr.split('-').reverse().join('/')}
                </span>
              </span>
            </div>
          )}
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
            {showAmounts ? formatCurrency(stats.total) : '••••'}
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
            {showAmounts ? formatCurrency(stats.avg) : '••••'}
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
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{showAmounts ? formatCurrency(stats.cash) : '••••'}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-zinc-500">Transf:</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">{showAmounts ? formatCurrency(stats.transfer) : '••••'}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-zinc-500">Tarjeta:</span>
              <span className="font-semibold text-purple-600 dark:text-purple-400">{showAmounts ? formatCurrency(stats.card) : '••••'}</span>
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
                      {showAmounts ? formatCurrency(row.cash) : '••••'}
                    </TableCell>
                    <TableCell className="py-3 text-right text-blue-600 dark:text-blue-400 font-medium">
                      {showAmounts ? formatCurrency(row.transfer) : '••••'}
                    </TableCell>
                    <TableCell className="py-3 text-right text-purple-600 dark:text-purple-400 font-medium">
                      {showAmounts ? formatCurrency(row.card) : '••••'}
                    </TableCell>
                    <TableCell className="py-3 text-right pr-6 font-bold text-zinc-900 dark:text-zinc-50">
                      {showAmounts ? formatCurrency(row.total) : '••••'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Historical Detailed Transactions List */}
      <SalesTable
        sales={filteredSales}
        loading={loading}
        employees={employees}
        storeId={storeId}
        onSalesChange={onSalesChange}
        showAmounts={showAmounts}
      />
    </div>
  )
}

