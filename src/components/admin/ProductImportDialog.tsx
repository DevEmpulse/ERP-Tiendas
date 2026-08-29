'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  FileSpreadsheet,
  Upload,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  Package,
  Tags,
  Store,
} from 'lucide-react'
import { useToast, Toaster } from '@/components/ui/toast'
import type { LabelProduct } from './ProductLabel'

// ─── Types ───────────────────────────────────────────────────────────────────

type SheetCell = string | number | boolean | Date | null

interface Branch { id: string; name: string }
interface CategoryRow { id: string; name: string }
interface ExistingProduct { id: string; barcode: string }
interface CreatedProductRow { id: string; barcode: string; name: string; sale_price: number }

interface ParsedRow {
  excelRowNumber: number // 1-based, matches the row an admin would see in Excel (header = row 1)
  rawId: string
  name: string
  categoryName: string
  quantity: number | null
  purchasePrice: number
  salePrice: number
}

interface ResolvedRow extends ParsedRow {
  kind: 'create' | 'update'
  productId?: string
}

interface ImportPreview {
  resolvedRows: ResolvedRow[]
  toCreateCount: number
  toUpdateCount: number
  newCategoryNames: string[]
}

interface CommitOutcome {
  categoriesCreated: number
  productsCreated: number
  productsUpdated: number
  movementsApplied: number
  movementFailures: { excelRowNumber: number; productName: string; error: string }[]
}

interface ProductImportDialogProps {
  open: boolean
  onClose: () => void
  storeId: string | null
  onImported: (createdLabelProducts: LabelProduct[]) => void
}

// ─── Excel contract helpers ────────────────────────────────────────────────

// Real-world reference files abbreviate ("P. Costo Unitario ($)") instead of spelling
// out the column name ("Precio Costo Unitario"), so each canonical field accepts every
// known variant rather than one exact string. The first variant is always this app's
// own export header, so an exported-then-reimported file matches on the first try.
const REQUIRED_HEADERS = {
  name: ['nombre del producto'],
  category: ['seccion'],
  quantity: ['cantidad ingresada'],
  purchase: ['precio costo unitario', 'p costo unitario'],
  sale: ['precio venta unitario', 'p venta unitario'],
} as const
const OPTIONAL_ID_HEADERS = ['id', 'id producto']

// Strip accents, punctuation (periods, parens, $, commas — "P. Costo Unitario ($)"
// and "Precio Costo Unitario" must normalize to comparable text), trim, lowercase,
// collapse spaces.
function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

// First variant whose normalized text is present in `colIndex`, or undefined if none match.
function findColumn(colIndex: Record<string, number>, variants: readonly string[]): number | undefined {
  for (const v of variants) {
    if (colIndex[v] !== undefined) return colIndex[v]
  }
  return undefined
}

// '' for null/undefined; String(v) otherwise. Cells from read-excel-file are already
// plain primitives — no formula/richText wrapper to unwrap.
function cellText(v: SheetCell): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

// Numeric cell -> as-is. Text cell: strip `$`/NBSP, then '1.234,56' -> 1234.56
// ('.' is thousands when both separators are present, ',' is decimal), ',' alone
// is treated as a decimal separator.
function parseMoney(v: SheetCell): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return null
  let s = v.trim().replace(/[$\s ]/g, '')
  if (s === '') return null
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// '' / 0 / non-numeric => null (no movement). Otherwise a truncated integer.
function parseQty(v: SheetCell): number | null {
  if (v === null || v === undefined) return null
  let n: number
  if (typeof v === 'number') {
    n = v
  } else if (typeof v === 'string') {
    const s = v.trim()
    if (s === '') return null
    n = Number(s.replace(',', '.'))
  } else {
    return null
  }
  if (!Number.isFinite(n) || n === 0) return null
  return Math.trunc(n)
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProductImportDialog({ open, onClose, storeId, onImported }: ProductImportDialogProps) {
  const supabase = createClient()
  const { toasts, toast, dismiss } = useToast()

  const [branches, setBranches] = useState<Branch[]>([])
  const [destinationBranchId, setDestinationBranchId] = useState<string | null>(null)

  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)

  const [committing, setCommitting] = useState(false)
  const [outcome, setOutcome] = useState<CommitOutcome | null>(null)

  const loadBranches = useCallback(async () => {
    const { data, error } = await supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (!error) setBranches((data as Branch[]) || [])
  }, [supabase])

  // Clears everything derived from a specific file, but NOT the destination branch —
  // it must survive picking a file, since the file input is only enabled once a branch
  // is already selected. Used when choosing a (possibly new) file.
  const resetFileState = () => {
    setParseError(null)
    setFileName(null)
    setPreview(null)
    setOutcome(null)
  }

  const handleClose = () => {
    resetFileState()
    setDestinationBranchId(null)
    onClose()
  }

  // `open` is a controlled prop the parent flips directly (StockView's button sets
  // isImportOpen=true) — the Dialog's own onOpenChange only fires for transitions the
  // dialog itself initiates (Escape, backdrop click, its Close button), never for a
  // parent-driven open. Branch loading must react to `open` itself, not to that callback.
  useEffect(() => {
    if (open) loadBranches()
  }, [open, loadBranches])

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) handleClose()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !storeId) return

    resetFileState()
    setFileName(file.name)
    setParsing(true)

    try {
      const { readSheet } = await import('read-excel-file/browser')
      const rows = (await readSheet(file)) as SheetCell[][]

      if (!rows || rows.length === 0) {
        setParseError('El archivo está vacío.')
        return
      }

      const headerRow = rows[0]
      const normalizedHeaders = headerRow.map(normalizeHeader)

      const colIndex: Record<string, number> = {}
      normalizedHeaders.forEach((h, i) => {
        if (h && colIndex[h] === undefined) colIndex[h] = i
      })

      const nameCol = findColumn(colIndex, REQUIRED_HEADERS.name)
      const categoryCol = findColumn(colIndex, REQUIRED_HEADERS.category)
      const quantityCol = findColumn(colIndex, REQUIRED_HEADERS.quantity)
      const purchaseCol = findColumn(colIndex, REQUIRED_HEADERS.purchase)
      const saleCol = findColumn(colIndex, REQUIRED_HEADERS.sale)

      const missing = Object.entries({ name: nameCol, category: categoryCol, quantity: quantityCol, purchase: purchaseCol, sale: saleCol })
        .filter(([, col]) => col === undefined)
        .map(([key]) => key)
      if (missing.length > 0) {
        setParseError(
          `Faltan columnas requeridas: ${missing.join(', ')}. ` +
          `Columnas encontradas: ${normalizedHeaders.filter(Boolean).join(', ') || '(ninguna)'}.`
        )
        return
      }

      const idCol = findColumn(colIndex, OPTIONAL_ID_HEADERS)

      const parsedRows: ParsedRow[] = []
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]
        if (!row || row.every((c) => c === null || c === '')) continue
        const name = cellText(row[nameCol!]).trim()
        if (!name) continue
        parsedRows.push({
          excelRowNumber: r + 1,
          rawId: idCol !== undefined ? cellText(row[idCol]).trim() : '',
          name,
          categoryName: cellText(row[categoryCol!]).trim(),
          quantity: parseQty(row[quantityCol!]),
          purchasePrice: parseMoney(row[purchaseCol!]) ?? 0,
          salePrice: parseMoney(row[saleCol!]) ?? 0,
        })
      }

      if (parsedRows.length === 0) {
        setParseError('No se encontraron filas con datos para importar.')
        return
      }

      const { data: existingProducts, error: prodErr } = await supabase
        .from('products')
        .select('id, barcode')
      if (prodErr) throw prodErr
      const byBarcode = new Map<string, string>(
        ((existingProducts as ExistingProduct[]) || []).map((p) => [p.barcode, p.id])
      )

      const { data: existingCategories, error: catErr } = await supabase
        .from('categories')
        .select('id, name')
      if (catErr) throw catErr
      const categoryNames = new Set(
        ((existingCategories as CategoryRow[]) || []).map((c) => c.name.trim().toLowerCase())
      )

      const newCategoryNamesSet = new Set<string>()
      const resolvedRows: ResolvedRow[] = parsedRows.map((row) => {
        // Blank or unmatched ID -> always create; the file's value is never adopted.
        const matchId = row.rawId ? byBarcode.get(row.rawId) : undefined
        if (row.categoryName && !categoryNames.has(row.categoryName.trim().toLowerCase())) {
          newCategoryNamesSet.add(row.categoryName.trim())
        }
        return matchId
          ? { ...row, kind: 'update' as const, productId: matchId }
          : { ...row, kind: 'create' as const }
      })

      setPreview({
        resolvedRows,
        toCreateCount: resolvedRows.filter((r) => r.kind === 'create').length,
        toUpdateCount: resolvedRows.filter((r) => r.kind === 'update').length,
        newCategoryNames: Array.from(newCategoryNamesSet),
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al leer el archivo.'
      setParseError(msg)
    } finally {
      setParsing(false)
    }
  }

  const handleCommit = async () => {
    if (!preview || !storeId || !destinationBranchId) return
    setCommitting(true)

    const result: CommitOutcome = {
      categoriesCreated: 0,
      productsCreated: 0,
      productsUpdated: 0,
      movementsApplied: 0,
      movementFailures: [],
    }

    try {
      // Phase 1: create missing categories (one atomic insert).
      const categoryIdByName = new Map<string, string>()
      const { data: currentCategories } = await supabase.from('categories').select('id, name')
      for (const c of (currentCategories as CategoryRow[]) || []) {
        categoryIdByName.set(c.name.trim().toLowerCase(), c.id)
      }

      if (preview.newCategoryNames.length > 0) {
        const { data: createdCategories, error } = await supabase
          .from('categories')
          .insert(preview.newCategoryNames.map((name) => ({ store_id: storeId, name })))
          .select('id, name')
        if (error) throw new Error(`Error creando categorías: ${error.message}`)
        for (const c of (createdCategories as CategoryRow[]) || []) {
          categoryIdByName.set(c.name.trim().toLowerCase(), c.id)
        }
        result.categoriesCreated = createdCategories?.length || 0
      }

      const resolveCategoryId = (name: string): string | null =>
        name ? categoryIdByName.get(name.trim().toLowerCase()) ?? null : null

      const createRows = preview.resolvedRows.filter((r) => r.kind === 'create')
      const updateRows = preview.resolvedRows.filter((r) => r.kind === 'update')

      // Phase 2: bulk-insert new products. `barcode` is omitted so the column
      // DEFAULT (public.next_product_code()) generates it. supabase-js preserves
      // array order for a single INSERT ... VALUES statement, so createdProducts[i]
      // corresponds to createRows[i].
      let createdProducts: CreatedProductRow[] = []
      if (createRows.length > 0) {
        const { data, error } = await supabase
          .from('products')
          .insert(
            createRows.map((r) => ({
              store_id: storeId,
              category_id: resolveCategoryId(r.categoryName),
              name: r.name,
              purchase_price: r.purchasePrice,
              sale_price: r.salePrice,
            }))
          )
          .select('id, barcode, name, sale_price')
        if (error) throw new Error(`Error creando productos: ${error.message}`)
        createdProducts = (data as CreatedProductRow[]) || []
        result.productsCreated = createdProducts.length
      }

      // Phase 3: bulk-upsert identity fields on matched products. `barcode` is never
      // included in the payload, so the product's existing generated code is untouched.
      if (updateRows.length > 0) {
        const { error } = await supabase.from('products').upsert(
          updateRows.map((r) => ({
            id: r.productId,
            store_id: storeId,
            category_id: resolveCategoryId(r.categoryName),
            name: r.name,
            purchase_price: r.purchasePrice,
            sale_price: r.salePrice,
          })),
          { onConflict: 'id' }
        )
        if (error) throw new Error(`Error actualizando productos: ${error.message}`)
        result.productsUpdated = updateRows.length
      }

      // Phase 4: one adjust_branch_stock RPC per row carrying a non-zero quantity.
      // Individually fallible by design — additive, never rolled back, reported per row.
      const quantityJobs: { excelRowNumber: number; productId: string; productName: string; quantity: number }[] = []
      createRows.forEach((r, i) => {
        const created = createdProducts[i]
        if (created && r.quantity) {
          quantityJobs.push({ excelRowNumber: r.excelRowNumber, productId: created.id, productName: r.name, quantity: r.quantity })
        }
      })
      updateRows.forEach((r) => {
        if (r.productId && r.quantity) {
          quantityJobs.push({ excelRowNumber: r.excelRowNumber, productId: r.productId, productName: r.name, quantity: r.quantity })
        }
      })

      for (const job of quantityJobs) {
        const { error } = await supabase.rpc('adjust_branch_stock', {
          p_branch_id: destinationBranchId,
          p_product_id: job.productId,
          p_delta: job.quantity,
          p_reason: 'import_ingress',
          p_note: `Importación — fila ${job.excelRowNumber}`,
        })
        if (error) {
          result.movementFailures.push({
            excelRowNumber: job.excelRowNumber,
            productName: job.productName,
            error: error.message,
          })
        } else {
          result.movementsApplied++
        }
      }

      const createdLabelProducts: LabelProduct[] = createdProducts.map((p) => ({
        id: p.id,
        barcode: p.barcode,
        name: p.name,
        sale_price: Number(p.sale_price),
      }))

      setOutcome(result)
      setPreview(null)
      onImported(createdLabelProducts)
      toast(
        `Importación completada: ${result.productsCreated} creados, ${result.productsUpdated} actualizados.` +
        (result.movementFailures.length > 0 ? ` ${result.movementFailures.length} movimientos fallaron.` : ''),
        result.movementFailures.length > 0 ? 'error' : 'success'
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al importar el archivo.'
      toast(msg, 'error')
    } finally {
      setCommitting(false)
    }
  }

  return (
    <>
      <Toaster toasts={toasts} dismiss={dismiss} />
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl p-0 overflow-hidden max-h-[85vh] flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-zinc-400" />
              Importar Catálogo desde Excel
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Subí un archivo .xlsx con columnas: ID (opcional), Nombre del Producto, Sección,
              Cantidad Ingresada, Precio Costo Unitario, Precio Venta Unitario.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-5 space-y-4 overflow-y-auto">
            {!outcome && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  Sucursal de destino
                </Label>
                <div className="space-y-1.5">
                  {branches.length === 0 && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 py-2 flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /> Cargando sucursales...
                    </p>
                  )}
                  {branches.map((b) => {
                    const selected = destinationBranchId === b.id
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setDestinationBranchId(b.id)}
                        className={`w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-sm font-semibold text-left transition-colors cursor-pointer ${
                          selected
                            ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950'
                            : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        <Store className={`h-4 w-4 shrink-0 ${selected ? '' : 'text-zinc-400'}`} />
                        <span className="flex-1">{b.name}</span>
                        {selected && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-zinc-400">
                  Todas las cantidades de este archivo se sumarán al stock de esta sucursal.
                </p>
              </div>
            )}

            {!outcome && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  Archivo .xlsx
                </Label>
                <label
                  className={`flex items-center gap-2 h-10 px-3 rounded-xl border border-dashed text-xs font-medium cursor-pointer transition-colors ${
                    destinationBranchId
                      ? 'border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  <Upload className="h-3.5 w-3.5 shrink-0" />
                  {fileName || 'Elegí un archivo...'}
                  <input
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    disabled={!destinationBranchId || parsing}
                    onChange={handleFileChange}
                  />
                </label>
              </div>
            )}

            {parsing && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo archivo...
              </div>
            )}

            {parseError && (
              <div className="flex items-start gap-2 p-3 text-xs text-red-600 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-xl font-medium">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}

            {preview && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/40 text-center">
                    <p className="text-lg font-black text-emerald-600 dark:text-emerald-400">{preview.toCreateCount}</p>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase">A crear</p>
                  </div>
                  <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/40 text-center">
                    <p className="text-lg font-black text-zinc-700 dark:text-zinc-200">{preview.toUpdateCount}</p>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase">A actualizar</p>
                  </div>
                  <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/40 text-center">
                    <p className="text-lg font-black text-zinc-700 dark:text-zinc-200">{preview.newCategoryNames.length}</p>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase">Categorías nuevas</p>
                  </div>
                </div>
                {preview.newCategoryNames.length > 0 && (
                  <div className="flex items-start gap-2 p-3 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/40 rounded-xl">
                    <Tags className="h-3.5 w-3.5 shrink-0 mt-0.5 text-zinc-400" />
                    <span>Se crearán: {preview.newCategoryNames.join(', ')}</span>
                  </div>
                )}
              </div>
            )}

            {outcome && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-900/30 rounded-xl">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Importación completada</p>
                    <p className="mt-0.5">
                      {outcome.categoriesCreated} categorías creadas · {outcome.productsCreated} productos creados ·{' '}
                      {outcome.productsUpdated} productos actualizados · {outcome.movementsApplied} movimientos de stock aplicados.
                    </p>
                  </div>
                </div>
                {outcome.movementFailures.length > 0 && (
                  <div className="p-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-900/30 rounded-xl">
                    <p className="font-semibold flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> {outcome.movementFailures.length} movimientos de stock fallaron</p>
                    <p className="mt-1 text-[10px] text-red-500/80 dark:text-red-400/70">
                      El producto ya fue creado/actualizado; corregí el stock manualmente con el ajuste de stock. No reintentes el archivo completo — duplicaría las filas que sí se aplicaron.
                    </p>
                    <ul className="mt-1.5 space-y-0.5 max-h-24 overflow-y-auto">
                      {outcome.movementFailures.map((f, i) => (
                        <li key={i}>Fila {f.excelRowNumber} — {f.productName}: {f.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
              className="h-9 px-4 rounded-xl border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
            >
              {outcome ? 'Cerrar' : 'Cancelar'}
            </Button>
            {preview && !outcome && (
              <Button
                type="button"
                onClick={handleCommit}
                disabled={committing}
                className="h-9 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex-1 sm:flex-none flex items-center justify-center gap-1.5"
              >
                {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                Confirmar Importación
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
