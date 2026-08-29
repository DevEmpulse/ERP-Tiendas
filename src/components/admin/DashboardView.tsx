'use client'

import { useState } from 'react'
import { KpiCards } from '@/components/admin/KpiCards'
import { SalesTable } from '@/components/admin/SalesTable'
import { LayoutDashboard, Plus, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SaleModal } from './SaleModal'

import { GroupedSale } from '@/lib/salesHelper'
import { generateSalesReportPdf } from '@/lib/pdfGenerator'

interface DashboardViewProps {
  sales: GroupedSale[]
  dailyIncome: number
  dailySalesCount: number
  previousIncome: number
  loading: boolean
  highlightedSaleIds?: string[]
  employees?: Array<{ id: string; name: string | null }>
  storeId?: string | null
  branchId?: string | null
  storeName?: string
  paperWidth?: '58mm' | '80mm'
  onSalesChange?: () => void
}

export function DashboardView({
  sales,
  dailyIncome,
  dailySalesCount,
  previousIncome,
  loading,
  highlightedSaleIds = [],
  employees = [],
  storeId = null,
  branchId = null,
  storeName = 'ERP Tiendas',
  paperWidth = '58mm',
  onSalesChange = () => {}
}: DashboardViewProps) {
  const [isAddSaleOpen, setIsAddSaleOpen] = useState(false)

  const handleDownloadPdf = () => {
    const todayStr = new Date().toLocaleDateString('es-CL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    generateSalesReportPdf({
      title: 'Reporte de Ventas del Día',
      subtitle: `Ventas registradas el día de hoy (${todayStr})`,
      sales,
      storeName,
      fileName: `reporte-diario-${todayStr.replace(/\//g, '-')}.pdf`
    })
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2.5">
            <LayoutDashboard className="h-6 w-6 text-zinc-900 dark:text-white" />
            Dashboard Resumen
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Monitorea las ventas acumuladas e ingresos del día de hoy en tiempo real.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-center">
          <Button
            onClick={handleDownloadPdf}
            variant="outline"
            disabled={loading || sales.length === 0}
            className="h-9 px-4 rounded-lg border-zinc-200 text-zinc-650 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-950 cursor-pointer text-xs font-bold flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Exportar PDF
          </Button>
          <Button
            onClick={() => setIsAddSaleOpen(true)}
            className="h-9 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 cursor-pointer text-xs font-bold flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Registrar Venta
          </Button>
        </div>
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
        employees={employees}
        storeId={storeId}
        branchId={branchId}
        onSalesChange={onSalesChange}
      />

      {/* Sale Creator Modal */}
      <SaleModal
        isOpen={isAddSaleOpen}
        onOpenChange={setIsAddSaleOpen}
        storeId={storeId}
        branchId={branchId}
        employees={employees}
        storeName={storeName}
        paperWidth={paperWidth}
        onSuccess={onSalesChange}
      />
    </div>
  )
}

