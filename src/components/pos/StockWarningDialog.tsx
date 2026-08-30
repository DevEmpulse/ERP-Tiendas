'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import type { StockWarningItem } from './types'

interface StockWarningDialogProps {
  items: StockWarningItem[] | null
  onConfirm: () => void
  onCancel: () => void
}

function formatQty(n: number): string {
  return n <= 0 ? 'sin stock' : `${n} en stock`
}

export function StockWarningDialog({ items, onConfirm, onCancel }: StockWarningDialogProps) {
  return (
    <Dialog open={items !== null && items.length > 0} onOpenChange={open => { if (!open) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <DialogTitle>Stock insuficiente</DialogTitle>
          </div>
          <DialogDescription>
            Los siguientes productos no tienen stock suficiente. Podés confirmar de todas formas — la venta se registrará y el stock quedará en 0.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          {items?.map(item => (
            <div
              key={item.productId}
              className="flex items-center justify-between text-sm px-3 py-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 rounded-lg"
            >
              <span className="font-medium text-zinc-800 dark:text-zinc-100 truncate mr-2">
                {item.productName}
              </span>
              <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400 font-semibold">
                Pedido: {item.requested} · {formatQty(item.available)}
              </span>
            </div>
          ))}
        </div>

        <DialogFooter className="flex gap-2 sm:flex-row-reverse">
          <Button
            onClick={onConfirm}
            className="flex-1 bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-50 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 cursor-pointer"
          >
            Confirmar de todas formas
          </Button>
          <Button
            variant="outline"
            onClick={onCancel}
            className="flex-1 cursor-pointer"
          >
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
