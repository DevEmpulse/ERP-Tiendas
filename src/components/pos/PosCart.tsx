'use client'

import { ShoppingCart, Trash2, Package, Plus, Minus, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CartLine } from './types'

interface PosCartProps {
  lines: CartLine[]
  addedLineId?: string | null
  onUpdateLine: (lineId: string, patch: Partial<CartLine>) => void
  onRemoveLine: (lineId: string) => void
}

function formatCLP(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value)
}

export function PosCart({ lines, addedLineId, onUpdateLine, onRemoveLine }: PosCartProps) {
  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-16 w-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4 text-zinc-400">
          <ShoppingCart className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
        </div>
        <p className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
          El carrito está vacío
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 max-w-xs">
          Buscá un producto arriba o escaneá con el lector de código de barras para comenzar.
        </p>
      </div>
    )
  }

  const grandTotal = lines.reduce((sum, l) => sum + l.subtotal, 0)
  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0)

  return (
    <div className="space-y-4">
      {/* Header with items count */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
            Productos en carrito
          </span>
          <span className="px-2.5 py-0.5 text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-full">
            {totalUnits} {totalUnits === 1 ? 'unidad' : 'unidades'}
          </span>
        </div>
        <span className="text-xs text-zinc-400">
          {lines.length} {lines.length === 1 ? 'ítem distinto' : 'ítems distintos'}
        </span>
      </div>

      {/* Cart Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[500px]">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
              <th className="pb-3 pl-2 font-semibold">Producto</th>
              <th className="pb-3 text-right font-semibold w-28">Precio Unit.</th>
              <th className="pb-3 text-center font-semibold w-36">Cantidad</th>
              <th className="pb-3 text-right font-semibold w-32">Subtotal</th>
              <th className="pb-3 pr-2 text-right w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {lines.map(line => {
              const isJustAdded = addedLineId === line.lineId

              return (
                <tr
                  key={line.lineId}
                  className={cn(
                    'transition-all duration-300 group',
                    isJustAdded
                      ? 'bg-emerald-50/80 dark:bg-emerald-950/40'
                      : 'hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40'
                  )}
                >
                  {/* Product Info */}
                  <td className="py-3.5 pl-2">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-zinc-500',
                        isJustAdded
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'
                          : 'bg-zinc-100 dark:bg-zinc-800'
                      )}>
                        {line.isUnlisted ? (
                          <Tag className="h-4 w-4 text-amber-500" />
                        ) : (
                          <Package className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {line.productName}
                          </span>
                          {line.isUnlisted && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60">
                              Manual
                            </span>
                          )}
                        </div>
                        {line.barcode && (
                          <span className="text-[11px] text-zinc-400 font-mono">
                            {line.barcode}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Read-only Unit Price */}
                  <td className="py-3.5 text-right font-medium text-sm text-zinc-600 dark:text-zinc-400 tabular-nums">
                    {formatCLP(line.unitPrice)}
                  </td>

                  {/* Quantity Controls */}
                  <td className="py-3.5 text-center">
                    <div className="inline-flex items-center rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xs">
                      <button
                        type="button"
                        onClick={() => {
                          const newQty = Math.max(1, line.quantity - 1)
                          onUpdateLine(line.lineId, { quantity: newQty, subtotal: newQty * line.unitPrice })
                        }}
                        className="h-8 w-8 flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-l-xl transition-colors cursor-pointer"
                        title="Restar una unidad"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={e => {
                          const qty = Math.max(1, parseInt(e.target.value || '1', 10))
                          onUpdateLine(line.lineId, { quantity: qty, subtotal: qty * line.unitPrice })
                        }}
                        className="h-8 w-11 text-xs text-center font-bold text-zinc-900 dark:text-zinc-100 bg-transparent border-x border-zinc-200 dark:border-zinc-700 focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newQty = line.quantity + 1
                          onUpdateLine(line.lineId, { quantity: newQty, subtotal: newQty * line.unitPrice })
                        }}
                        className="h-8 w-8 flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-r-xl transition-colors cursor-pointer"
                        title="Sumar una unidad"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>

                  {/* Subtotal */}
                  <td className="py-3.5 text-right font-bold text-sm text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {formatCLP(line.subtotal)}
                  </td>

                  {/* Remove Button */}
                  <td className="py-3.5 pr-2 text-right">
                    <button
                      type="button"
                      onClick={() => onRemoveLine(line.lineId)}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-zinc-300 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                      title="Eliminar del carrito"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Cart Footer Summary */}
      <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-2">
        <span className="text-sm font-medium text-zinc-500">
          Subtotal carrito
        </span>
        <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
          {formatCLP(grandTotal)}
        </span>
      </div>
    </div>
  )
}
