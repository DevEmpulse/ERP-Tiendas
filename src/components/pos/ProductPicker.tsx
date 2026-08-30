'use client'

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Search, Plus, Package, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CartLine, PosProduct } from './types'

interface ProductPickerProps {
  products: PosProduct[]
  onAddLine: (line: Omit<CartLine, 'lineId' | 'subtotal'>) => void
}

interface UnlistedForm {
  name: string
  price: string
}

function formatCLP(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value)
}

export function ProductPicker({ products, onAddLine }: ProductPickerProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [unlistedForm, setUnlistedForm] = useState<UnlistedForm | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toLowerCase()
  const filtered = q.length === 0
    ? products.slice(0, 30)
    : products.filter(
        p => p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q)
      ).slice(0, 30)

  // Reset selection on query change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setUnlistedForm(null)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const selectProduct = (p: PosProduct) => {
    onAddLine({
      productId: p.id,
      productName: p.name,
      barcode: p.barcode,
      quantity: 1,
      unitPrice: p.salePrice ?? 0,
      isUnlisted: false,
    })
    setQuery('')
    setIsOpen(false)
    setUnlistedForm(null)
  }

  const confirmUnlisted = () => {
    if (!unlistedForm || !unlistedForm.name.trim()) return
    const price = parseInt(unlistedForm.price || '0', 10)
    onAddLine({
      productId: null,
      productName: unlistedForm.name.trim(),
      barcode: null,
      quantity: 1,
      unitPrice: price >= 0 ? price : 0,
      isUnlisted: true,
    })
    setQuery('')
    setIsOpen(false)
    setUnlistedForm(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => (prev + 1 < filtered.length ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length > 0 && selectedIndex < filtered.length) {
        selectProduct(filtered[selectedIndex])
      } else if (q.length > 0) {
        setUnlistedForm({ name: query, price: '' })
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setUnlistedForm(null)
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search Input Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setIsOpen(true)
            setUnlistedForm(null)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar producto por nombre o escanear código de barras..."
          className="pl-11 pr-10 h-12 bg-white dark:bg-zinc-900 border-zinc-200/80 dark:border-zinc-800 rounded-xl text-sm font-medium shadow-xs focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-50"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Dropdown Results */}
      {isOpen && (
        <div className="absolute z-50 mt-2 w-full bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-98 duration-100">
          {/* Manual / Unlisted Form */}
          {unlistedForm !== null ? (
            <div className="p-4 space-y-3 bg-zinc-50/80 dark:bg-zinc-900/80 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-amber-500" />
                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                  Agregar producto manual (no listado)
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                <Input
                  autoFocus
                  value={unlistedForm.name}
                  onChange={e => setUnlistedForm(prev => prev ? { ...prev, name: e.target.value } : prev)}
                  placeholder="Descripción del producto..."
                  className="h-10 text-sm font-medium bg-white dark:bg-zinc-950"
                  onKeyDown={e => e.key === 'Enter' && confirmUnlisted()}
                />
                <Input
                  type="number"
                  min="0"
                  value={unlistedForm.price}
                  onChange={e => setUnlistedForm(prev => prev ? { ...prev, price: e.target.value } : prev)}
                  placeholder="Precio ($)"
                  className="h-10 text-sm font-medium bg-white dark:bg-zinc-950 text-right"
                  onKeyDown={e => e.key === 'Enter' && confirmUnlisted()}
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setUnlistedForm(null)}
                  className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmUnlisted}
                  disabled={!unlistedForm.name.trim()}
                  className="px-4 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 text-xs font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Agregar al carrito
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Product list */}
              <div className="max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {filtered.length === 0 && q.length > 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      No se encontró ningún producto con &ldquo;<span className="font-semibold">{query}</span>&rdquo;
                    </p>
                    <button
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault()
                        setUnlistedForm({ name: query, price: '' })
                      }}
                      className="mt-2 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" /> Agregar como producto no listado
                    </button>
                  </div>
                ) : (
                  filtered.map((p, idx) => {
                    const isSelected = idx === selectedIndex

                    return (
                      <div
                        key={p.id}
                        onMouseDown={e => {
                          e.preventDefault()
                          selectProduct(p)
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          'w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer select-none',
                          isSelected
                            ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-3">
                          <div className={cn(
                            'h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold',
                            isSelected
                              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                          )}>
                            <Package className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate block">
                              {p.name}
                            </span>
                            {p.barcode && (
                              <span className="text-[11px] text-zinc-400 font-mono">
                                Código: {p.barcode}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Price & Add Indicator */}
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {formatCLP(p.salePrice ?? 0)}
                          </span>
                          <span className="h-7 px-2.5 rounded-lg bg-zinc-900/5 dark:bg-zinc-50/10 hover:bg-zinc-900 hover:text-white dark:hover:bg-zinc-50 dark:hover:text-zinc-900 text-[11px] font-bold flex items-center gap-1 transition-colors">
                            <Plus className="h-3 w-3" /> Agregar
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Bottom Unlisted Action */}
              <div className="p-2.5 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/70">
                <button
                  type="button"
                  onMouseDown={e => {
                    e.preventDefault()
                    setUnlistedForm({ name: query, price: '' })
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 hover:border-zinc-400 transition-all cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5 text-indigo-500" />
                  Agregar producto no listado (manual)
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
