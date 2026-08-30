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
import { CheckCircle2 } from 'lucide-react'

interface ConfirmSaleDialogProps {
  open: boolean
  total: number
  onConfirm: () => void
  onCancel: () => void
}

function formatCLP(value: number | string): string {
  const num = typeof value === 'number' ? value : parseInt(value as string, 10)
  if (isNaN(num)) return ''
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(num)
}

export function ConfirmSaleDialog({ open, total, onConfirm, onCancel }: ConfirmSaleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={open => { if (!open) onCancel() }}>
      <DialogContent
        className="max-w-sm"
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onConfirm()
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <DialogTitle>Confirmar venta</DialogTitle>
          </div>
          <DialogDescription>
            ¿Confirmar la venta por {formatCLP(total)}?
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex gap-2 sm:flex-row-reverse">
          <Button
            onClick={onConfirm}
            autoFocus
            className="flex-1 bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-50 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 cursor-pointer"
          >
            Confirmar
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
