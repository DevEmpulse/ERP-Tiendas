'use client'

import { useEffect, useRef } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LabelProduct {
  id: string
  barcode: string
  name: string
  sale_price: number
}

interface ProductLabelPrinterProps {
  /** Products queued to print. Empty array = idle, nothing renders or prints. */
  products: LabelProduct[]
  /** Called once the print job has been dispatched (window opened) or failed. */
  onPrinted: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(v)

/**
 * Renders one EAN-8 barcode graphic per product into an off-screen container
 * (jsbarcode draws directly onto the <svg> DOM node), then opens a print
 * window with the resulting markup — same `window.open` + inline `<style>`
 * pattern as `ReceiptModal.tsx`, not the unused `@media print` CSS block.
 * Handles both a single product and a batch (one print job, N labels).
 */
export function ProductLabelPrinter({ products, onPrinted }: ProductLabelPrinterProps) {
  const svgRefs = useRef<Array<SVGSVGElement | null>>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const printedKeyRef = useRef<string>('')

  useEffect(() => {
    if (products.length === 0) {
      // Queue cleared: reset the guard so the same product set can print again
      // on a future job instead of silently no-opping forever.
      printedKeyRef.current = ''
      return
    }

    // Guard against re-firing when `onPrinted`'s identity changes but the
    // requested product set is the same job already dispatched.
    const key = products.map((p) => p.id).join(',')
    if (key === printedKeyRef.current) return
    printedKeyRef.current = key

    let cancelled = false

    ;(async () => {
      // `jsbarcode` ships a CommonJS `export =` (UMD) module; the bundler's CJS/ESM
      // interop attaches the callable export as `.default` at runtime, but the
      // library's own types don't model that for a dynamic `import()`, hence the cast.
      type JsBarcodeFn = (
        element: SVGElement,
        data: string,
        options?: Record<string, unknown>
      ) => void
      let JsBarcode: JsBarcodeFn
      try {
        const mod = (await import('jsbarcode')) as unknown as { default: JsBarcodeFn }
        JsBarcode = mod.default
      } catch (err) {
        console.error('Error cargando jsbarcode:', err)
        if (!cancelled) onPrinted()
        return
      }
      if (cancelled) return

      products.forEach((p, i) => {
        const svg = svgRefs.current[i]
        if (!svg) return
        try {
          JsBarcode(svg, p.barcode, {
            format: 'EAN8',
            displayValue: false,
            margin: 0,
            height: 45,
          })
        } catch (err) {
          console.error(`Error generando código de barras para ${p.barcode}:`, err)
        }
      })

      if (cancelled || !containerRef.current) {
        if (!cancelled) onPrinted()
        return
      }

      const printContents = containerRef.current.innerHTML
      const win = window.open('', '_blank', 'width=420,height=600')
      if (!win) {
        onPrinted()
        return
      }
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>Etiquetas de Producto</title>
            <style>
              * { box-sizing: border-box; margin: 0; padding: 0; }
              @page { size: auto; margin: 4mm; }
              body { font-family: Arial, Helvetica, sans-serif; }
              .labels { display: flex; flex-wrap: wrap; gap: 3mm; }
              .label {
                width: 45mm;
                padding: 2mm;
                border: 1px dashed #999;
                text-align: center;
                page-break-inside: avoid;
              }
              .label svg { width: 100%; height: auto; display: block; }
              .label .code { font-size: 9pt; font-weight: 700; letter-spacing: 1px; margin-top: 1mm; }
              .label .name {
                font-size: 8pt;
                margin-top: 0.5mm;
                word-break: break-word;
                min-height: 1em;
              }
              .label .price { font-size: 11pt; font-weight: 900; margin-top: 1mm; }
            </style>
          </head>
          <body>
            <div class="labels">${printContents}</div>
          </body>
        </html>
      `)
      win.document.close()
      win.focus()
      setTimeout(() => {
        win.print()
        win.close()
      }, 300)

      onPrinted()
    })()

    return () => {
      cancelled = true
    }
  }, [products, onPrinted])

  if (products.length === 0) return null

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{ position: 'fixed', top: '-9999px', left: '-9999px' }}
    >
      {products.map((p, i) => (
        <div key={`${p.id}-${i}`} className="label">
          <svg
            ref={(el) => {
              svgRefs.current[i] = el
            }}
          />
          <div className="code">{p.barcode}</div>
          <div className="name">{p.name}</div>
          <div className="price">{fmt(p.sale_price)}</div>
        </div>
      ))}
    </div>
  )
}
