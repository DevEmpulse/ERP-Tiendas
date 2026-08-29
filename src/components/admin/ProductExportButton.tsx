'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { FileDown, Loader2 } from 'lucide-react'
import { useToast, Toaster } from '@/components/ui/toast'

// ─── Types ───────────────────────────────────────────────────────────────────

type SheetCell = string | number | boolean | Date | null

interface ProductRow {
  id: string
  barcode: string
  name: string
  category_id: string | null
  purchase_price: number
  sale_price: number
  is_active: boolean
}
interface CategoryRow { id: string; name: string }
interface BranchStockRow { product_id: string; current_stock: number }

interface ProductExportButtonProps {
  storeId: string | null
  branchId: string | null
  branchName?: string
}

// ─── Component ───────────────────────────────────────────────────────────────

// Column order/names match the import format exactly, so an exported file is a
// valid file to re-import unmodified.
const HEADER_ROW: SheetCell[] = [
  'ID',
  'Nombre del Producto',
  'Sección',
  'Cantidad Ingresada',
  'Precio Costo Unitario',
  'Precio Venta Unitario',
]

export function ProductExportButton({ storeId, branchId, branchName }: ProductExportButtonProps) {
  const supabase = createClient()
  const { toasts, toast, dismiss } = useToast()
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    if (!storeId) return
    setExporting(true)
    try {
      // Composite FKs (store_id, branch_id) / (store_id, product_id) mean a single
      // composite FK is not a resolvable PostgREST embed target — read products and
      // branch_stock in two queries and merge client-side (also keeps products with
      // no stock row in the export, defaulting to 0).
      const [{ data: products, error: prodErr }, { data: categories, error: catErr }] = await Promise.all([
        supabase
          .from('products')
          .select('id, barcode, name, category_id, purchase_price, sale_price, is_active')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase.from('categories').select('id, name'),
      ])
      if (prodErr) throw prodErr
      if (catErr) throw catErr

      const categoryNameById = new Map<string, string>(
        ((categories as CategoryRow[]) || []).map((c) => [c.id, c.name])
      )

      let stockByProductId = new Map<string, number>()
      if (branchId) {
        const { data: stockRows, error: stockErr } = await supabase
          .from('branch_stock')
          .select('product_id, current_stock')
          .eq('branch_id', branchId)
        if (stockErr) throw stockErr
        stockByProductId = new Map(
          ((stockRows as BranchStockRow[]) || []).map((s) => [s.product_id, s.current_stock])
        )
      }

      const rows: SheetCell[][] = ((products as ProductRow[]) || []).map((p) => [
        p.barcode,
        p.name,
        p.category_id ? categoryNameById.get(p.category_id) ?? '' : '',
        branchId ? stockByProductId.get(p.id) ?? 0 : 0,
        p.purchase_price,
        p.sale_price,
      ])

      const sheetData: SheetCell[][] = [HEADER_ROW, ...rows]

      const { default: writeXlsxFile } = await import('write-excel-file/browser')
      await writeXlsxFile(sheetData).toFile('catalogo.xlsx')

      toast(
        branchId
          ? `Catálogo exportado (${rows.length} productos, stock de ${branchName ?? 'la sucursal seleccionada'}).`
          : `Catálogo exportado (${rows.length} productos, sin sucursal seleccionada → cantidades en 0).`,
        'success'
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al exportar el catálogo.'
      toast(msg, 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Toaster toasts={toasts} dismiss={dismiss} />
      <Button
        type="button"
        variant="outline"
        onClick={handleExport}
        disabled={exporting || !storeId}
        className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
      >
        {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
        Exportar Catálogo
      </Button>
    </>
  )
}
