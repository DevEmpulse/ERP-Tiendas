'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Coins, ArrowLeftRight, CreditCard, Phone, Loader2, CheckCircle2, AlertCircle, User, Package } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProductItem {
  id: string
  quantity: string
  detail: string
  unitPrice: string
}

interface SalesFormProps {
  profile: {
    id: string
    store_id: string
    name: string | null
    role: string | null
  }
}

export default function SalesForm({ profile }: SalesFormProps) {
  // Product list state
  const [products, setProducts] = useState<ProductItem[]>([
    { id: '1', quantity: '1', detail: '', unitPrice: '' }
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
  
  // Client details states
  const [showClientDetails, setShowClientDetails] = useState(false)
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  
  // Common states
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Calculations for combined payment
  const cashNum = parseInt(splitAmounts.cash || '0', 10)
  const transferNum = parseInt(splitAmounts.transfer || '0', 10)
  const cardNum = parseInt(splitAmounts.card || '0', 10)
  const combinedTotal = cashNum + transferNum + cardNum

  // Format currency helper (CLP standard representation, e.g. $15.000)
  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'number' ? value : parseInt(value, 10)
    if (isNaN(num)) return ''
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(num)
  }

  // Get subtotal for a specific product item
  const getProductSubtotal = (p: ProductItem) => {
    const q = parseInt(p.quantity || '0', 10)
    const price = parseInt(p.unitPrice || '0', 10)
    return q * price
  }

  // Get total sum of all products
  const productsTotal = products.reduce((acc, p) => acc + getProductSubtotal(p), 0)

  // Product management actions
  const addProductRow = () => {
    setProducts(prev => [
      ...prev,
      { id: Math.random().toString(), quantity: '1', detail: '', unitPrice: '' }
    ])
  }

  const removeProductRow = (id: string) => {
    if (products.length === 1) return
    setProducts(prev => prev.filter(p => p.id !== id))
  }

  const updateProductField = (id: string, field: keyof ProductItem, value: string) => {
    setProducts(prev =>
      prev.map(p => {
        if (p.id !== id) return p
        
        let cleanValue = value
        if (field === 'quantity' || field === 'unitPrice') {
          cleanValue = value.replace(/\D/g, '')
        }
        
        return {
          ...p,
          [field]: cleanValue
        }
      })
    )
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
    
    // Filter out rows without product description details
    const validProducts = products.filter(p => p.detail.trim() !== '')

    if (validProducts.length === 0) {
      showToast('Por favor, ingresa al menos un producto con descripción.', 'error')
      return
    }

    if (productsTotal <= 0) {
      showToast('El total de la venta debe ser mayor a 0.', 'error')
      return
    }

    if (isCombined) {
      if (combinedTotal !== productsTotal) {
        showToast(`La suma de los pagos (${formatCurrency(combinedTotal)}) debe coincidir con el total de la venta (${formatCurrency(productsTotal)}).`, 'error')
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

      // 1. Process client details if toggle is active and fields are filled
      if (showClientDetails) {
        const cleanPhone = clientPhone.replace(/\D/g, '')
        const trimmedName = clientName.trim()

        if (cleanPhone.length > 0) {
          // A: Client phone is provided -> lookup by phone and store_id
          const { data: existingClient, error: fetchError } = await supabase
            .from('clients')
            .select('id, name')
            .eq('store_id', storeId)
            .eq('phone', cleanPhone)
            .maybeSingle()

          if (fetchError) throw fetchError

          if (existingClient) {
            clientId = existingClient.id
            // If user typed a name and it differs from the saved name, update it
            if (trimmedName && existingClient.name !== trimmedName) {
              const { error: updateError } = await supabase
                .from('clients')
                .update({ name: trimmedName })
                .eq('id', existingClient.id)

              if (updateError) throw updateError
            }
          } else {
            // Create new client profile with phone and optional name
            const { data: newClient, error: insertError } = await supabase
              .from('clients')
              .insert({
                store_id: storeId,
                phone: cleanPhone,
                name: trimmedName || null
              })
              .select('id')
              .single()

            if (insertError) throw insertError
            if (newClient) {
              clientId = newClient.id
            }
          }
        } else if (trimmedName) {
          // B: No phone provided, but name is provided -> Create client by name only
          const { data: newClient, error: insertError } = await supabase
            .from('clients')
            .insert({
              store_id: storeId,
              phone: null,
              name: trimmedName
            })
            .select('id')
            .single()

          if (insertError) throw insertError
          if (newClient) {
            clientId = newClient.id
          }
        }
      }

      // 3. Compile transaction description: e.g. "1x remera ($15.000), 2x gorra ($5.000)"
      const compiledDesc = validProducts
        .map(p => {
          const qty = p.quantity || '1'
          const detail = p.detail.trim()
          const price = formatCurrency(p.unitPrice || '0')
          return `${qty}x ${detail} (${price})`
        })
        .join(', ')

      // 4. Insert Sale(s)
      if (isCombined) {
        // Generate a 4-character transaction identifier (e.g. #A4F9)
        const txnRef = Math.random().toString(36).substring(2, 6).toUpperCase()
        const salesToInsert: any[] = []

        if (cashNum > 0) {
          salesToInsert.push({
            store_id: storeId,
            employee_id: employeeId,
            description: `${compiledDesc} (Efectivo - Ref: #${txnRef})`,
            payment_method: 'cash',
            total_amount: cashNum,
            client_id: clientId
          })
        }

        if (transferNum > 0) {
          salesToInsert.push({
            store_id: storeId,
            employee_id: employeeId,
            description: `${compiledDesc} (Transferencia - Ref: #${txnRef})`,
            payment_method: 'transfer',
            total_amount: transferNum,
            client_id: clientId
          })
        }

        if (cardNum > 0) {
          salesToInsert.push({
            store_id: storeId,
            employee_id: employeeId,
            description: `${compiledDesc} (Tarjeta - Ref: #${txnRef})`,
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
            description: compiledDesc,
            payment_method: paymentMethod,
            total_amount: productsTotal,
            client_id: clientId
          })

        if (saleError) throw saleError
      }

      // Success feedback
      showToast('¡Venta registrada con éxito!', 'success')
      
      // Clean form fields
      setProducts([{ id: '1', quantity: '1', detail: '', unitPrice: '' }])
      setPaymentMethod('cash')
      setSplitAmounts({ cash: '', transfer: '', card: '' })
      setClientName('')
      setClientPhone('')
      setShowClientDetails(false)
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
            Ingresa los productos o servicios de esta transacción.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Products List Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between pb-1">
                <Label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <Package className="h-4 w-4 text-zinc-400 shrink-0" />
                  <span>Productos / Servicios</span>
                </Label>
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full select-none">
                  {products.length} {products.length === 1 ? 'Ítem' : 'Ítems'}
                </span>
              </div>

              {/* Grid Column Titles */}
              <div className="flex items-center gap-2 mb-1 px-1 select-none">
                <span className="w-11 text-center text-[10px] font-extrabold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase">Cant</span>
                <span className="flex-1 text-left text-[10px] font-extrabold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase pl-1">Detalle</span>
                <span className="w-20 text-center text-[10px] font-extrabold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase">P. Unit</span>
                <span className="w-22 text-center text-[10px] font-extrabold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase">Importe</span>
                <span className="w-9"></span> {/* Spacer for remove button */}
              </div>

              {/* Product Rows */}
              <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                {products.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 animate-in fade-in duration-150">
                    {/* CANT Input */}
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={p.quantity}
                      onChange={(e) => updateProductField(p.id, 'quantity', e.target.value)}
                      placeholder="1"
                      disabled={loading}
                      className="w-11 text-center h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 p-0 text-sm font-bold focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300"
                    />

                    {/* DETALLE Input */}
                    <Input
                      type="text"
                      value={p.detail}
                      onChange={(e) => updateProductField(p.id, 'detail', e.target.value)}
                      placeholder="remera"
                      disabled={loading}
                      className="flex-1 h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 px-3 text-sm focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300"
                    />

                    {/* P. UNIT Input */}
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={p.unitPrice}
                      onChange={(e) => updateProductField(p.id, 'unitPrice', e.target.value)}
                      placeholder="0"
                      disabled={loading}
                      className="w-20 text-center h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 p-0 text-sm font-bold focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300"
                    />

                    {/* IMPORTE Box (ReadOnly Calculated) */}
                    <div className="w-22 h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/30 flex items-center justify-center text-xs font-bold text-zinc-700 dark:text-zinc-300 select-none overflow-hidden text-ellipsis whitespace-nowrap">
                      {formatCurrency(getProductSubtotal(p)) || '$0'}
                    </div>

                    {/* Remove Action Button */}
                    <button
                      type="button"
                      onClick={() => removeProductRow(p.id)}
                      disabled={products.length === 1 || loading}
                      className="w-9 h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 flex items-center justify-center cursor-pointer transition-all duration-200 disabled:opacity-30 disabled:pointer-events-none active:scale-95 text-lg font-bold select-none"
                    >
                      -
                    </button>
                  </div>
                ))}
              </div>

              {/* Add Product Button */}
              <button
                type="button"
                onClick={addProductRow}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 mt-2.5 transition-colors duration-200 cursor-pointer self-start pl-1 select-none"
              >
                <span>+</span> Agregar producto
              </button>
            </div>

            {/* Combined Payment Toggle */}
            <div className="flex items-center justify-between p-3 bg-zinc-50/50 dark:bg-zinc-950/30 rounded-xl border border-zinc-200/50 dark:border-zinc-800/30">
              <div className="space-y-0.5">
                <Label htmlFor="combined-payment" className="text-sm font-bold text-zinc-800 dark:text-zinc-200 cursor-pointer select-none">
                  Pago Combinado 🔀
                </Label>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium select-none">
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
                <div className="flex justify-between items-center text-xs font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider select-none pb-1 border-b border-zinc-200/40 dark:border-zinc-800/40">
                  <span>Desglose de Pago</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Total Venta: {formatCurrency(productsTotal)}</span>
                </div>

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

                {/* Combined Sum Display & Warning */}
                <div className="pt-3.5 border-t border-zinc-200/40 dark:border-zinc-800/40 space-y-2">
                  <div className="flex justify-between items-center select-none">
                    <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Total Sumado:</span>
                    <span className={cn(
                      "text-xl font-extrabold transition-colors duration-200",
                      combinedTotal === productsTotal 
                        ? "text-emerald-600 dark:text-emerald-400" 
                        : "text-amber-500 dark:text-amber-400"
                    )}>
                      {formatCurrency(combinedTotal)}
                    </span>
                  </div>

                  {combinedTotal !== productsTotal && (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/5 p-2.5 rounded-xl border border-amber-500/20 animate-in slide-in-from-top-1 duration-150 select-none">
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                      <span>
                        {combinedTotal < productsTotal 
                          ? `Faltan registrar ${formatCurrency(productsTotal - combinedTotal)}` 
                          : `Sobra un excedente de ${formatCurrency(combinedTotal - productsTotal)}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Single Payment Form Section */
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Total amount visual display instead of user amount input */}
                <div className="p-4 bg-zinc-50/50 dark:bg-zinc-950/30 rounded-2xl border border-zinc-200/50 dark:border-zinc-800/30 flex justify-between items-center select-none">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Total a Cobrar</span>
                    <p className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50">
                      {formatCurrency(productsTotal) || '$0'}
                    </p>
                  </div>
                  <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-lg">
                    $
                  </div>
                </div>

                {/* Single Payment Method Buttons */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 select-none">
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

            {/* Collapsible Client Details Section */}
            <div className="pt-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => setShowClientDetails(!showClientDetails)}
                className="w-full flex items-center justify-between py-2 text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors duration-200"
              >
                <span>{showClientDetails ? "- Ocultar datos del cliente" : "+ ¿El cliente quiere dejar sus datos?"}</span>
                <User className={cn("h-4 w-4 transition-transform duration-200", showClientDetails && "rotate-180")} />
              </button>
              
              {showClientDetails && (
                <div className="pt-2 pb-1 space-y-3 animate-in slide-in-from-top-2 duration-200">
                  {/* Client Name Input */}
                  <div className="space-y-1">
                    <Label htmlFor="clientName" className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                      Nombre del Cliente
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                      <Input
                        id="clientName"
                        type="text"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="Ej. Juan Pérez"
                        disabled={loading}
                        className="pl-10 h-11 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300 transition-all duration-200"
                      />
                    </div>
                  </div>

                  {/* Client Phone Input */}
                  <div className="space-y-1">
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
                </div>
              )}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading || (isCombined && combinedTotal !== productsTotal)}
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
