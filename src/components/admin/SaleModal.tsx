'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Coins, ArrowLeftRight, CreditCard, Phone, Loader2,
  ShieldAlert, CheckCircle2, Plus, Trash2, Package, User, Tags
} from 'lucide-react'
import { GroupedSale } from '@/lib/salesHelper'
import { cn } from '@/lib/utils'

interface Profile {
  id: string
  name: string | null
  email: string | null
  role: string | null
}

interface PriceRule {
  id: string
  product_name: string
  quantity: number
  special_price: number
  unit_price: number
}

interface SaleModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  storeId: string | null
  employees: Profile[]
  saleToEdit?: GroupedSale | null
  onSuccess: () => void
}

// Product line item
interface ProductLine {
  id: string // local key only
  cant: number
  detalle: string
  p_unit: number
  importe: number
  importeManual: boolean // true when user overrode importe directly
}

const emptyLine = (): ProductLine => ({
  id: Math.random().toString(36).slice(2),
  cant: 1,
  detalle: '',
  p_unit: 0,
  importe: 0,
  importeManual: false,
})

// Parse the stored JSON description into product lines, falling back gracefully
const parseDescription = (raw: string): { lines: ProductLine[]; notes: string } => {
  if (!raw) return { lines: [emptyLine()], notes: '' }

  const trimmed = raw.trim()
  // Detect JSON array
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const lines: ProductLine[] = parsed.map((item: any) => ({
          id: Math.random().toString(36).slice(2),
          cant: Number(item.cant ?? item.cantidad ?? 1),
          detalle: String(item.detalle ?? item.descripcion ?? ''),
          p_unit: Number(item.p_unit ?? item.precio_unitario ?? 0),
          importe: Number(item.importe ?? item.total ?? 0),
          importeManual: false,
        }))
        return { lines, notes: '' }
      }
    } catch {
      // fall through to plain text
    }
  }

  // Plain text — put it in a single detalle field
  return {
    lines: [{ id: Math.random().toString(36).slice(2), cant: 1, detalle: trimmed, p_unit: 0, importe: 0, importeManual: false }],
    notes: '',
  }
}

// Serialize product lines back to JSON for storage
const serializeLines = (lines: ProductLine[]): string => {
  const items = lines
    .filter(l => l.detalle.trim() !== '')
    .map(({ cant, detalle, p_unit, importe }) => ({ cant, detalle, p_unit, importe }))
  return JSON.stringify(items)
}

export function SaleModal({
  isOpen,
  onOpenChange,
  storeId,
  employees,
  saleToEdit,
  onSuccess,
}: SaleModalProps) {
  const isEditMode = !!saleToEdit

  // Form states
  const [employeeId, setEmployeeId] = useState('')
  const [lines, setLines] = useState<ProductLine[]>([emptyLine()])

  // Price rules
  const [priceRules, setPriceRules] = useState<PriceRule[]>([])

  // Single payment states
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'card'>('cash')

  // Combined payment states
  const [isCombined, setIsCombined] = useState(false)
  const [splitAmounts, setSplitAmounts] = useState({ cash: '', transfer: '', card: '' })

  // Client states
  const [showClientPhone, setShowClientPhone] = useState(false)
  const [clientPhone, setClientPhone] = useState('')
  const [clientName, setClientName] = useState('')

  // Loading & notification states
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const supabase = createClient()

  // Derived: total from product lines
  const linesTotal = lines.reduce((sum, l) => sum + (l.importe || 0), 0)
  const combinedTotal =
    parseInt(splitAmounts.cash || '0', 10) +
    parseInt(splitAmounts.transfer || '0', 10) +
    parseInt(splitAmounts.card || '0', 10)

  // Load price rules when modal opens
  useEffect(() => {
    if (!isOpen || !storeId) return
    supabase
      .from('product_price_rules')
      .select('id, product_name, quantity, special_price, unit_price')
      .then(({ data }) => {
        if (data) setPriceRules(data.map((r: any) => ({
          ...r,
          quantity: Number(r.quantity),
          special_price: Number(r.special_price),
          unit_price: Number(r.unit_price),
        })))
      })
  }, [isOpen, storeId])

  // Pre-fill form on open
  useEffect(() => {
    if (!isOpen) return
    setErrorMsg(null)
    setSuccessMsg(null)

    if (saleToEdit) {
      setEmployeeId(saleToEdit.employee_id)
      const { lines: parsedLines } = parseDescription(saleToEdit.description)
      setLines(parsedLines)
      setIsCombined(saleToEdit.is_combined)

      if (saleToEdit.client_phone) {
        setShowClientPhone(true)
        setClientPhone(saleToEdit.client_phone)
        setClientName((saleToEdit as any).client_name ?? '')
      } else {
        setShowClientPhone(false)
        setClientPhone('')
        setClientName('')
      }

      if (saleToEdit.is_combined) {
        const cashP = saleToEdit.payments.find(p => p.method === 'cash')
        const transferP = saleToEdit.payments.find(p => p.method === 'transfer')
        const cardP = saleToEdit.payments.find(p => p.method === 'card')
        setSplitAmounts({
          cash: cashP ? cashP.amount.toString() : '',
          transfer: transferP ? transferP.amount.toString() : '',
          card: cardP ? cardP.amount.toString() : '',
        })
        setAmount('')
      } else {
        const p = saleToEdit.payments[0]
        setPaymentMethod(p?.method || 'cash')
        setAmount(p?.amount.toString() || '')
        setSplitAmounts({ cash: '', transfer: '', card: '' })
      }
    } else {
      setEmployeeId(employees[0]?.id || '')
      setLines([emptyLine()])
      setIsCombined(false)
      setAmount('')
      setPaymentMethod('cash')
      setSplitAmounts({ cash: '', transfer: '', card: '' })
      setShowClientPhone(false)
      setClientPhone('')
      setClientName('')
    }
  }, [isOpen, saleToEdit, employees])

  // Update a single line field; bidirectional recalc between cant/p_unit/importe
  const updateLine = useCallback((id: string, field: keyof ProductLine, raw: string | number) => {
    setLines(prev =>
      prev.map(l => {
        if (l.id !== id) return l
        const updated = { ...l, [field]: field === 'detalle' ? raw : Number(raw) || 0 }

        if (field === 'cant' || field === 'p_unit') {
          // Standard recalc: importe = cant * p_unit, clear manual override
          updated.importe = updated.cant * updated.p_unit
          updated.importeManual = false
        } else if (field === 'importe') {
          // User overrode importe directly: recalc p_unit = importe / cant
          const imp = Number(raw) || 0
          const qty = updated.cant || 1
          updated.p_unit = Math.round(imp / qty)
          updated.importeManual = true
        }
        return updated
      })
    )
  }, [])

  // Apply a price rule suggestion
  const applyPriceRule = (id: string, rule: PriceRule) => {
    setLines(prev =>
      prev.map(l =>
        l.id !== id ? l : {
          ...l,
          p_unit: rule.unit_price,
          importe: rule.special_price,
          importeManual: true,
        }
      )
    )
  }

  // Get matching price rule for a line
  const getMatchingRule = (detalle: string, cant: number): PriceRule | null => {
    if (!detalle.trim()) return null
    const lower = detalle.trim().toLowerCase()
    return priceRules.find(
      r => r.product_name.toLowerCase() === lower && r.quantity === cant
    ) || null
  }

  const addLine = () => setLines(prev => [...prev, emptyLine()])
  const removeLine = (id: string) =>
    setLines(prev => (prev.length > 1 ? prev.filter(l => l.id !== id) : prev))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!storeId) { setErrorMsg('No se detectó el ID de la tienda.'); return }
    if (!employeeId) { setErrorMsg('Por favor selecciona una empleada.'); return }

    const validLines = lines.filter(l => l.detalle.trim() !== '')
    if (validLines.length === 0) { setErrorMsg('Por favor agrega al menos un producto o servicio.'); return }

    if (isCombined) {
      if (combinedTotal <= 0) { setErrorMsg('Por favor ingresa montos en al menos un método de pago.'); return }
    } else {
      if (!amount || parseInt(amount, 10) <= 0) { setErrorMsg('Por favor ingresa un monto válido.'); return }
    }

    setLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      let clientId: string | null = null

      if (showClientPhone && clientPhone.trim()) {
        const cleanPhone = clientPhone.replace(/\D/g, '')
        const trimmedName = clientName.trim() || null
        if (cleanPhone.length > 0) {
          const { data: existingClient, error: clientFetchError } = await supabase
            .from('clients').select('id, name')
            .eq('store_id', storeId).eq('phone', cleanPhone).maybeSingle()
          if (clientFetchError) throw clientFetchError

          if (existingClient) {
            clientId = existingClient.id
            // Update name if provided and different
            if (trimmedName && trimmedName !== existingClient.name) {
              await supabase.from('clients').update({ name: trimmedName }).eq('id', clientId)
            }
          } else {
            const { data: newClient, error: clientInsertError } = await supabase
              .from('clients').insert({ store_id: storeId, phone: cleanPhone, name: trimmedName })
              .select('id').single()
            if (clientInsertError) throw clientInsertError
            if (newClient) clientId = newClient.id
          }
        }
      }

      // Delete old records in edit mode
      if (isEditMode && saleToEdit) {
        const ids = saleToEdit.payments.map(p => p.id)
        if (ids.length > 0) {
          const { error: deleteError } = await supabase.from('sales').delete().in('id', ids)
          if (deleteError) throw deleteError
        }
      }

      const description = serializeLines(lines)

      if (isCombined) {
        const txnRef = saleToEdit?.ref_code || Math.random().toString(36).substring(2, 6).toUpperCase()
        const salesToInsert: any[] = []

        const cashNum = parseInt(splitAmounts.cash || '0', 10)
        if (cashNum > 0) salesToInsert.push({
          store_id: storeId, employee_id: employeeId,
          description: `${description} (Efectivo - Ref: #${txnRef})`,
          payment_method: 'cash', total_amount: cashNum, client_id: clientId,
          created_at: saleToEdit?.created_at,
        })

        const transferNum = parseInt(splitAmounts.transfer || '0', 10)
        if (transferNum > 0) salesToInsert.push({
          store_id: storeId, employee_id: employeeId,
          description: `${description} (Transferencia - Ref: #${txnRef})`,
          payment_method: 'transfer', total_amount: transferNum, client_id: clientId,
          created_at: saleToEdit?.created_at,
        })

        const cardNum = parseInt(splitAmounts.card || '0', 10)
        if (cardNum > 0) salesToInsert.push({
          store_id: storeId, employee_id: employeeId,
          description: `${description} (Tarjeta - Ref: #${txnRef})`,
          payment_method: 'card', total_amount: cardNum, client_id: clientId,
          created_at: saleToEdit?.created_at,
        })

        const { error: insertError } = await supabase.from('sales').insert(salesToInsert)
        if (insertError) throw insertError
      } else {
        const saleData: any = {
          store_id: storeId, employee_id: employeeId, description,
          payment_method: paymentMethod,
          total_amount: parseInt(amount, 10),
          client_id: clientId,
        }
        if (isEditMode && saleToEdit) saleData.created_at = saleToEdit.created_at
        const { error: insertError } = await supabase.from('sales').insert(saleData)
        if (insertError) throw insertError
      }

      setSuccessMsg(isEditMode ? 'Venta actualizada con éxito.' : 'Venta registrada con éxito.')
      onSuccess()
      setTimeout(() => { onOpenChange(false); setSuccessMsg(null) }, 1500)
    } catch (err: any) {
      console.error('Error saving sale:', err)
      setErrorMsg(err.message || 'Error al guardar la venta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 p-0 rounded-2xl shadow-xl overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            {isEditMode ? 'Editar Venta' : 'Registrar Nueva Venta'}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
            {isEditMode
              ? 'Realiza cambios en los detalles de la venta seleccionada.'
              : 'Registra una transacción directamente desde el panel de administración.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col max-h-[80vh] overflow-y-auto">
          <div className="px-6 py-5 space-y-5">

            {/* Employee Selection */}
            <div className="space-y-1.5">
              <Label htmlFor="employee" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                Vendido por (Empleada)
              </Label>
              <select
                id="employee"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={loading}
                className="w-full h-10 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 transition-all"
              >
                <option value="" disabled>Selecciona la empleada...</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name || emp.email || 'Sin nombre'}
                  </option>
                ))}
              </select>
            </div>

            {/* Product Lines Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-zinc-400" />
                  Productos / Servicios
                </Label>
                <span className="text-[10px] text-zinc-400 font-medium">
                  {lines.filter(l => l.detalle.trim()).length} ítem{lines.filter(l => l.detalle.trim()).length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[36px_1fr_80px_80px_80px_32px] gap-1.5 px-0.5">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide text-center">Cant</span>
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Detalle</span>
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide text-right">P. Unit</span>
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide text-right">Importe</span>
                <span />
              </div>

              {/* Product rows */}
              <div className="space-y-1.5">
                {lines.map((line, idx) => {
                  const matchingRule = getMatchingRule(line.detalle, line.cant)
                  return (
                    <div key={line.id} className="space-y-1">
                      <div
                        className="grid grid-cols-[36px_1fr_80px_80px_32px] gap-1.5 items-center group"
                      >
                        {/* Cant */}
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={line.cant || ''}
                          onChange={(e) => updateLine(line.id, 'cant', e.target.value.replace(/\D/g, ''))}
                          disabled={loading}
                          placeholder="1"
                          className="h-9 text-center text-xs font-semibold rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-1"
                        />
                        {/* Detalle */}
                        <Input
                          type="text"
                          value={line.detalle}
                          onChange={(e) => updateLine(line.id, 'detalle', e.target.value)}
                          disabled={loading}
                          placeholder={`Producto ${idx + 1}`}
                          className="h-9 text-xs rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50"
                        />
                        {/* P. Unit */}
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={line.p_unit || ''}
                          onChange={(e) => updateLine(line.id, 'p_unit', e.target.value.replace(/\D/g, ''))}
                          disabled={loading}
                          placeholder="0"
                          className="h-9 text-right text-xs rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2"
                        />
                        {/* Importe — now editable */}
                        <div className="relative">
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={line.importe || ''}
                            onChange={(e) => updateLine(line.id, 'importe', e.target.value.replace(/\D/g, ''))}
                            disabled={loading}
                            placeholder="0"
                            className={cn(
                              "h-9 text-right text-xs rounded-lg px-2 transition-colors duration-200",
                              line.importeManual
                                ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 font-bold"
                                : "border-zinc-200 dark:border-zinc-700 bg-zinc-100/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-semibold"
                            )}
                          />
                          {line.importeManual && (
                            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white dark:ring-zinc-900" />
                          )}
                        </div>
                        {/* Remove */}
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          disabled={loading || lines.length === 1}
                          className="h-9 w-8 flex items-center justify-center rounded-lg text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all disabled:opacity-0 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Price rule suggestion */}
                      {matchingRule && !line.importeManual && (
                        <button
                          type="button"
                          onClick={() => applyPriceRule(line.id, matchingRule)}
                          disabled={loading}
                          className="ml-10 flex items-center gap-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-2 py-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors cursor-pointer select-none animate-in fade-in duration-150"
                        >
                          <Tags className="h-3 w-3 shrink-0" />
                          💡 ×{matchingRule.quantity}: ${matchingRule.special_price.toLocaleString('es-CL')} — Aplicar
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Add line + subtotal */}
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
                    <span className="text-zinc-400 font-medium">Subtotal:</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
                      ${linesTotal.toLocaleString('es-CL')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-zinc-100 dark:border-zinc-800" />

            {/* Combined Payment Toggle */}
            <div className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200/60 dark:border-zinc-700/40">
              <div className="space-y-0.5">
                <Label className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  Pago Combinado 🔀
                </Label>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                  Dividir la venta en múltiples métodos.
                </p>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => setIsCombined(!isCombined)}
                className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isCombined ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out ${
                    isCombined ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Payment method input grid */}
            {isCombined ? (
              <div className="space-y-3 p-3 bg-zinc-50/50 dark:bg-zinc-950/20 rounded-xl border border-zinc-200/50 dark:border-zinc-800/30">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="cash" className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Coins className="h-3 w-3" /> Efectivo
                    </Label>
                    <Input
                      id="cash" type="text" placeholder="0"
                      value={splitAmounts.cash}
                      onChange={(e) => setSplitAmounts(prev => ({ ...prev, cash: e.target.value.replace(/\D/g, '') }))}
                      disabled={loading}
                      className="h-8 text-xs font-bold rounded-lg border-zinc-200 focus-visible:ring-emerald-500 dark:border-zinc-800 dark:bg-zinc-950/30"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="transfer" className="text-[10px] font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <ArrowLeftRight className="h-3 w-3" /> Transf.
                    </Label>
                    <Input
                      id="transfer" type="text" placeholder="0"
                      value={splitAmounts.transfer}
                      onChange={(e) => setSplitAmounts(prev => ({ ...prev, transfer: e.target.value.replace(/\D/g, '') }))}
                      disabled={loading}
                      className="h-8 text-xs font-bold rounded-lg border-zinc-200 focus-visible:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-950/30"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="card" className="text-[10px] font-bold text-violet-600 dark:text-violet-400 flex items-center gap-1">
                      <CreditCard className="h-3 w-3" /> Tarjeta
                    </Label>
                    <Input
                      id="card" type="text" placeholder="0"
                      value={splitAmounts.card}
                      onChange={(e) => setSplitAmounts(prev => ({ ...prev, card: e.target.value.replace(/\D/g, '') }))}
                      disabled={loading}
                      className="h-8 text-xs font-bold rounded-lg border-zinc-200 focus-visible:ring-violet-500 dark:border-zinc-800 dark:bg-zinc-950/30"
                    />
                  </div>
                </div>
                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-center text-xs">
                  <span className="font-bold text-zinc-500">Total Sumado:</span>
                  <span className="font-extrabold text-zinc-900 dark:text-zinc-50 text-sm tabular-nums">
                    ${combinedTotal.toLocaleString('es-CL')}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amount" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Monto ($)
                  </Label>
                  <Input
                    id="amount" type="text" placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                    disabled={loading}
                    className="h-10 font-bold text-base border-zinc-200 focus-visible:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/50 rounded-xl"
                  />
                  {linesTotal > 0 && amount !== linesTotal.toString() && (
                    <button
                      type="button"
                      onClick={() => setAmount(linesTotal.toString())}
                      className="text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer underline underline-offset-2 transition-colors"
                    >
                      Usar subtotal de productos: ${linesTotal.toLocaleString('es-CL')}
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Método de Pago
                  </Label>
                  <div className="flex gap-1.5">
                    {([
                      { key: 'cash',     label: 'Efectivo', Icon: Coins,          active: 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold' },
                      { key: 'transfer', label: 'Transf.',  Icon: ArrowLeftRight,  active: 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold' },
                      { key: 'card',     label: 'Tarjeta',  Icon: CreditCard,      active: 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400 font-bold' },
                    ] as const).map(({ key, label, Icon, active }) => (
                      <Button
                        key={key}
                        type="button"
                        variant="outline"
                        onClick={() => setPaymentMethod(key)}
                        disabled={loading}
                        className={`flex-1 h-9 rounded-xl border text-xs gap-1.5 cursor-pointer transition-all ${
                          paymentMethod === key ? active : 'border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Client section */}
            <div className="rounded-xl border border-zinc-200/70 dark:border-zinc-700/50 overflow-hidden">
              {/* Toggle header */}
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setShowClientPhone(!showClientPhone)
                  if (showClientPhone) { setClientPhone(''); setClientName('') }
                }}
                className={`flex items-center justify-between w-full px-4 py-3 text-xs font-semibold transition-colors cursor-pointer ${
                  showClientPhone
                    ? 'bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100'
                    : 'bg-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex items-center justify-center w-5 h-5 rounded-md transition-colors ${
                    showClientPhone ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-zinc-100 dark:bg-zinc-800'
                  }`}>
                    <User className="h-3 w-3" />
                  </div>
                  <span>{showClientPhone ? 'Datos del cliente' : '+ Asociar cliente'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {showClientPhone && clientPhone && (
                    <span className="text-[10px] font-normal text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                      {clientPhone}
                    </span>
                  )}
                  <Phone className="h-3.5 w-3.5 text-zinc-400" />
                </div>
              </button>

              {/* Expandable fields */}
              {showClientPhone && (
                <div className="px-4 pb-4 pt-3 space-y-3 border-t border-zinc-100 dark:border-zinc-800 animate-in slide-in-from-top-2 duration-150 bg-zinc-50/50 dark:bg-zinc-800/20">
                  {/* Name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="client-name" className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                      Nombre <span className="text-zinc-400 normal-case font-normal">(opcional)</span>
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
                      <Input
                        id="client-name"
                        placeholder="Ej. María González"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        disabled={loading}
                        className="pl-9 h-9 rounded-xl border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-xs"
                      />
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="space-y-1.5">
                    <Label htmlFor="client-phone" className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                      Teléfono
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
                      <Input
                        id="client-phone"
                        placeholder="Ej. 56912345678"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value.replace(/\D/g, ''))}
                        disabled={loading}
                        className="pl-9 h-9 rounded-xl border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-xs"
                      />
                    </div>
                    {clientPhone && clientName && (
                      <p className="text-[10px] text-zinc-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        Si el número ya existe, se actualizará el nombre del cliente.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Alerts */}
            {errorMsg && (
              <div className="flex items-start gap-2 p-3 text-xs text-red-600 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-xl font-medium">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
            {successMsg && (
              <div className="flex items-start gap-2 p-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200/50 dark:text-emerald-400 dark:bg-emerald-950/20 dark:border-emerald-900/30 rounded-xl font-medium">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}
          </div>

          {/* Footer */}
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
              className="h-9 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex-1 sm:flex-none flex items-center justify-center gap-1.5 transition-all"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /><span>Guardando...</span></>
              ) : (
                <span>{isEditMode ? 'Actualizar Venta' : 'Registrar Venta'}</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
