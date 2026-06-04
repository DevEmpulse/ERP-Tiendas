'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastType = 'success' | 'error'

export interface Toast {
  id: string
  message: string
  type: ToastType
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'success', duration = 4000) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    const timer = setTimeout(() => dismiss(id), duration)
    timers.current.set(id, timer)
    return id
  }, [dismiss])

  // Cleanup on unmount
  useEffect(() => {
    const t = timers.current
    return () => { t.forEach(clearTimeout); t.clear() }
  }, [])

  return { toasts, toast, dismiss }
}

// ─── Renderer ───────────────────────────────────────────────────────────────
export function Toaster({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md pointer-events-auto',
            'animate-in slide-in-from-top-3 fade-in duration-200',
            t.type === 'success'
              ? 'bg-emerald-50/95 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50/95 dark:bg-red-950/80 border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-300'
          )}
        >
          {t.type === 'success'
            ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            : <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          }
          <p className="flex-1 text-sm font-medium">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
