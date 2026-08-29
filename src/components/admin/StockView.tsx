'use client'

import { useState, useEffect, useCallback } from 'react'
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
  Tags,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ShieldAlert,
  Package,
  Hash,
  DollarSign,
} from 'lucide-react'
import { useToast, Toaster } from '@/components/ui/toast'

interface PriceRule {
  id: string
  store_id: string
  product_id: string | null
  product_name: string
  quantity: number
  special_price: number
  unit_price: number
  created_at: string
}

interface StockViewProps {
  storeId: string | null
}

const emptyForm = () => ({
  product_name: '',
  quantity: '',
  special_price: '',
  unit_price: '',
})

const formatCLP = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value)

export function StockView({ storeId }: StockViewProps) {
  const supabase = createClient()

  const [rules, setRules] = useState<PriceRule[]>([])
  const [loading, setLoading] = useState(true)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<PriceRule | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Delete confirmation state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { toasts, toast, dismiss } = useToast()

  const loadRules = useCallback(async () => {
    if (!storeId) return
    try {
      const { data, error } = await supabase
        .from('product_price_rules')
        .select('*')
        .order('product_name', { ascending: true })
      if (error) throw error
      setRules((data || []).map((r: Record<string, unknown>) => ({
        ...r,
        special_price: Number(r.special_price),
        unit_price: Number(r.unit_price),
        quantity: Number(r.quantity),
      } as PriceRule)))
    } catch (err: unknown) {
      console.error('Error loading price rules:', err)
    } finally {
      setLoading(false)
    }
  }, [storeId, supabase])

  useEffect(() => {
    let ignore = false
    async function run() {
      if (!storeId) return
      try {
        const { data, error } = await supabase
          .from('product_price_rules')
          .select('*')
          .order('product_name', { ascending: true })
        if (error) throw error
        if (!ignore) {
          setRules((data || []).map((r: Record<string, unknown>) => ({
            ...r,
            special_price: Number(r.special_price),
            unit_price: Number(r.unit_price),
            quantity: Number(r.quantity),
          } as PriceRule)))
        }
      } catch (err: unknown) {
        console.error('Error loading price rules:', err)
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    run()
    return () => { ignore = true }
  }, [storeId, supabase])

  // Derived: auto-calc unit_price when special_price or quantity changes
  const handleFormChange = (field: string, rawValue: string) => {
    setForm(prev => {
      const next = { ...prev, [field]: rawValue }

      // When special_price or quantity changes, auto-calc unit_price
      if (field === 'special_price' || field === 'quantity') {
        const sp = parseFloat(field === 'special_price' ? rawValue : prev.special_price) || 0
        const qty = parseInt(field === 'quantity' ? rawValue : prev.quantity, 10) || 0
        if (sp > 0 && qty > 0) {
          next.unit_price = Math.round(sp / qty).toString()
        }
      }

      return next
    })
  }

  const openCreateModal = () => {
    setEditingRule(null)
    setForm(emptyForm())
    setErrorMsg(null)
    setIsModalOpen(true)
  }

  const openEditModal = (rule: PriceRule) => {
    setEditingRule(rule)
    setForm({
      product_name: rule.product_name,
      quantity: rule.quantity.toString(),
      special_price: rule.special_price.toString(),
      unit_price: rule.unit_price.toString(),
    })
    setErrorMsg(null)
    setIsModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId) return

    const product_name = form.product_name.trim()
    const quantity = parseInt(form.quantity, 10)
    const special_price = parseFloat(form.special_price)
    const unit_price = parseFloat(form.unit_price)

    if (!product_name) { setErrorMsg('El nombre del producto no puede estar vacío.'); return }
    if (!quantity || quantity <= 0) { setErrorMsg('La cantidad debe ser mayor a 0.'); return }
    if (!special_price || special_price <= 0) { setErrorMsg('El precio especial debe ser mayor a 0.'); return }
    if (!unit_price || unit_price <= 0) { setErrorMsg('El precio unitario debe ser mayor a 0.'); return }

    // Optimistic: capture state and close modal immediately
    const isEditing = !!editingRule
    const editingId = editingRule?.id
    setIsModalOpen(false)
    setErrorMsg(null)
    setSaving(true)

    try {
      if (isEditing && editingId) {
        const { error } = await supabase
          .from('product_price_rules')
          .update({ product_name, quantity, special_price, unit_price })
          .eq('id', editingId)
        if (error) throw error
        toast('Regla actualizada.', 'success')
      } else {
        const { error } = await supabase
          .from('product_price_rules')
          .insert({ store_id: storeId, product_name, quantity, special_price, unit_price })
        if (error) throw error
        toast('Regla de precio creada.', 'success')
      }
      await loadRules()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar la regla.'
      toast(msg, 'error')
      await loadRules()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    // Optimistic: close dialog and remove from list immediately
    setDeleteConfirmId(null)
    setRules(prev => prev.filter(r => r.id !== id))
    setDeleting(true)
    try {
      const { error } = await supabase
        .from('product_price_rules')
        .delete()
        .eq('id', id)
      if (error) throw error
      toast('Regla eliminada correctamente.', 'success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al eliminar.'
      toast(msg, 'error')
      await loadRules() // restore on error
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Toaster toasts={toasts} dismiss={dismiss} />

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null) }}>
        <DialogContent className="sm:max-w-sm bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              ¿Eliminar esta regla?
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
              Esta acción no se puede deshacer. La regla de precio será eliminada permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmId(null)}
              disabled={deleting}
              className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              disabled={deleting}
              className="h-9 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer flex items-center gap-1.5"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Tags className="h-4 w-4 text-zinc-400" />
              {editingRule ? 'Editar Regla de Precio' : 'Nueva Regla de Precio'}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {editingRule
                ? 'Modificá los datos de la regla de precio especial.'
                : 'Definí un precio especial para una cantidad específica de un producto.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave}>
            <div className="px-6 py-5 space-y-4">

              {/* Product Name */}
              <div className="space-y-1.5">
                <Label htmlFor="rule-product-name" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-zinc-400" />
                  Nombre del Producto
                </Label>
                <Input
                  id="rule-product-name"
                  placeholder="Ej: Remera, Gorra, Jean..."
                  value={form.product_name}
                  onChange={(e) => handleFormChange('product_name', e.target.value)}
                  disabled={saving}
                  className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm"
                />
              </div>

              {/* Quantity */}
              <div className="space-y-1.5">
                <Label htmlFor="rule-quantity" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-zinc-400" />
                  Cantidad Especial
                  <span className="font-normal text-zinc-400">(Ej: 12 para docena)</span>
                </Label>
                <Input
                  id="rule-quantity"
                  type="text"
                  inputMode="numeric"
                  placeholder="12"
                  value={form.quantity}
                  onChange={(e) => handleFormChange('quantity', e.target.value.replace(/\D/g, ''))}
                  disabled={saving}
                  className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-bold"
                />
              </div>

              {/* Special Price + Unit Price side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-special-price" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                    Precio Total Especial
                  </Label>
                  <Input
                    id="rule-special-price"
                    type="text"
                    inputMode="numeric"
                    placeholder="50000"
                    value={form.special_price}
                    onChange={(e) => handleFormChange('special_price', e.target.value.replace(/\D/g, ''))}
                    disabled={saving}
                    className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-bold focus-visible:ring-emerald-500 focus-visible:border-emerald-500"
                  />
                  {form.special_price && (
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium pl-1">
                      {formatCLP(parseFloat(form.special_price) || 0)}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rule-unit-price" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-zinc-400" />
                    P. Unitario
                    <span className="font-normal text-zinc-400">(auto)</span>
                  </Label>
                  <Input
                    id="rule-unit-price"
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={form.unit_price}
                    onChange={(e) => setForm(prev => ({ ...prev, unit_price: e.target.value.replace(/\D/g, '') }))}
                    disabled={saving}
                    className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm font-bold"
                  />
                  {form.unit_price && (
                    <p className="text-[10px] text-zinc-500 font-medium pl-1">
                      {formatCLP(parseFloat(form.unit_price) || 0)} c/u
                    </p>
                  )}
                </div>
              </div>

              {/* Summary pill */}
              {form.product_name && form.quantity && form.special_price && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/40 text-xs">
                  <Tags className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <span className="text-zinc-600 dark:text-zinc-300">
                    <span className="font-bold text-zinc-900 dark:text-zinc-50">{form.quantity}× {form.product_name || '...'}</span>
                    {' → '}
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCLP(parseFloat(form.special_price) || 0)}
                    </span>
                    {' total'}
                  </span>
                </div>
              )}

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
                onClick={() => setIsModalOpen(false)}
                className="h-9 px-4 rounded-xl border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-9 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
              >
                {editingRule ? 'Guardar Cambios' : 'Crear Regla'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Main View */}
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Tags className="h-5 w-5 text-zinc-400" />
              Stock / Precios Especiales
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Definí reglas de precio por cantidad. Aparecerán como sugerencias al cargar ventas.
            </p>
          </div>
          <Button
            onClick={openCreateModal}
            className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex items-center gap-1.5 shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nueva Regla
          </Button>
        </div>

        {/* Table / Empty state */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 animate-pulse" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-4">
              <Tags className="h-7 w-7 text-zinc-400" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Sin reglas de precio
            </h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs mb-5">
              Creá tu primera regla para que aparezcan sugerencias de precio especial al cargar ventas.
            </p>
            <Button
              onClick={openCreateModal}
              variant="outline"
              className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Crear primera regla
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
            {/* Table Header */}
            <div className="grid grid-cols-[1fr_80px_130px_130px_80px] gap-3 px-5 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Producto</span>
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-center">Cantidad</span>
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-right">P. Unitario</span>
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-right">Precio Especial</span>
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-center">Acciones</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="grid grid-cols-[1fr_80px_130px_130px_80px] gap-3 px-5 py-4 items-center hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors duration-150 group"
                >
                  {/* Product name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 shrink-0">
                      <Package className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                      {rule.product_name}
                    </span>
                  </div>

                  {/* Quantity */}
                  <div className="text-center">
                    <span className="inline-flex items-center justify-center h-7 min-w-[2rem] px-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm font-bold text-zinc-700 dark:text-zinc-300 tabular-nums">
                      ×{rule.quantity}
                    </span>
                  </div>

                  {/* Unit price */}
                  <div className="text-right">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400 tabular-nums">
                      {formatCLP(rule.unit_price)}
                    </span>
                    <span className="text-[10px] text-zinc-400 block">c/u</span>
                  </div>

                  {/* Special price */}
                  <div className="text-right">
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {formatCLP(rule.special_price)}
                    </span>
                    <span className="text-[10px] text-zinc-400 block">total</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <button
                      onClick={() => openEditModal(rule)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(rule.id)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/30 transition-all cursor-pointer"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info box */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/40 text-xs text-zinc-500 dark:text-zinc-400">
          <Tags className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">¿Cómo funcionan las reglas?</span>
            <p className="mt-0.5 leading-relaxed">
              Cuando un empleado carga una venta y escribe un producto que coincide con una regla, 
              verá una sugerencia de precio especial. También puede editar el importe total directamente 
              en cualquier momento.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
