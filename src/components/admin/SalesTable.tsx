'use client'

import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, ChevronLeft, ChevronRight, HelpCircle, Edit, Trash2, ShieldAlert } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { SaleModal } from './SaleModal'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast, Toaster } from '@/components/ui/toast'

import { GroupedSale, parseSaleDescription, SaleItem } from '@/lib/salesHelper'

interface SalesTableProps {
  sales: GroupedSale[]
  loading: boolean
  highlightedSaleIds?: string[]
  employees?: any[]
  storeId?: string | null
  onSalesChange?: () => void
  showAmounts?: boolean
}

// Mini items list table component matching CANT | DETALLE | P.UNIT | IMPORTE receipt format
function ItemsTable({ items, showAmounts = true }: { items: SaleItem[]; showAmounts?: boolean }) {
  const formatCurrency = (value: number | string) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(Number(value))
  }

  return (
    <div className="rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 overflow-hidden bg-zinc-50/30 dark:bg-zinc-950/25 text-[11px] w-full max-w-sm sm:max-w-md shadow-2xs">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-zinc-100/50 dark:bg-zinc-900/40 border-b border-zinc-200/50 dark:border-zinc-800/50 text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
            <th className="py-1 px-1.5 text-center w-9 border-r border-zinc-200/50 dark:border-zinc-800/50">Cant</th>
            <th className="py-1 px-2.5 text-left border-r border-zinc-200/50 dark:border-zinc-800/50">Detalle</th>
            <th className="py-1 px-1.5 text-right w-16 border-r border-zinc-200/50 dark:border-zinc-800/50">P.Unit</th>
            <th className="py-1 px-2 text-right w-18">Importe</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200/40 dark:divide-zinc-800/45">
          {items.map((item, idx) => (
            <tr key={idx} className="hover:bg-zinc-100/30 dark:hover:bg-zinc-800/10 transition-colors">
              <td className="py-1 px-1.5 text-center font-extrabold text-zinc-700 dark:text-zinc-350 border-r border-zinc-200/30 dark:border-zinc-800/30">{item.cant}</td>
              <td className="py-1 px-2.5 text-zinc-650 dark:text-zinc-300 truncate max-w-[130px] font-medium border-r border-zinc-200/30 dark:border-zinc-800/30" title={item.detalle}>{item.detalle}</td>
              <td className="py-1 px-1.5 text-right text-zinc-550 dark:text-zinc-400 border-r border-zinc-200/30 dark:border-zinc-800/30">{showAmounts ? formatCurrency(item.p_unit) : '••••'}</td>
              <td className="py-1 px-2 text-right font-bold text-zinc-900 dark:text-zinc-100">{showAmounts ? formatCurrency(item.importe) : '••••'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SalesTable({
  sales,
  loading,
  highlightedSaleIds = [],
  employees = [],
  storeId = null,
  onSalesChange = () => {},
  showAmounts = true
}: SalesTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 8

  // Modals state
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [selectedSale, setSelectedSale] = useState<GroupedSale | null>(null)

  const { toasts, toast, dismiss } = useToast()
  const supabase = createClient()

  // Handle Delete Sale
  const handleDeleteSale = async () => {
    if (!selectedSale) return

    setIsDeleteOpen(false)
    const recordIdsToDelete = selectedSale.payments.map(p => p.id)
    setSelectedSale(null)

    try {
      if (recordIdsToDelete.length > 0) {
        const { error } = await supabase
          .from('sales')
          .delete()
          .in('id', recordIdsToDelete)

        if (error) throw error
      }

      toast('Venta eliminada con éxito.', 'success')
      onSalesChange()
    } catch (err: any) {
      console.error('Error deleting sale:', err)
      toast(err.message || 'Error al eliminar la venta.', 'error')
      onSalesChange() // refresh on error
    }
  }

  // Format currency
  const formatCurrency = (value: number | string) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0
    }).format(Number(value))
  }

  // Format Date (DD/MM/YYYY)
  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString)
      const day = String(date.getDate()).padStart(2, '0')
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const year = date.getFullYear()
      return `${day}/${month}/${year}`
    } catch {
      return '--/--/----'
    }
  }

  // Format Time (HH:MM)
  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString)
      return date.toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    } catch {
      return '--:--'
    }
  }

  // Map Payment Method to Badge
  const renderPaymentBadge = (method: 'cash' | 'transfer' | 'card') => {
    switch (method) {
      case 'cash':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/50 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Efectivo
          </span>
        )
      case 'transfer':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200/50 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/30">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Transferencia
          </span>
        )
      case 'card':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200/50 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/30">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            Tarjeta
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {method}
          </span>
        )
    }
  }

  // Filtering
  const filteredSales = sales.filter((sale) => {
    const employeeName = sale.profiles?.name || ''
    const employeeEmail = sale.profiles?.email || ''
    const searchLower = searchTerm.toLowerCase()

    if (
      employeeName.toLowerCase().includes(searchLower) ||
      employeeEmail.toLowerCase().includes(searchLower)
    ) {
      return true
    }

    const items = parseSaleDescription(sale.description, sale.total_amount)
    return items.some((item) => item.detalle.toLowerCase().includes(searchLower))
  })

  // Pagination
  const totalPages = Math.ceil(filteredSales.length / itemsPerPage) || 1
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentSales = filteredSales.slice(indexOfFirstItem, indexOfLastItem)

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage)
    }
  }

  return (
    <>
      <Toaster toasts={toasts} dismiss={dismiss} />
      <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0 pb-4 border-b border-zinc-100 dark:border-zinc-800/80">
        <div>
          <CardTitle className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            Detalle de Ventas del Día
          </CardTitle>
          <CardDescription className="text-zinc-500 dark:text-zinc-400 text-xs">
            Lista completa de transacciones registradas hoy.
          </CardDescription>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
          <Input
            placeholder="Buscar por empleada o descripción..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setCurrentPage(1) // Reset to first page on search
            }}
            className="pl-9 pr-4 h-9 bg-zinc-50/50 border-zinc-200 focus-visible:ring-zinc-400 dark:bg-zinc-950/30 dark:border-zinc-850 rounded-lg text-sm"
          />
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-150 dark:border-zinc-700/50 mb-3">
              <HelpCircle className="h-6 w-6 text-zinc-400" />
            </div>
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              No se encontraron ventas hoy
            </p>
            <p className="text-xs text-zinc-400 mt-1 max-w-xs">
              {searchTerm
                ? 'Prueba ajustando los términos de búsqueda.'
                : 'Las transacciones registradas por las empleadas aparecerán aquí.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-zinc-50/75 dark:bg-zinc-950/30 border-b border-zinc-100 dark:border-zinc-800/80">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[125px] text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 py-3 pl-6">
                    Fecha / Hora
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 py-3">
                    Empleada
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 py-3">
                    Productos / Items
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 py-3">
                    Método de Pago
                  </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 py-3">
                      Monto
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 py-3 pr-6">
                      Acciones
                    </TableHead>
                  </TableRow>
                </TableHeader>
              <TableBody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {currentSales.map((sale) => {
                  const isHighlighted = highlightedSaleIds.includes(sale.id) || sale.payments.some(p => highlightedSaleIds.includes(p.id))
                  return (
                    <TableRow
                      key={sale.id}
                      className={`transition-all duration-1000 group ${isHighlighted
                          ? 'bg-emerald-50/80 animate-pulse dark:bg-emerald-950/25 text-emerald-900 dark:text-emerald-350 font-medium'
                          : 'hover:bg-zinc-50/30 dark:hover:bg-zinc-800/20'
                        }`}
                    >
                      <TableCell className="py-3 pl-6">
                        <div className="flex flex-col">
                          <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                            {formatDate(sale.created_at)}
                          </span>
                          <span className="text-xs text-zinc-450 dark:text-zinc-400">
                            {formatTime(sale.created_at)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col">
                          {sale.employee_id ? (
                            <>
                              <span className="font-semibold text-zinc-850 dark:text-zinc-150">
                                {sale.profiles?.name || 'Sin nombre'}
                              </span>
                              <span className="text-xs text-zinc-400">
                                {sale.profiles?.email || 'sin-email@tienda.com'}
                              </span>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 dark:text-zinc-500 italic">
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 inline-block" />
                              Empleada eliminada
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 pr-4">
                        <div className="flex flex-col gap-2">
                          <ItemsTable items={parseSaleDescription(sale.description, sale.total_amount)} showAmounts={showAmounts} />
                          {sale.ref_code && (
                            <span className="text-[10px] text-zinc-450 font-bold tracking-wider pl-1">
                              Ref: #{sale.ref_code}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-wrap gap-2 items-center">
                          {sale.payments.map((p, pIdx) => (
                            <div key={pIdx} className="flex items-center gap-1">
                              {renderPaymentBadge(p.method)}
                              {sale.is_combined && (
                                <span className="text-[10px] text-zinc-400 font-semibold bg-zinc-50 dark:bg-zinc-850 px-1 py-0.5 rounded border border-zinc-150 dark:border-zinc-800">
                                  {showAmounts ? formatCurrency(p.amount) : '••••'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold text-zinc-900 dark:text-zinc-50 py-3">
                        {showAmounts ? formatCurrency(sale.total_amount) : '••••'}
                      </TableCell>
                      <TableCell className="py-3 text-right pr-6 text-xs">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedSale(sale)
                              setIsEditOpen(true)
                            }}
                            className="h-7 w-7 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedSale(sale)
                              setIsDeleteOpen(true)
                            }}
                            className="h-7 w-7 text-zinc-500 hover:text-red-650 hover:bg-red-50 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:bg-red-950/20 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/20">
                <div className="text-xs text-zinc-400">
                  Mostrando <span className="font-medium">{indexOfFirstItem + 1}</span> a <span className="font-medium">{Math.min(indexOfLastItem, filteredSales.length)}</span> de <span className="font-medium">{filteredSales.length}</span> ventas
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => handlePageChange(currentPage - 1)}
                    className="h-8 w-8 p-0 cursor-pointer border-zinc-200 dark:border-zinc-800"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="sr-only">Anterior</span>
                  </Button>
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Pág. {currentPage} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === totalPages}
                    onClick={() => handlePageChange(currentPage + 1)}
                    className="h-8 w-8 p-0 cursor-pointer border-zinc-200 dark:border-zinc-800"
                  >
                    <ChevronRight className="h-4 w-4" />
                    <span className="sr-only">Siguiente</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Sale Edit Modal */}
      <SaleModal
        isOpen={isEditOpen}
        onOpenChange={setIsEditOpen}
        storeId={storeId}
        employees={employees}
        saleToEdit={selectedSale}
        onSuccess={onSalesChange}
      />

      {/* Sale Delete Confirmation Modal */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-850 p-6 rounded-xl shadow-lg">
          <DialogHeader className="space-y-1.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <DialogTitle className="text-base font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              ¿Confirmas eliminar esta venta?
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {selectedSale?.is_combined ? (
                <span>
                  Esta venta es un <strong>pago combinado</strong>. Eliminar esta fila borrará la transacción completa (es decir, el desglose de efectivo, transferencia y tarjeta asociado a esta referencia: <strong>#{selectedSale.ref_code}</strong>).
                </span>
              ) : (
                <span>
                  Esta acción eliminará de forma permanente el registro de venta por <strong>{showAmounts ? formatCurrency(selectedSale?.total_amount || 0) : '••••'}</strong>.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-4 flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteOpen(false)}
              className="h-9 px-4 rounded-lg border-zinc-200 text-zinc-650 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-350 dark:hover:bg-zinc-950 cursor-pointer text-xs font-semibold"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSale}
              className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white dark:bg-red-750 dark:hover:bg-red-700 cursor-pointer text-xs font-semibold"
            >
              Sí, Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  </>
  )
}
