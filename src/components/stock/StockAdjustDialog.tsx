'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Boxes, Loader2, ShieldAlert } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

export type AdjustReason = 'manual_adjustment' | 'restock'

export interface StockAdjustDialogProps {
  product: { id: string; name: string } | null
  onOpenChange: (open: boolean) => void
  branchId: string | null
  branchName?: string
  currentStock?: number
  onAdjusted: (newBalance: number) => void
}

export function StockAdjustDialog({
  product,
  onOpenChange,
  branchId,
  branchName,
  currentStock,
  onAdjusted,
}: StockAdjustDialogProps) {
  const supabase = createClient()
  const { toast } = useToast()

  const [adjustDelta, setAdjustDelta] = useState('')
  const [adjustReason, setAdjustReason] = useState<AdjustReason>('manual_adjustment')
  const [adjustNote, setAdjustNote] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustErrorMsg, setAdjustErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (product) {
      setAdjustDelta('')
      setAdjustReason('manual_adjustment')
      setAdjustNote('')
      setAdjustErrorMsg(null)
    }
  }, [product])

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!product || !branchId) return

    const delta = parseInt(adjustDelta, 10)
    if (!delta || delta === 0 || Number.isNaN(delta)) {
      setAdjustErrorMsg('Ingresá una cantidad distinta de cero (usá negativos para restar).')
      return
    }

    setAdjusting(true)
    setAdjustErrorMsg(null)

    try {
      const { data, error } = await supabase.rpc('adjust_branch_stock', {
        p_branch_id: branchId,
        p_product_id: product.id,
        p_delta: delta,
        p_reason: adjustReason,
        p_note: adjustNote.trim() || null,
      })

      if (error) throw error

      toast(`Stock de "${product.name}" ajustado en ${branchName ?? 'la sucursal'}.`, 'success')
      onAdjusted(Number(data ?? 0))
      onOpenChange(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al ajustar el stock.'
      setAdjustErrorMsg(msg)
      toast(msg, 'error')
    } finally {
      setAdjusting(false)
    }
  }

  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-zinc-400" />
            Ajustar Stock
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
            {product?.name} · {branchName ?? 'Sucursal seleccionada'}
            {currentStock !== undefined && ` (Actual: ${currentStock})`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleAdjustSubmit}>
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                Cantidad (usá negativos para restar)
              </Label>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Ej: 10 o -5"
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value.replace(/[^\d-]/g, ''))}
                disabled={adjusting}
                className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-bold"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Motivo</Label>
              <Select value={adjustReason} onValueChange={(v) => setAdjustReason(v as AdjustReason)}>
                <SelectTrigger className="h-10 w-full rounded-xl border-zinc-200 dark:border-zinc-700 text-sm">
                  <SelectValue>
                    {(value: string) => value === 'restock' ? 'Reposición' : 'Ajuste manual'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual_adjustment">Ajuste manual</SelectItem>
                  <SelectItem value="restock">Reposición</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Nota (opcional)</Label>
              <Input
                placeholder="Ej: Conteo físico, mercadería dañada..."
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                disabled={adjusting}
                className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm"
              />
            </div>
            {adjustErrorMsg && (
              <div className="flex items-start gap-2 p-3 text-xs text-red-600 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-xl font-medium">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{adjustErrorMsg}</span>
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-9 px-4 rounded-xl border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={adjusting}
              className="h-9 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex-1 sm:flex-none flex items-center justify-center gap-1.5"
            >
              {adjusting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirmar Ajuste
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
