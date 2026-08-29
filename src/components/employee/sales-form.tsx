'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Coins, ArrowLeftRight, CreditCard, Phone, Loader2, CheckCircle2, AlertCircle, User, Package, Tags } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ReceiptModal, type ReceiptData } from '@/components/shared/ReceiptModal'
import { CATALOG_WRITE_ROLES } from '@/lib/roles'

interface PriceRule {
  id: string
  product_id: string | null
  product_name: string
  quantity: number
  special_price: number
  unit_price: number
}

interface ProductItem {
  id: string
  quantity: string
  detail: string
  unitPrice: string
  importe: string        // editable directly
  importeManual: boolean // true when user manually edited importe
}

interface SalesFormProps {
  profile: {
    id: string
    store_id: string
    name: string | null
    role: string | null
    branch_id: string | null
  }
  storeName?: string
  paperWidth?: '58mm' | '80mm'
}

export default function SalesForm({ profile, storeName = 'Mi Tienda', paperWidth = '58mm' }: SalesFormProps) {
  // Product list state
  const [products, setProducts] = useState<ProductItem[]>([
    { id: '1', quantity: '', detail: '', unitPrice: '', importe: '', importeManual: false }
  ])

  // Price rules from store
  const [priceRules, setPriceRules] = useState<PriceRule[]>([])

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

  // Receipt modal state
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)

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

  // Load price rules on mount
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('product_price_rules')
      .select('id, product_id, product_name, quantity, special_price, unit_price')
      .then(({ data }) => {
        if (data) setPriceRules(data.map((r: Record<string, unknown>) => ({
          ...r,
          quantity: Number(r.quantity),
          special_price: Number(r.special_price),
          unit_price: Number(r.unit_price),
        } as PriceRule)))
      })
  }, [profile.store_id])

  // Get matching price rule for a product row
  const getMatchingRule = (detail: string, quantity: string, productId?: string | null): PriceRule | null => {
    if (!detail.trim()) return null
    const qty = parseInt(quantity || '0', 10)

    if (productId) {
      const byProductId = priceRules.find(
        r => r.product_id === productId && r.quantity === qty
      )
      if (byProductId) return byProductId
    }

    const lower = detail.trim().toLowerCase()
    return priceRules.find(
      r => r.product_name.toLowerCase() === lower && r.quantity === qty
    ) || null
  }

  // Get computed importe for a product item
  const getProductImporte = (p: ProductItem): number => {
    if (p.importe !== '') {
      return parseInt(p.importe || '0', 10)
    }
    const q = parseInt(p.quantity || '0', 10)
    const price = parseInt(p.unitPrice || '0', 10)
    return q * price
  }

  // Get total sum of all products
  const productsTotal = products.reduce((acc, p) => acc + getProductImporte(p), 0)

  // Product management actions
  const addProductRow = () => {
    setProducts(prev => [
      ...prev,
      { id: Math.random().toString(), quantity: '', detail: '', unitPrice: '', importe: '', importeManual: false }
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
        if (field === 'quantity' || field === 'unitPrice' || field === 'importe') {
          cleanValue = value.replace(/\D/g, '')
        }

        const updated = { ...p, [field]: cleanValue }

        if (field === 'quantity' || field === 'unitPrice') {
          // Recalc importe from unitPrice × quantity (resets manual override)
          const qty = parseInt(field === 'quantity' ? cleanValue || '1' : p.quantity || '1', 10)
          const price = parseInt(field === 'unitPrice' ? cleanValue : p.unitPrice || '0', 10)
          const calc = qty * price
          updated.importe = calc > 0 ? calc.toString() : ''
          updated.importeManual = false
        }

        if (field === 'importe') {
          // When importe is edited directly, recalc unit price
          const qty = parseInt(p.quantity || '1', 10)
          const imp = parseInt(cleanValue || '0', 10)
          if (qty > 0 && imp > 0) {
            updated.unitPrice = Math.round(imp / qty).toString()
          }
          updated.importeManual = true
        }

        return updated
      })
    )
  }

  // Apply a price rule suggestion to a product row
  const applyPriceRule = (id: string, rule: PriceRule) => {
    setProducts(prev =>
      prev.map(p => {
        if (p.id !== id) return p
        return {
          ...p,
          unitPrice: rule.unit_price.toString(),
          importe: rule.special_price.toString(),
          importeManual: true,
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
    const branchId = profile.branch_id // non-null for employees (DB CHECK guarantees it)

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
            // If user typed a name and it differs from the saved name, update it (only if role has catalog write permissions)
            if (trimmedName && existingClient.name !== trimmedName && (CATALOG_WRITE_ROLES as readonly string[]).includes(profile.role ?? '')) {
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

      // 3b. Resolve product_id for each product line via a lookup-only,
      // case-insensitive match against active products in this store.
      // Unmatched names stay null — no product is created from this flow.
      const { data: activeProducts } = await supabase
        .from('products')
        .select('id, name')
        .eq('store_id', storeId)
        .eq('is_active', true)

      const productIdByName = new Map<string, string>(
        (activeProducts ?? []).map((prod: { id: string, name: string }) => [prod.name.trim().toLowerCase(), prod.id])
      )

      const buildSaleItemsForSale = (saleId: string) =>
        validProducts.map(p => ({
          store_id: storeId,
          sale_id: saleId,
          product_id: productIdByName.get(p.detail.trim().toLowerCase()) ?? null,
          product_name: p.detail.trim(),
          quantity: parseInt(p.quantity || '1', 10),
          unit_price: parseInt(p.unitPrice || '0', 10),
          subtotal: getProductImporte(p)
        }))

      // 4. Insert Sale(s)
      if (isCombined) {
        // Generate a 4-character transaction identifier (e.g. #A4F9)
        const txnRef = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 4).toUpperCase() : 'TXN1'
        const salesToInsert: Record<string, unknown>[] = []

        if (cashNum > 0) {
          salesToInsert.push({
            store_id: storeId,
            employee_id: employeeId,
            description: `${compiledDesc} (Efectivo - Ref: #${txnRef})`,
            payment_method: 'cash',
            total_amount: cashNum,
            client_id: clientId,
            branch_id: branchId
          })
        }

        if (transferNum > 0) {
          salesToInsert.push({
            store_id: storeId,
            employee_id: employeeId,
            description: `${compiledDesc} (Transferencia - Ref: #${txnRef})`,
            payment_method: 'transfer',
            total_amount: transferNum,
            client_id: clientId,
            branch_id: branchId
          })
        }

        if (cardNum > 0) {
          salesToInsert.push({
            store_id: storeId,
            employee_id: employeeId,
            description: `${compiledDesc} (Tarjeta - Ref: #${txnRef})`,
            payment_method: 'card',
            total_amount: cardNum,
            client_id: clientId,
            branch_id: branchId
          })
        }

        // Insert all combined payment records in a single database query
        const { data: insertedSales, error: saleError } = await supabase
          .from('sales')
          .insert(salesToInsert)
          .select('id')

        if (saleError) throw saleError

        // One full set of sale_items per resulting sales row, mirroring how
        // compiledDesc is duplicated verbatim into every combined-payment row.
        const saleItemsToInsert = (insertedSales ?? []).flatMap((s: { id: string }) => buildSaleItemsForSale(s.id))
        if (saleItemsToInsert.length > 0) {
          const { error: saleItemsError } = await supabase
            .from('sale_items')
            .insert(saleItemsToInsert)

          if (saleItemsError) throw saleItemsError
        }
      } else {
        // Single Payment flow
        const { data: insertedSale, error: saleError } = await supabase
          .from('sales')
          .insert({
            store_id: storeId,
            employee_id: employeeId,
            description: compiledDesc,
            payment_method: paymentMethod,
            total_amount: productsTotal,
            client_id: clientId,
            branch_id: branchId
          })
          .select('id')
          .single()

        if (saleError) throw saleError

        if (insertedSale) {
          const { error: saleItemsError } = await supabase
            .from('sale_items')
            .insert(buildSaleItemsForSale(insertedSale.id))

          if (saleItemsError) throw saleItemsError
        }
      }

      // Build receipt data and open modal
      const payments: ReceiptData['payments'] = isCombined
        ? [
            ...(cashNum > 0    ? [{ method: 'cash'     as const, amount: cashNum }]     : []),
            ...(transferNum > 0 ? [{ method: 'transfer' as const, amount: transferNum }] : []),
            ...(cardNum > 0    ? [{ method: 'card'     as const, amount: cardNum }]     : []),
          ]
        : [{ method: paymentMethod, amount: productsTotal }]

      const receiptProducts = validProducts.map(p => ({
        cant: parseInt(p.quantity || '1', 10),
        detalle: p.detail.trim(),
        p_unit: parseInt(p.unitPrice || '0', 10),
        importe: getProductImporte(p),
      }))

      setReceiptData({
        storeName,
        employeeName: profile.name ?? 'Empleado/a',
        clientName: clientName.trim() || null,
        clientPhone: clientPhone.trim() || null,
        createdAt: new Date().toISOString(),
        products: receiptProducts,
        payments,
        totalAmount: productsTotal,
        isCombined,
        paperWidth,
      })
      setShowReceipt(true)
    } catch (err: unknown) {
      console.error('Error registering sale:', err)
      const message = err instanceof Error ? err.message : 'Error al registrar la venta. Inténtalo de nuevo.'
      showToast(message, 'error')
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

  // Reset form after closing receipt
  const handleReceiptClose = () => {
    setShowReceipt(false)
    setReceiptData(null)
    setProducts([{ id: '1', quantity: '', detail: '', unitPrice: '', importe: '', importeManual: false }])
    setPaymentMethod('cash')
    setSplitAmounts({ cash: '', transfer: '', card: '' })
    setClientName('')
    setClientPhone('')
    setShowClientDetails(false)
    setIsCombined(false)
    showToast('¡Venta registrada con éxito!', 'success')
  }

  return (
    <>
      {/* Receipt Modal */}
      <ReceiptModal open={showReceipt} onClose={handleReceiptClose} data={receiptData} />

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
            <div className="space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <Package className="h-4 w-4 text-zinc-400 shrink-0" />
                  <span>Productos / Servicios</span>
                </Label>
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 rounded-full select-none tabular-nums">
                  {products.length} {products.length === 1 ? 'ítem' : 'ítems'}
                </span>
              </div>

              {/* Product Cards */}
              <div className="space-y-2">
                {products.map((p, idx) => {
                  const matchingRule = getMatchingRule(p.detail, p.quantity)
                  const displayImporte = p.importe !== ''
                    ? p.importe
                    : (() => {
                        const q = parseInt(p.quantity || '0', 10)
                        const u = parseInt(p.unitPrice || '0', 10)
                        const calc = q * u
                        return calc > 0 ? calc.toString() : ''
                      })()
                  const importeNum = parseInt(displayImporte || '0', 10)
                  const unitPriceNum = parseInt(p.unitPrice || '0', 10)

                  return (
                    <div
                      key={p.id}
                      className={cn(
                        "relative rounded-2xl border pt-4 pb-3 px-3 transition-all duration-200 animate-in fade-in duration-150",
                        p.importeManual
                          ? "border-amber-200/80 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-950/10"
                          : "border-zinc-200/80 dark:border-zinc-800/60 bg-white/60 dark:bg-zinc-900/40"
                      )}
                    >
                      {/* Row index pill */}
                      <span className="absolute top-1.5 left-3 text-[9px] font-bold text-zinc-400 dark:text-zinc-500 select-none">
                        #{idx + 1}
                      </span>

                      {/* Detalle + Remove */}
                      <div className="flex items-center gap-2 mb-3">
                        <Input
                          type="text"
                          value={p.detail}
                          onChange={(e) => updateProductField(p.id, 'detail', e.target.value)}
                          placeholder="Nombre del producto o servicio..."
                          disabled={loading}
                          className="flex-1 h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-950/60 px-3 text-sm font-medium placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-300"
                        />
                        <button
                          type="button"
                          onClick={() => removeProductRow(p.id)}
                          disabled={products.length === 1 || loading}
                          className="h-10 w-10 rounded-xl flex items-center justify-center text-zinc-300 dark:text-zinc-600 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/30 transition-all duration-200 cursor-pointer disabled:opacity-0 disabled:pointer-events-none shrink-0"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>

                      {/* Cant × PUnit = Importe row */}
                      <div className="flex items-end gap-2">

                        {/* CANT */}
                        <div className="flex flex-col gap-1 shrink-0">
                          <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider select-none text-center">Cant</span>
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={p.quantity}
                            onChange={(e) => updateProductField(p.id, 'quantity', e.target.value)}
                            placeholder="1"
                            disabled={loading}
                            className="w-12 h-9 text-center rounded-xl border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-950/60 p-0 text-sm font-bold focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-300"
                          />
                        </div>

                        <span className="text-zinc-300 dark:text-zinc-600 font-bold text-sm select-none pb-2">×</span>

                        {/* P. UNIT */}
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider select-none">P. unitario</span>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400 dark:text-zinc-500 select-none pointer-events-none">$</span>
                            <Input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={p.unitPrice}
                              onChange={(e) => updateProductField(p.id, 'unitPrice', e.target.value)}
                              placeholder="0"
                              disabled={loading}
                              className="h-9 pl-6 rounded-xl border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-950/60 text-sm font-bold focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-300 w-full"
                            />
                          </div>
                          {unitPriceNum > 0 && (
                            <span className="text-[9px] text-zinc-400 dark:text-zinc-500 pl-0.5 tabular-nums">
                              {formatCurrency(unitPriceNum)} c/u
                            </span>
                          )}
                        </div>

                        <span className="text-zinc-300 dark:text-zinc-600 font-bold text-sm select-none pb-2">=</span>

                        {/* IMPORTE */}
                        <div className="flex flex-col gap-1 shrink-0">
                          <span className={cn(
                            "text-[9px] font-bold uppercase tracking-wider select-none text-center",
                            p.importeManual ? "text-amber-500 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500"
                          )}>
                            {p.importeManual ? 'Total ✏' : 'Total'}
                          </span>
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={displayImporte}
                            onChange={(e) => updateProductField(p.id, 'importe', e.target.value)}
                            placeholder="0"
                            disabled={loading}
                            className={cn(
                              "h-9 w-24 text-center rounded-xl text-sm font-extrabold focus-visible:ring-2 transition-all duration-200",
                              p.importeManual
                                ? "border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 focus-visible:ring-amber-400"
                                : "border-zinc-200 dark:border-zinc-700 bg-zinc-100/80 dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-100 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-300"
                            )}
                          />
                          {importeNum > 0 && (
                            <span className={cn(
                              "text-[9px] font-semibold text-center tabular-nums",
                              p.importeManual ? "text-amber-500 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500"
                            )}>
                              {formatCurrency(importeNum)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Price Rule Suggestion */}
                      {matchingRule && !p.importeManual && (
                        <button
                          type="button"
                          onClick={() => applyPriceRule(p.id, matchingRule)}
                          disabled={loading}
                          className="mt-3 w-full flex items-center justify-between gap-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 px-3 py-2 rounded-xl hover:bg-amber-100 dark:hover:bg-amber-950/70 transition-all duration-150 cursor-pointer select-none animate-in fade-in slide-in-from-bottom-1 duration-150"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Tags className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                            <span className="truncate">
                              💡 Precio especial ×{matchingRule.quantity}:
                              <span className="ml-1 font-extrabold">{formatCurrency(matchingRule.special_price)}</span>
                            </span>
                          </div>
                          <span className="text-[10px] font-bold bg-amber-200/70 dark:bg-amber-800/50 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full shrink-0">
                            Aplicar →
                          </span>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Add Product Button */}
              <button
                type="button"
                onClick={addProductRow}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-bold text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-all duration-200 cursor-pointer select-none"
              >
                <span className="text-base leading-none">+</span>
                Agregar producto
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
