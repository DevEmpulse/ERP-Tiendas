import type { createClient } from '@/utils/supabase/client'

type SupabaseClient = ReturnType<typeof createClient>

export interface PurchaseItemRow {
  id: string
  product_id: string
  product_name: string
  quantity: number
  unit_cost: number | string
  subtotal: number | string
}

export interface Purchase {
  id: string
  store_id: string
  branch_id: string
  supplier_name: string | null
  purchase_date: string          // YYYY-MM-DD
  note: string | null
  created_by: string | null
  created_at: string
  purchase_items?: PurchaseItemRow[] | null
}

export const purchaseTotal = (p: Pick<Purchase, 'purchase_items'>): number =>
  (p.purchase_items ?? []).reduce((acc, l) => acc + Number(l.subtotal), 0)

/**
 * Deletes the given purchase ids and returns the ids the database actually
 * deleted. Identical contract to salesHelper.ts's `deleteSaleGroup`: RLS can
 * silently block a DELETE (0 rows affected, `error: null`) — here when an
 * encargado targets another branch's purchase. Callers MUST compare
 * `deletedIds.length` against the expected count and abort (no re-insert) if it
 * comes up short, or an edit will duplicate the purchase and double-count both
 * stock and cost. This is the exact bug class already shipped and fixed once in
 * this codebase (`deleteSaleGroup`), so it is mandatory from day one here.
 */
export async function deletePurchaseGroup(
  supabase: SupabaseClient,
  ids: string[]
): Promise<{ deletedIds: string[]; error: { message: string } | null }> {
  if (!ids || ids.length === 0) return { deletedIds: [], error: null }
  const { data, error } = await supabase.from('purchases').delete().in('id', ids).select('id')
  if (error) return { deletedIds: [], error }
  return { deletedIds: (data ?? []).map((r: { id: string }) => r.id), error: null }
}

/**
 * Inserts the header then its lines. If the line insert fails, the just-created
 * header is deleted so no empty purchase is left behind (the two statements are
 * separate round-trips; only the per-line trigger work is transactional).
 */
export async function createPurchase(
  supabase: SupabaseClient,
  input: {
    storeId: string; branchId: string; createdBy: string
    supplierName: string | null; purchaseDate: string; note: string | null
    lines: Array<{ product_id: string; product_name: string; quantity: number; unit_cost: number }>
  }
): Promise<{ purchaseId: string | null; error: { message: string } | null }> {
  const { storeId, branchId, createdBy, supplierName, purchaseDate, note, lines } = input

  if (!lines || lines.length === 0) {
    return { purchaseId: null, error: { message: 'Una compra debe tener al menos un ítem.' } }
  }

  const { data: purchase, error: purchaseError } = await supabase
    .from('purchases')
    .insert({
      store_id: storeId,
      branch_id: branchId,
      supplier_name: supplierName,
      purchase_date: purchaseDate,
      note,
      created_by: createdBy,
    })
    .select('id')
    .single()

  if (purchaseError) return { purchaseId: null, error: purchaseError }
  if (!purchase) return { purchaseId: null, error: { message: 'No se pudo crear la compra.' } }

  const purchaseId = (purchase as { id: string }).id

  const items = lines.map((l) => ({
    store_id: storeId,
    purchase_id: purchaseId,
    product_id: l.product_id,
    product_name: l.product_name,
    quantity: l.quantity,
    unit_cost: l.unit_cost,
    subtotal: l.quantity * l.unit_cost,
  }))

  const { error: itemsError } = await supabase.from('purchase_items').insert(items)

  if (itemsError) {
    // The header round-trip already committed; delete it so no empty purchase
    // is left behind. This is a best-effort cleanup — if it also fails (e.g.
    // RLS), the caller still surfaces the original itemsError.
    await supabase.from('purchases').delete().eq('id', purchaseId)
    return { purchaseId: null, error: itemsError }
  }

  return { purchaseId, error: null }
}
