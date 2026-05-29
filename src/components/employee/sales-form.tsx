'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Coins, ArrowLeftRight, CreditCard, Phone, Loader2, CheckCircle2, AlertCircle, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SalesFormProps {
  profile: {
    id: string
    store_id: string
    name: string | null
    role: string | null
  }
}

export default function SalesForm({ profile }: SalesFormProps) {
  // Product items state
  const [items, setItems] = useState<{ cant: number; detalle: string; p_unit: string }[]>([
    { cant: 1, detalle: '', p_unit: '' }
  ])
  
  // Single payment states
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'card'>('cash')
  
  // Combined payment states
  const [isCombined, setIsCombined] = useState(false)
  const [splitAmounts, setSplitAmounts] = useState({
    cash: '',
    transfer: '',
    card: ''
  })
  
  // Common states
  const [showClientPhone, setShowClientPhone] = useState(false)
  const [clientPhone, setClientPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Calculations for combined payment
  const cashNum = parseInt(splitAmounts.cash || '0', 10)
  const transferNum = parseInt(splitAmounts.transfer || '0', 10)
  const cardNum = parseInt(splitAmounts.card || '0', 10)
  const combinedTotal = cashNum + transferNum + cardNum

  // Calculate item amount (importe)
  const getItemImporte = (item: { cant: number; p_unit: string }) => {
    const price = parseInt(item.p_unit || '0', 10)
    return item.cant * price
  }

  // Calculate total sale amount
  const totalAmount = items.reduce((sum, item) => sum + getItemImporte(item), 0)

  // Format currency helper (CLP standard representation, e.g. $15.000)
  const formatCurrency = (value: string) => {
    if (!value) return ''
    const num = parseInt(value, 10)
    if (isNaN(num)) return ''
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(num)
  }

  const handleItemChange = (index: number, field: 'cant' | 'detalle' | 'p_unit', value: any) => {
    setItems(prev => {
      const copy = [...prev]
      if (field === 'cant') {
        const val = parseInt(value, 10)
        copy[index].cant = isNaN(val) ? 1 : Math.max(1, val)
      } else if (field === 'p_unit') {
        const cleanValue = value.replace(/\D/g, '')
        copy[index].p_unit = cleanValue
      } else {
        copy[index].detalle = value
      }
      return copy
    })
  }

  const addItem = () => {
    setItems(prev => [...prev, { cant: 1, detalle: '', p_unit: '' }])
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(prev => prev.filter((_, idx) => idx !== index))
    }
  }

  const handleSplitAmountChange = (method: 'cash' | 'transfer' | 'card', value: string) => {
    const cleanValue = value.replace(/\D/g, '')
    setSplitAmounts(prev => ({
      ...prev,
      [method]: cleanValue
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validations
    const hasEmptyDetalle = items.some(item => !item.detalle.trim())
    if (hasEmptyDetalle) {
      showToast('Por favor, ingresa el detalle para todos los productos.', 'error')
      return
    }

    const hasInvalidPrice = items.some(item => !item.p_unit || parseInt(item.p_unit, 10) <= 0)
    if (hasInvalidPrice) {
      showToast('Por favor, ingresa un precio unitario válido para todos los productos.', 'error')
      return
    }

    if (totalAmount <= 0) {
      showToast('El total de la venta debe ser mayor a $0.', 'error')
      return
    }

    if (isCombined) {
      if (combinedTotal !== totalAmount) {
        showToast(`El total de los métodos de pago (${formatCurrency(combinedTotal.toString())}) debe ser igual al total de los productos (${formatCurrency(totalAmount.toString())}).`, 'error')
        return
      }
    }

    setLoading(true)
    setToast(null)
    const supabase = createClient()
    const storeId = profile.store_id
    const employeeId = profile.id

    try {
      let clientId: string | null = null

      // 1. Process client phone if provided
      if (showClientPhone && clientPhone.trim()) {
        const cleanPhone = clientPhone.replace(/\D/g, '')
        if (cleanPhone.length > 0) {
          // Check if client already exists under this store_id
          const { data: existingClient, error: fetchError } = await supabase
            .from('clients')
            .select('id')
            .eq('store_id', storeId)
            .eq('phone', cleanPhone)
            .maybeSingle()

          if (fetchError) throw fetchError

          if (existingClient) {
            clientId = existingClient.id
          } else {
            // Create client if they don't exist
            const { data: newClient, error: insertError } = await supabase
              .from('clients')
              .insert({
                store_id: storeId,
                phone: cleanPhone,
                name: null
              })
              .select('id')
              .single()

            if (insertError) throw insertError
            if (newClient) {
              clientId = newClient.id
            }
          }
        }
      }

      // Serialize items array to JSON
      const serializedItems = JSON.stringify(
        items.map(item => ({
          cant: item.cant,
          detalle: item.detalle.trim(),
          p_unit: parseInt(item.p_unit || '0', 10),
          importe: item.cant * (parseInt(item.p_unit || '0', 10))
        }))
      )

      // 2. Insert Sale(s)
      if (isCombined) {
        // Generate a 4-character transaction identifier (e.g. #A4F9)
        const txnRef = Math.random().toString(36).substring(2, 6).toUpperCase()
        const salesToInsert: any[] = []

        if (cashNum > 0) {
          salesToInsert.push({
            store_id: storeId,
            employee_id: employeeId,
            description: `${serializedItems} (Efectivo - Ref: #${txnRef})`,
            payment_method: 'cash',
            total_amount: cashNum,
            client_id: clientId
          })
        }

        if (transferNum > 0) {
          salesToInsert.push({
            store_id: storeId,
            employee_id: employeeId,
            description: `${serializedItems} (Transferencia - Ref: #${txnRef})`,
            payment_method: 'transfer',
            total_amount: transferNum,
            client_id: clientId
          })
        }

        if (cardNum > 0) {
          salesToInsert.push({
            store_id: storeId,
            employee_id: employeeId,
            description: `${serializedItems} (Tarjeta - Ref: #${txnRef})`,
            payment_method: 'card',
            total_amount: cardNum,
            client_id: clientId
          })
        }

        // Insert all combined payment records in a single database query
        const { error: saleError } = await supabase
          .from('sales')
          .insert(salesToInsert)

        if (saleError) throw saleError
      } else {
        // Single Payment flow
        const { error: saleError } = await supabase
          .from('sales')
          .insert({
            store_id: storeId,
            employee_id: employeeId,
            description: serializedItems,
            payment_method: paymentMethod,
            total_amount: totalAmount,
            client_id: clientId
          })

        if (saleError) throw saleError
      }

      // Success feedback
      showToast('¡Venta registrada con éxito!', 'success')
      
      // Clean form fields
      setItems([{ cant: 1, detalle: '', p_unit: '' }])
      setSplitAmounts({ cash: '', transfer: '', card: '' })
      setClientPhone('')
      setShowClientPhone(false)
      setIsCombined(false)
    } catch (err: any) {
      console.error('Error registering sale:', err)
      showToast(err.message || 'Error al registrar la venta. Inténtalo de nuevo.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => {
      setToast(null)
    }, 4000)
  }

  return (
    <>
      {/* Toast Notification Container */}
      {toast && (
        <div 
          className={cn(
            "fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm p-4 rounded-xl border shadow-lg backdrop-blur-md transition-all duration-300 animate-in slide-in-from-top-4 fade-in",
            toast.type === 'success' 
              ? "border-emerald-100 dark:border-emerald-950/30 bg-emerald-50/95 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
              : "border-red-100 dark:border-red-950/30 bg-red-50/95 dark:bg-red-950/30 text-red-800 dark:text-red-300"
          )}
        >
          <div className="flex items-center gap-3">
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            )}
            <p className="text-sm font-medium">{toast.message}</p>
          </div>
        </div>
      )}

      <Card className="border border-zinc-200/80 bg-white/70 backdrop-blur-xl shadow-xl dark:border-zinc-800/50 dark:bg-zinc-900/60 dark:shadow-none rounded-2xl overflow-hidden transition-all duration-300">
        <CardHeader className="pb-4 pt-6">
          <CardTitle className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            Registrar Nueva Venta 💸
          </CardTitle>
          <CardDescription className="text-zinc-500 dark:text-zinc-400">
            Ingresa los detalles del servicio o producto vendido.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Product items list section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                  Productos / Items 📦
                </Label>
              </div>

              {/* Items Headers */}
              <div className="grid grid-cols-12 gap-1.5 sm:gap-3 px-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                <div className="col-span-2 text-center">Cant</div>
                <div className="col-span-4">Detalle</div>
                <div className="col-span-3 text-right">P. Unit</div>
                <div className="col-span-2 text-right">Importe</div>
                <div className="col-span-1"></div>
              </div>

              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1.5 sm:gap-3 items-center group animate-in fade-in duration-150">
                    {/* Cantidad input */}
                    <div className="col-span-2">
                      <Input
                        type="number"
                        min="1"
                        value={item.cant}
                        onChange={(e) => handleItemChange(idx, 'cant', e.target.value)}
                        disabled={loading}
                        className="h-9 px-1 text-center font-bold text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 focus-visible:ring-1 focus-visible:ring-zinc-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>

                    {/* Detalle input */}
                    <div className="col-span-4">
                      <Input
                        type="text"
                        placeholder="Ej. Sábana..."
                        value={item.detalle}
                        onChange={(e) => handleItemChange(idx, 'detalle', e.target.value)}
                        disabled={loading}
                        className="h-9 px-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 focus-visible:ring-1 focus-visible:ring-zinc-400"
                      />
                    </div>

                    {/* Precio Unitario input */}
                    <div className="col-span-3 relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-zinc-400">$</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="0"
                        value={item.p_unit}
                        onChange={(e) => handleItemChange(idx, 'p_unit', e.target.value)}
                        disabled={loading}
                        className="h-9 pl-4 pr-1.5 text-right font-semibold text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 focus-visible:ring-1 focus-visible:ring-zinc-400"
                      />
                    </div>

                    {/* Importe display */}
                    <div className="col-span-2 text-right text-xs font-bold text-zinc-700 dark:text-zinc-300 truncate pr-0.5">
                      {formatCurrency(getItemImporte(item).toString()) || '$0'}
                    </div>

                    {/* Delete button */}
                    <div className="col-span-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        disabled={loading || items.length === 1}
                        className="h-8 w-8 flex items-center justify-center text-zinc-450 hover:text-red-500 disabled:opacity-35 disabled:hover:text-zinc-450 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg shrink-0 cursor-pointer transition-all duration-150 active:scale-95"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add item button */}
              <button
                type="button"
                onClick={addItem}
                disabled={loading}
                className="flex items-center gap-1 text-xs font-bold text-zinc-650 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white px-3 py-1.5 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors w-fit shrink-0 cursor-pointer active:scale-97"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Agregar Producto</span>
              </button>
            </div>

            {/* Combined Payment Toggle */}
            <div className="flex items-center justify-between p-3 bg-zinc-50/50 dark:bg-zinc-950/30 rounded-xl border border-zinc-200/50 dark:border-zinc-800/30">
              <div className="space-y-0.5">
                <Label htmlFor="combined-payment" className="text-sm font-bold text-zinc-800 dark:text-zinc-200 cursor-pointer">
                  Pago Combinado 🔀
                </Label>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                  Dividir la venta en múltiples métodos de pago.
                </p>
              </div>
              <button
                type="button"
                id="combined-payment"
                disabled={loading}
                onClick={() => setIsCombined(!isCombined)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300",
                  isCombined ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-800"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out",
                    isCombined ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            {/* Dynamic Payment Input Section */}
            {isCombined ? (
              /* Combined Payment Form Section */
              <div className="space-y-3.5 p-4 bg-zinc-50/20 dark:bg-zinc-950/10 rounded-xl border border-zinc-200/50 dark:border-zinc-800/20 animate-in fade-in duration-200">
                {/* Cash Amount */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="cash-amount" className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <Coins className="h-3.5 w-3.5 shrink-0" />
                      <span>Efectivo</span>
                    </Label>
                    {splitAmounts.cash && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">{formatCurrency(splitAmounts.cash)}</span>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400 dark:text-zinc-500">$</span>
                    <Input
                      id="cash-amount"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={splitAmounts.cash}
                      onChange={(e) => handleSplitAmountChange('cash', e.target.value)}
                      placeholder="0"
                      disabled={loading}
                      className="pl-7 h-10 text-sm font-bold rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 dark:focus-visible:ring-emerald-400 dark:focus-visible:border-emerald-400 transition-all duration-200"
                    />
                  </div>
                </div>

                {/* Transfer Amount */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="transfer-amount" className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                      <span>Transferencia</span>
                    </Label>
                    {splitAmounts.transfer && (
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">{formatCurrency(splitAmounts.transfer)}</span>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400 dark:text-zinc-500">$</span>
                    <Input
                      id="transfer-amount"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={splitAmounts.transfer}
                      onChange={(e) => handleSplitAmountChange('transfer', e.target.value)}
                      placeholder="0"
                      disabled={loading}
                      className="pl-7 h-10 text-sm font-bold rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500 dark:focus-visible:ring-blue-400 dark:focus-visible:border-blue-400 transition-all duration-200"
                    />
                  </div>
                </div>

                {/* Card Amount */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="card-amount" className="text-xs font-bold text-violet-600 dark:text-violet-400 flex items-center gap-1.5">
                      <CreditCard className="h-3.5 w-3.5 shrink-0" />
                      <span>Tarjeta</span>
                    </Label>
                    {splitAmounts.card && (
                      <span className="text-[10px] text-violet-600 dark:text-violet-400 font-semibold">{formatCurrency(splitAmounts.card)}</span>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400 dark:text-zinc-500">$</span>
                    <Input
                      id="card-amount"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={splitAmounts.card}
                      onChange={(e) => handleSplitAmountChange('card', e.target.value)}
                      placeholder="0"
                      disabled={loading}
                      className="pl-7 h-10 text-sm font-bold rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-violet-500 dark:focus-visible:ring-violet-400 dark:focus-visible:border-violet-400 transition-all duration-200"
                    />
                  </div>
                </div>

                {/* Combined Sum Display */}
                <div className="pt-3.5 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                  <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Total Sumado:</span>
                  <span className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50">
                    {combinedTotal > 0 ? formatCurrency(combinedTotal.toString()) : '$0'}
                  </span>
                </div>
              </div>
            ) : (
              /* Single Payment Form Section */
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Single Amount Display */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Total a Pagar
                  </Label>
                  <div className="flex items-center justify-between p-4 bg-zinc-50/50 dark:bg-zinc-950/30 rounded-xl border border-zinc-200/50 dark:border-zinc-800/30">
                    <span className="text-zinc-500 dark:text-zinc-400 text-xs font-semibold">Monto Total</span>
                    <span className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                      {formatCurrency(totalAmount.toString()) || '$0'}
                    </span>
                  </div>
                </div>

                {/* Single Payment Method Buttons */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Método de Pago
                  </Label>
                  <div className="flex gap-2">
                    {/* Cash Card Button */}
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => setPaymentMethod('cash')}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1.5 h-16 rounded-xl border-2 transition-all duration-200 cursor-pointer active:scale-[0.97] disabled:opacity-50 flex-1",
                        paymentMethod === 'cash'
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white/20 dark:bg-zinc-950/20 text-zinc-500 dark:text-zinc-400"
                      )}
                    >
                      <Coins className="h-5 w-5" />
                      <span className="text-xs font-bold">Efectivo</span>
                    </button>

                    {/* Transfer Card Button */}
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => setPaymentMethod('transfer')}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1.5 h-16 rounded-xl border-2 transition-all duration-200 cursor-pointer active:scale-[0.97] disabled:opacity-50 flex-1",
                        paymentMethod === 'transfer'
                          ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 shadow-sm"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white/20 dark:bg-zinc-950/20 text-zinc-500 dark:text-zinc-400"
                      )}
                    >
                      <ArrowLeftRight className="h-5 w-5" />
                      <span className="text-xs font-bold">Transf.</span>
                    </button>

                    {/* Card Button */}
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => setPaymentMethod('card')}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1.5 h-16 rounded-xl border-2 transition-all duration-200 cursor-pointer active:scale-[0.97] disabled:opacity-50 flex-1",
                        paymentMethod === 'card'
                          ? "border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400 shadow-sm"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white/20 dark:bg-zinc-950/20 text-zinc-500 dark:text-zinc-400"
                      )}
                    >
                      <CreditCard className="h-5 w-5" />
                      <span className="text-xs font-bold">Tarjeta</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Collapsible Client Phone Section */}
            <div className="pt-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => setShowClientPhone(!showClientPhone)}
                className="w-full flex items-center justify-between py-2 text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors duration-200"
              >
                <span>{showClientPhone ? "- Ocultar datos del cliente" : "+ ¿El cliente quiere dejar su teléfono?"}</span>
                <Phone className={cn("h-4 w-4 transition-transform duration-200", showClientPhone && "rotate-180")} />
              </button>
              
              {showClientPhone && (
                <div className="pt-2 pb-1 space-y-2 animate-in slide-in-from-top-2 duration-200">
                  <Label htmlFor="clientPhone" className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    Número Celular
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input
                      id="clientPhone"
                      type="tel"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="Ej. +56912345678"
                      disabled={loading}
                      className="pl-10 h-11 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300 transition-all duration-200"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-xl text-sm font-bold bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer shadow-md hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none transition-all duration-200 flex items-center justify-center gap-2 mt-4"
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Registrando venta...</span>
                </>
              ) : (
                <span>Registrar Venta</span>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
