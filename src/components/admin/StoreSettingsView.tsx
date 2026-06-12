'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Settings, Printer, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface StoreSettingsViewProps {
  storeId: string | null
  currentPaperWidth: '58mm' | '80mm'
  onPaperWidthChange: (w: '58mm' | '80mm') => void
}

const PAPER_OPTIONS: { value: '58mm' | '80mm'; label: string; description: string }[] = [
  {
    value: '58mm',
    label: '58 mm',
    description: 'Rollo estándar para impresoras de bolsillo y cajas pequeñas. El más común en comercios.',
  },
  {
    value: '80mm',
    label: '80 mm',
    description: 'Rollo ancho para impresoras POS profesionales. Mayor espacio para detalles.',
  },
]

export function StoreSettingsView({ storeId, currentPaperWidth, onPaperWidthChange }: StoreSettingsViewProps) {
  const [selected, setSelected] = useState<'58mm' | '80mm'>(currentPaperWidth)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const supabase = createClient()

  const isDirty = selected !== currentPaperWidth

  const handleSave = async () => {
    if (!storeId || !isDirty) return
    setSaving(true)
    setStatus('idle')
    try {
      const { error } = await supabase
        .from('stores')
        .update({ thermal_paper_width: selected })
        .eq('id', storeId)
      if (error) throw error
      onPaperWidthChange(selected)
      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err) {
      console.error('Error saving paper width:', err)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 4000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-1.5 border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2.5">
          <Settings className="h-6 w-6 text-zinc-900 dark:text-white" />
          Configuración de Tienda
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Ajustes generales de tu tienda. Los cambios aplican a todos los dispositivos.
        </p>
      </div>

      {/* Thermal printer section */}
      <div className="max-w-xl space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <Printer className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Ancho del papel térmico</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Configurá el tamaño de papel de tu impresora térmica para el ticket de venta.
            </p>
          </div>
        </div>

        {/* Option cards */}
        <div className="grid grid-cols-2 gap-3">
          {PAPER_OPTIONS.map(opt => {
            const isActive = selected === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelected(opt.value)}
                className={cn(
                  'relative flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer',
                  isActive
                    ? 'border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-50 shadow-lg'
                    : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-500'
                )}
              >
                {/* Ticket visual preview */}
                <div className={cn(
                  'mx-auto rounded border flex flex-col gap-0.5 p-1.5 transition-all',
                  isActive ? 'border-zinc-600 dark:border-zinc-400 bg-zinc-800 dark:bg-zinc-100' : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800',
                  opt.value === '58mm' ? 'w-8' : 'w-12'
                )}>
                  {[1, 0.6, 0.6, 0.6, 1].map((op, i) => (
                    <div
                      key={i}
                      className={cn(
                        'h-0.5 rounded-full w-full',
                        isActive ? 'bg-zinc-500 dark:bg-zinc-400' : 'bg-zinc-300 dark:bg-zinc-600'
                      )}
                      style={{ opacity: op }}
                    />
                  ))}
                </div>

                <div>
                  <p className={cn(
                    'text-sm font-black',
                    isActive ? 'text-white dark:text-zinc-900' : 'text-zinc-900 dark:text-zinc-50'
                  )}>
                    {opt.label}
                  </p>
                  <p className={cn(
                    'text-[10px] leading-tight mt-0.5',
                    isActive ? 'text-zinc-400 dark:text-zinc-600' : 'text-zinc-400 dark:text-zinc-500'
                  )}>
                    {opt.description}
                  </p>
                </div>

                {/* Predeterminado badge */}
                {opt.value === '58mm' && (
                  <span className={cn(
                    'absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full',
                    isActive
                      ? 'bg-zinc-700 dark:bg-zinc-200 text-zinc-200 dark:text-zinc-800'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                  )}>
                    Default
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Save button + status */}
        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="h-10 px-6 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 text-sm font-bold cursor-pointer transition-all disabled:opacity-40 flex items-center gap-2"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</>
            ) : (
              'Guardar cambios'
            )}
          </Button>

          {status === 'success' && (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400 animate-in fade-in slide-in-from-left-2 duration-200">
              <CheckCircle2 className="h-4 w-4" />
              Guardado correctamente
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400 animate-in fade-in slide-in-from-left-2 duration-200">
              <AlertCircle className="h-4 w-4" />
              Error al guardar
            </span>
          )}
        </div>

        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Este ajuste afecta el formato del ticket al usar "Imprimir Ticket" después de registrar una venta.
        </p>
      </div>
    </div>
  )
}
