'use client'

import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Printer, FileDown, X, CheckCircle2 } from 'lucide-react'
import { generateReceiptPdf } from '@/lib/pdfGenerator'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReceiptProduct {
  cant: number
  detalle: string
  p_unit: number
  importe: number
}

export interface ReceiptPayment {
  method: 'cash' | 'transfer' | 'card'
  amount: number
}

export interface ReceiptData {
  storeName: string
  employeeName: string
  clientName?: string | null
  clientPhone?: string | null
  createdAt: string         // ISO date string
  products: ReceiptProduct[]
  payments: ReceiptPayment[]
  totalAmount: number
  isCombined: boolean
  paperWidth?: '58mm' | '80mm'
  subtotal?: number
  discountLabel?: string | null
  discountAmount?: number
}

interface ReceiptModalProps {
  open: boolean
  onClose: () => void
  data: ReceiptData | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(v)

const formatDateTime = (iso: string) => {
  try {
    const d = new Date(iso)
    const day   = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year  = d.getFullYear()
    const hh    = String(d.getHours()).padStart(2, '0')
    const mm    = String(d.getMinutes()).padStart(2, '0')
    return { date: `${day}/${month}/${year}`, time: `${hh}:${mm}` }
  } catch {
    return { date: '--/--/----', time: '--:--' }
  }
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ReceiptModal({ open, onClose, data }: ReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null)

  if (!open || !data) return null

  const { date, time } = formatDateTime(data.createdAt)
  const paperWidth = data.paperWidth ?? '58mm'

  // ── Thermal print ──────────────────────────────────────────────────────────
  const handlePrint = () => {
    if (!printRef.current) return
    const printContents = printRef.current.innerHTML
    const win = window.open('', '_blank', 'width=400,height=600')
    if (!win) return
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Ticket de Venta</title>
          <style>
            @page {
              size: ${paperWidth} auto;
              margin: 4mm;
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: 'Courier New', Courier, monospace;
              font-size: ${paperWidth === '58mm' ? '9pt' : '10pt'};
              color: #000;
              background: #fff;
              width: ${paperWidth === '58mm' ? '50mm' : '72mm'};
            }
            .receipt { width: 100%; }
            .store-name {
              font-size: ${paperWidth === '58mm' ? '11pt' : '13pt'};
              font-weight: 900;
              text-align: center;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: 2mm;
            }
            .center { text-align: center; }
            .divider {
              border-top: 1px dashed #000;
              margin: 2mm 0;
            }
            .row {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 2mm;
              font-size: ${paperWidth === '58mm' ? '8pt' : '9pt'};
              margin: 0.8mm 0;
            }
            .label { color: #444; }
            .bold { font-weight: 700; }
            table {
              width: 100%;
              border-collapse: collapse;
              font-size: ${paperWidth === '58mm' ? '7.5pt' : '9pt'};
              margin: 1mm 0;
            }
            thead tr {
              border-bottom: 1px solid #000;
            }
            th {
              font-weight: 700;
              padding: 1mm 0.5mm;
              text-align: left;
            }
            th.right, td.right { text-align: right; }
            td { padding: 0.8mm 0.5mm; }
            tbody tr:last-child td { border-top: 1px dashed #aaa; font-weight: 700; }
            .total-row {
              display: flex;
              justify-content: space-between;
              font-size: ${paperWidth === '58mm' ? '12pt' : '14pt'};
              font-weight: 900;
              margin: 2mm 0 1mm;
              padding-top: 1mm;
              border-top: 2px solid #000;
            }
            .payment-item {
              display: flex;
              justify-content: space-between;
              font-size: ${paperWidth === '58mm' ? '8.5pt' : '9.5pt'};
              margin: 0.5mm 0;
            }
            .footer {
              text-align: center;
              font-size: ${paperWidth === '58mm' ? '7pt' : '7.5pt'};
              color: #666;
              margin-top: 3mm;
            }
          </style>
        </head>
        <body>
          <div class="receipt">
            ${printContents}
          </div>
        </body>
      </html>
    `)
    win.document.close()
    win.focus()
    setTimeout(() => {
      win.print()
      win.close()
    }, 300)
  }

  // ── PDF download ───────────────────────────────────────────────────────────
  const handlePdf = () => {
    generateReceiptPdf(data)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        onClick={onClose}
      >
        {/* Modal panel */}
        <div
          className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
                <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">¡Venta registrada!</p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Comprobante disponible</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Receipt preview ── */}
          <div className="px-5 py-4 max-h-[52vh] overflow-y-auto">
            {/* This div is what gets printed */}
            <div
              ref={printRef}
              className="font-mono text-[11px] text-zinc-800 dark:text-zinc-200 space-y-1 select-text"
            >
              {/* Store name */}
              <p className="store-name text-center font-black text-[13px] tracking-widest uppercase">
                {data.storeName}
              </p>

              {/* Date / time / employee */}
              <div className="divider border-t border-dashed border-zinc-300 dark:border-zinc-700 my-1.5" />
              <div className="row flex justify-between text-[10px]">
                <span className="label text-zinc-500">Fecha:</span>
                <span className="bold font-semibold">{date}</span>
              </div>
              <div className="row flex justify-between text-[10px]">
                <span className="label text-zinc-500">Hora:</span>
                <span className="bold font-semibold">{time}</span>
              </div>
              <div className="row flex justify-between text-[10px]">
                <span className="label text-zinc-500">Vendedor/a:</span>
                <span className="bold font-semibold">{data.employeeName || '—'}</span>
              </div>

              {/* Client data */}
              {(data.clientName || data.clientPhone) && (
                <>
                  <div className="divider border-t border-dashed border-zinc-300 dark:border-zinc-700 my-1.5" />
                  {data.clientName && (
                    <div className="row flex justify-between text-[10px]">
                      <span className="label text-zinc-500">Cliente:</span>
                      <span className="bold font-semibold">{data.clientName}</span>
                    </div>
                  )}
                  {data.clientPhone && (
                    <div className="row flex justify-between text-[10px]">
                      <span className="label text-zinc-500">Teléfono:</span>
                      <span className="bold font-semibold">{data.clientPhone}</span>
                    </div>
                  )}
                </>
              )}

              {/* Products table */}
              <div className="divider border-t border-dashed border-zinc-300 dark:border-zinc-700 my-1.5" />
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-zinc-300 dark:border-zinc-600">
                    <th className="py-0.5 text-left font-bold text-[9px] uppercase w-6">Cant</th>
                    <th className="py-0.5 text-left font-bold text-[9px] uppercase">Detalle</th>
                    <th className="py-0.5 text-right font-bold text-[9px] uppercase right">P.Unit</th>
                    <th className="py-0.5 text-right font-bold text-[9px] uppercase right">Importe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {data.products.map((p, i) => (
                    <tr key={i}>
                      <td className="py-0.5 text-center font-bold">{p.cant}</td>
                      <td className="py-0.5 truncate max-w-[80px]" title={p.detalle}>{p.detalle}</td>
                      <td className="py-0.5 text-right text-zinc-500">{fmt(p.p_unit)}</td>
                      <td className="py-0.5 text-right font-semibold">{fmt(p.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Subtotal / Discount (only when a discount was applied) */}
              {!!data.discountAmount && data.discountAmount > 0 && (
                <>
                  <div className="row flex justify-between text-[10px] pt-1">
                    <span className="label text-zinc-500">Subtotal:</span>
                    <span className="bold font-semibold">{fmt(data.subtotal ?? data.totalAmount + data.discountAmount)}</span>
                  </div>
                  <div className="row flex justify-between text-[10px]">
                    <span className="label text-zinc-500">{data.discountLabel ?? 'Descuento'}:</span>
                    <span className="bold font-semibold">-{fmt(data.discountAmount)}</span>
                  </div>
                </>
              )}

              {/* Total */}
              <div className="total-row flex justify-between items-center pt-1.5 mt-1 border-t-2 border-zinc-800 dark:border-zinc-300">
                <span className="text-[11px] font-black uppercase tracking-wide">TOTAL</span>
                <span className="text-[15px] font-black tabular-nums">{fmt(data.totalAmount)}</span>
              </div>

              {/* Payment breakdown */}
              <div className="divider border-t border-dashed border-zinc-300 dark:border-zinc-700 my-1.5" />
              <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">Forma de pago</p>
              {data.payments.map((p, i) => (
                <div key={i} className="payment-item flex justify-between text-[10px]">
                  <span className="text-zinc-500">{PAYMENT_LABELS[p.method] ?? p.method}</span>
                  <span className="font-semibold tabular-nums">{fmt(p.amount)}</span>
                </div>
              ))}

              {/* Footer */}
              <div className="divider border-t border-dashed border-zinc-300 dark:border-zinc-700 mt-2 mb-1" />
              <p className="footer text-center text-[9px] text-zinc-400">
                ¡Gracias por su compra!
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-2.5">
            <Button
              type="button"
              onClick={handlePrint}
              className="flex-1 h-10 gap-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-50 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 text-xs font-bold cursor-pointer transition-all active:scale-[0.98]"
            >
              <Printer className="h-4 w-4" />
              Imprimir Ticket
            </Button>
            <Button
              type="button"
              onClick={handlePdf}
              variant="outline"
              className="flex-1 h-10 gap-2 rounded-xl border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-bold cursor-pointer transition-all active:scale-[0.98]"
            >
              <FileDown className="h-4 w-4" />
              Descargar PDF
            </Button>
          </div>

          {/* Close link */}
          <div className="pb-4 flex justify-center">
            <button
              onClick={onClose}
              className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer transition-colors underline underline-offset-2"
            >
              Cerrar sin imprimir
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
