'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Coins,
  ArrowLeftRight,
  CreditCard,
  User,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

type PaymentMethod = 'cash' | 'transfer' | 'card'
type DiscountType = 'percent' | 'fixed'

export interface SplitAmounts {
  cash: string
  transfer: string
  card: string
}

interface PosSubmitPanelProps {
  subtotal: number
  paymentMethod: PaymentMethod
  isCombined: boolean
  splitAmounts: SplitAmounts
  clientName: string
  clientPhone: string
  loading: boolean
  discountType: DiscountType | null
  discountValue: string
  discountAmount: number
  finalTotal: number
  onPaymentMethodChange: (m: PaymentMethod) => void
  onIsCombinedChange: (v: boolean) => void
  onSplitAmountsChange: (s: SplitAmounts) => void
  onClientNameChange: (v: string) => void
  onClientPhoneChange: (v: string) => void
  onDiscountTypeChange: (t: DiscountType | null) => void
  onDiscountValueChange: (v: string) => void
  onSubmit: () => void
}

function formatCLP(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value)
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { value: 'cash',     label: 'Efectivo',      Icon: Coins },
  { value: 'transfer', label: 'Transferencia', Icon: ArrowLeftRight },
  { value: 'card',     label: 'Tarjeta',       Icon: CreditCard },
]

export function PosSubmitPanel({
  subtotal,
  paymentMethod,
  isCombined,
  splitAmounts,
  clientName,
  clientPhone,
  loading,
  discountType,
  discountValue,
  discountAmount,
  finalTotal,
  onPaymentMethodChange,
  onIsCombinedChange,
  onSplitAmountsChange,
  onClientNameChange,
  onClientPhoneChange,
  onDiscountTypeChange,
  onDiscountValueChange,
  onSubmit,
}: PosSubmitPanelProps) {
  const [showClient, setShowClient] = useState(false)
  const [showDiscount, setShowDiscount] = useState(false)

  const cashNum = parseInt(splitAmounts.cash || '0', 10)
  const transferNum = parseInt(splitAmounts.transfer || '0', 10)
  const cardNum = parseInt(splitAmounts.card || '0', 10)
  const combinedTotal = cashNum + transferNum + cardNum
  const combinedDiff = combinedTotal - finalTotal

  const isSubmitDisabled = loading || finalTotal <= 0 || (isCombined && combinedTotal !== finalTotal)

  const hasDiscount = discountAmount > 0
  const discountLabel = discountType === 'percent'
    ? `Descuento (${discountValue || '0'}%)`
    : 'Descuento'

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 space-y-6 shadow-xs lg:sticky lg:top-24 self-start">

      {/* Total Display */}
      {!hasDiscount ? (
        <div className="flex items-baseline justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            Total a cobrar
          </span>
          <span className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 tabular-nums tracking-tight">
            {formatCLP(finalTotal)}
          </span>
        </div>
      ) : (
        <div className="pb-4 border-b border-zinc-100 dark:border-zinc-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCLP(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between text-xs font-semibold text-amber-600 dark:text-amber-400">
            <span>{discountLabel}</span>
            <span className="tabular-nums">−{formatCLP(discountAmount)}</span>
          </div>
          <div className="flex items-baseline justify-between pt-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Total a cobrar
            </span>
            <span className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 tabular-nums tracking-tight">
              {formatCLP(finalTotal)}
            </span>
          </div>
        </div>
      )}

      {/* Discount Toggle */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
            Descuento
          </Label>
          <button
            type="button"
            onClick={() => {
              const next = !showDiscount
              setShowDiscount(next)
              if (!next) {
                onDiscountTypeChange(null)
                onDiscountValueChange('')
              }
            }}
            className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer"
          >
            {showDiscount ? 'Quitar descuento' : 'Aplicar descuento'}
          </button>
        </div>

        {showDiscount && (
          <div className="space-y-2.5 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-700/60 animate-in fade-in-0 duration-150">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onDiscountTypeChange('percent')}
                className={cn(
                  'py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer select-none',
                  discountType === 'percent'
                    ? 'bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-50 shadow-xs'
                    : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                )}
              >
                Porcentaje (%)
              </button>
              <button
                type="button"
                onClick={() => onDiscountTypeChange('fixed')}
                className={cn(
                  'py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer select-none',
                  discountType === 'fixed'
                    ? 'bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-50 shadow-xs'
                    : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                )}
              >
                Monto fijo ($)
              </button>
            </div>
            <Input
              type="number"
              min="0"
              value={discountValue}
              onChange={e => onDiscountValueChange(e.target.value)}
              placeholder={discountType === 'percent' ? 'Ej: 10' : 'Ej: 5000'}
              className="h-9 text-xs font-bold text-right bg-white dark:bg-zinc-900"
            />
          </div>
        )}
      </div>

      {/* Payment Method Selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
            Método de pago
          </Label>
          <button
            type="button"
            onClick={() => onIsCombinedChange(!isCombined)}
            className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer"
          >
            {isCombined ? 'Pago simple' : 'Pago combinado'}
          </button>
        </div>

        {!isCombined ? (
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map(({ value, label, Icon }) => {
              const isSelected = paymentMethod === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onPaymentMethodChange(value)}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 py-3.5 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer select-none',
                    isSelected
                      ? 'bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-50 shadow-xs'
                      : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2.5 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-700/60">
            {PAYMENT_METHODS.map(({ value, label, Icon }) => (
              <div key={value} className="flex items-center gap-2">
                <div className="flex items-center gap-2 w-28 shrink-0">
                  <Icon className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{label}</span>
                </div>
                <Input
                  type="number"
                  min="0"
                  value={splitAmounts[value]}
                  onChange={e =>
                    onSplitAmountsChange({ ...splitAmounts, [value]: e.target.value })
                  }
                  placeholder="0"
                  className="h-8 text-xs font-bold text-right bg-white dark:bg-zinc-900"
                />
              </div>
            ))}

            {/* Combined Diff Feedback */}
            <div className={cn(
              'flex justify-between items-center text-xs font-bold pt-2 border-t border-zinc-200/80 dark:border-zinc-700',
              combinedDiff === 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            )}>
              <span>Total asignado:</span>
              <span>
                {formatCLP(combinedTotal)}
                {combinedDiff !== 0 && (
                  <span className="ml-1 font-normal opacity-80">
                    ({combinedDiff > 0 ? `sobran ${formatCLP(combinedDiff)}` : `faltan ${formatCLP(Math.abs(combinedDiff))}`})
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Optional Client Information */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
        <button
          type="button"
          onClick={() => setShowClient(!showClient)}
          className="flex items-center justify-between w-full text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-zinc-400" />
            Datos del cliente (opcional)
          </span>
          {showClient
            ? <ChevronUp className="h-3.5 w-3.5 text-zinc-400" />
            : <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          }
        </button>

        {showClient && (
          <div className="mt-3 space-y-2 animate-in fade-in-0 duration-150">
            <Input
              value={clientName}
              onChange={e => onClientNameChange(e.target.value)}
              placeholder="Nombre y apellido..."
              className="h-9 text-xs"
            />
            <Input
              value={clientPhone}
              onChange={e => onClientPhoneChange(e.target.value)}
              placeholder="Teléfono / WhatsApp..."
              className="h-9 text-xs"
            />
          </div>
        )}
      </div>

      {/* Submit Button */}
      <Button
        onClick={onSubmit}
        disabled={isSubmitDisabled}
        className="w-full h-12 text-sm font-bold rounded-xl cursor-pointer bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-50 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          `Registrar venta${finalTotal > 0 ? ' · ' + formatCLP(finalTotal) : ''}`
        )}
      </Button>

      {isCombined && combinedTotal !== finalTotal && finalTotal > 0 && (
        <p className="text-[11px] text-center text-amber-600 dark:text-amber-400 font-medium">
          El monto ingresado debe igualar al total de ${formatCLP(finalTotal)}
        </p>
      )}
    </div>
  )
}
