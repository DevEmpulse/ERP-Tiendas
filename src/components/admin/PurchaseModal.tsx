'use client'

import { useCallback, useState } from 'react'
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
import { Loader2, Plus, Trash2, Package, Truck, Calendar, StickyNote, ShieldAlert } from 'lucide-react'
import { useToast, Toaster } from '@/components/ui/toast'
import { createPurchase, deletePurchaseGroup, type Purchase } from '@/lib/purchasesHelper'

interface ModalProduct {
  id: string
  name: string
  purchase_price: number
}

interface PurchaseLine {
  id: string // local key only
  product_id: string
  product_name: string
  quantity: string
  unit_cost: string
}

interface PurchaseModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  storeId: string | null
  branchId: string | null
  createdBy: string | null
  products: ModalProduct[]
  purchaseToEdit?: Purchase | null
  onSuccess: () => void
}

const getLocalTodayStr = () => {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const emptyLine = (): PurchaseLine => ({
  id: Math.random().toString(36).slice(2),
  product_id: '',
  product_name: '',
  quantity: '1',
  unit_cost: '',
})

const formatCLP = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value)

export function PurchaseModal({
  isOpen,
  onOpenChange,
  storeId,
  branchId,
  createdBy,
  products,
  purchaseToEdit,
  onSuccess,
}: PurchaseModalProps) {
  const isEditMode = !!purchaseToEdit
  const supabase = createClient()
  const { toasts, toast, dismiss } = useToast()

  const [supplierName, setSupplierName] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(getLocalTodayStr())
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<PurchaseLine[]>([emptyLine()])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset/populate form each time the modal opens (mirrors SaleModal's
  // `prevIsOpen` gate to avoid re-running on every keystroke re-render).
  const [prevIsOpen, setPrevIsOpen] = useState(false)
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true)
    setErrorMsg(null)

    if (purchaseToEdit) {
      setSupplierName(purchaseToEdit.supplier_name ?? '')
      setPurchaseDate(purchaseToEdit.purchase_date)
      setNote(purchaseToEdit.note ?? '')
      const existingLines = (purchaseToEdit.purchase_items ?? []).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: String(item.quantity),
        unit_cost: String(item.unit_cost),
      }))
      setLines(existingLines.length > 0 ? existingLines : [emptyLine()])
    } else {
      setSupplierName('')
      setPurchaseDate(getLocalTodayStr())
      setNote('')
      setLines([emptyLine()])
    }
  }
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false)
  }

  const updateLine = useCallback((id: string, field: keyof PurchaseLine, value: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    )
  }, [])

  const selectProduct = (id: string, productId: string) => {
    const product = products.find((p) => p.id === productId)
    setLines((prev) =>
      prev.map((l) =>
        l.id !== id
          ? l
          : {
              ...l,
              product_id: productId,
              product_name: product?.name ?? '',
              unit_cost: l.unit_cost || (product ? String(product.purchase_price) : l.unit_cost),
            }
      )
    )
  }

  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (id: string) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev))

  const linesTotal = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0),
    0
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!storeId || !branchId) { setErrorMsg('No se detectó la tienda o la sucursal.'); return }
    if (!createdBy) { setErrorMsg('No se detectó el usuario autenticado.'); return }

    const validLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0)
    if (validLines.length === 0) {
      setErrorMsg('Agregá al menos un producto con cantidad mayor a 0.')
      return
    }
    if (validLines.some((l) => Number(l.unit_cost) < 0)) {
      setErrorMsg('El costo unitario no puede ser negativo.')
      return
    }

    setLoading(true)
    setErrorMsg(null)

    try {
      // Edit = delete-then-recreate (design D5), mirroring SaleModal.tsx's
      // edit-mode flow verbatim in shape. Abort before inserting replacements
      // if the delete affected fewer rows than expected — RLS can silently
      // block a DELETE (0 rows, `error: null`), and recreating anyway would
      // duplicate the purchase and double-count both stock and cost.
      if (isEditMode && purchaseToEdit) {
        const { deletedIds, error: deleteError } = await deletePurchaseGroup(supabase, [purchaseToEdit.id])
        if (deleteError) throw deleteError
        if (deletedIds.length < 1) {
          throw new Error('No se pudo editar esta compra: no tenés permiso sobre esa sucursal.')
        }
      }

      const { error: createError } = await createPurchase(supabase, {
        storeId,
        branchId,
        createdBy,
        supplierName: supplierName.trim() || null,
        purchaseDate,
        note: note.trim() || null,
        lines: validLines.map((l) => ({
          product_id: l.product_id,
          product_name: l.product_name,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost) || 0,
        })),
      })
      if (createError) throw createError

      toast(isEditMode ? 'Compra actualizada con éxito.' : 'Compra registrada con éxito.', 'success')
      onSuccess()
      onOpenChange(false)
    } catch (err: unknown) {
      console.error('Error saving purchase:', err)
      const msg = err instanceof Error ? err.message : 'Error al guardar la compra.'
      toast(msg, 'error')
      onSuccess()
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Toaster toasts={toasts} dismiss={dismiss} />
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 p-0 rounded-2xl shadow-xl overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Truck className="h-4 w-4 text-zinc-400" />
              {isEditMode ? 'Editar Compra' : 'Nueva Compra'}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {isEditMode
                ? 'Se reemplazará la compra completa con los datos corregidos.'
                : 'Registrá lo que compraste a un proveedor: sube el stock y actualiza el costo actual del producto.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5 text-zinc-400" />
                    Proveedor
                    <span className="font-normal text-zinc-400">(opcional)</span>
                  </Label>
                  <Input
                    placeholder="Ej: Distribuidora XYZ"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    disabled={loading}
                    className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                    Fecha
                  </Label>
                  <Input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    disabled={loading}
                    className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <StickyNote className="h-3.5 w-3.5 text-zinc-400" />
                  Nota
                  <span className="font-normal text-zinc-400">(opcional)</span>
                </Label>
                <Input
                  placeholder="Ej: Factura #1234"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={loading}
                  className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm"
                />
              </div>

              {/* Product Lines Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-zinc-400" />
                    Productos comprados
                  </Label>
                  <span className="text-[10px] text-zinc-400 font-medium">
                    {lines.filter((l) => l.product_id).length} ítem{lines.filter((l) => l.product_id).length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="grid grid-cols-[1.6fr_60px_90px_32px] gap-1.5 px-0.5">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Producto</span>
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide text-center">Cant</span>
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide text-right">Costo Unit.</span>
                  <span />
                </div>

                <div className="space-y-1.5">
                  {lines.map((line) => (
                    <div key={line.id} className="grid grid-cols-[1.6fr_60px_90px_32px] gap-1.5 items-center">
                      <Select
                        value={line.product_id || ''}
                        onValueChange={(v) => selectProduct(line.id, v as string)}
                      >
                        <SelectTrigger className="h-9 w-full rounded-lg border-zinc-200 dark:border-zinc-700 text-xs">
                          <SelectValue placeholder="Elegir producto...">
                            {() => products.find((p) => p.id === line.product_id)?.name ?? 'Elegir producto...'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.id, 'quantity', e.target.value.replace(/\D/g, ''))}
                        disabled={loading}
                        placeholder="1"
                        className="h-9 text-center text-xs font-semibold rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-1"
                      />
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={line.unit_cost}
                        onChange={(e) => updateLine(line.id, 'unit_cost', e.target.value.replace(/[^\d.]/g, ''))}
                        disabled={loading}
                        placeholder="0"
                        className="h-9 text-right text-xs rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2"
                      />
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        disabled={loading || lines.length === 1}
                        className="h-9 w-8 flex items-center justify-center rounded-lg text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all disabled:opacity-0 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={addLine}
                    disabled={loading}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 font-medium cursor-pointer transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar producto
                  </button>
                  {linesTotal > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-400 font-medium">Total:</span>
                      <span className="font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
                        {formatCLP(linesTotal)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 p-3 text-xs text-red-600 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-xl font-medium">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            <DialogFooter className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => onOpenChange(false)}
                className="h-9 px-4 rounded-xl border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="h-9 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex-1 sm:flex-none flex items-center justify-center gap-1.5"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /><span>Guardando...</span></>
                ) : (
                  <span>{isEditMode ? 'Guardar Cambios' : 'Registrar Compra'}</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
