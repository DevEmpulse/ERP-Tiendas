// src/lib/cashSession.ts — per-branch caja session helpers (migration.sql §17)
//
// Plain async helpers, not hooks — the repo has no hooks directory. Every
// sale-writer call site MUST call `fetchOpenSession` fresh at submit time
// (never from cached component state): `null` is a valid, expected result
// when no session is open, and no sale is ever blocked by session state.

export interface CashSession {
  id: string
  store_id: string
  branch_id: string
  opened_by: string | null
  opened_at: string
  opening_amount: number
  status: 'open' | 'closed'
  closed_by: string | null
  closed_at: string | null
  counted_amount: number | null
  expected_amount: number | null
  discrepancy: number | null
}

export interface CashMovement {
  id: string
  cash_session_id: string
  store_id: string
  branch_id: string
  type: 'cash_in' | 'cash_out'
  amount: number
  reason: string
  note: string | null
  created_by: string | null
  created_at: string
}

function mapCashSession(row: Record<string, unknown>): CashSession {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    branch_id: String(row.branch_id),
    opened_by: row.opened_by ? String(row.opened_by) : null,
    opened_at: String(row.opened_at),
    opening_amount: Number(row.opening_amount ?? 0),
    status: row.status as 'open' | 'closed',
    closed_by: row.closed_by ? String(row.closed_by) : null,
    closed_at: row.closed_at ? String(row.closed_at) : null,
    counted_amount: row.counted_amount === null || row.counted_amount === undefined ? null : Number(row.counted_amount),
    expected_amount: row.expected_amount === null || row.expected_amount === undefined ? null : Number(row.expected_amount),
    discrepancy: row.discrepancy === null || row.discrepancy === undefined ? null : Number(row.discrepancy),
  }
}

/**
 * Fresh, uncached read of the branch's currently open session, if any.
 * `null` when `branchId` is null or no session is open — never an error.
 * Every sale writer calls this immediately before insert.
 */
export async function fetchOpenSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  branchId: string | null
): Promise<CashSession | null> {
  if (!branchId) return null

  const { data, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .eq('branch_id', branchId)
    .eq('status', 'open')
    .maybeSingle()

  if (error || !data) return null
  return mapCashSession(data as Record<string, unknown>)
}

/**
 * Open a new session at a branch. Opening is a plain RLS-gated INSERT — the
 * partial unique index `(branch_id) WHERE status = 'open'` is what prevents
 * a double-open race atomically. A second concurrent attempt fails with a
 * `23505` unique-violation, surfaced here as a typed error message.
 */
export async function openSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: { storeId: string; branchId: string; openedBy: string; openingAmount: number }
): Promise<{ session: CashSession | null; error: string | null }> {
  const { data, error } = await supabase
    .from('cash_sessions')
    .insert({
      store_id: params.storeId,
      branch_id: params.branchId,
      opened_by: params.openedBy,
      opening_amount: params.openingAmount,
      status: 'open',
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { session: null, error: 'Ya hay una sesión abierta en esta sucursal.' }
    }
    return { session: null, error: error.message ?? 'Error al abrir la sesión de caja.' }
  }

  return { session: mapCashSession(data as Record<string, unknown>), error: null }
}

/**
 * Close a session via the `close_cash_session` SECURITY DEFINER RPC — the
 * only mutation path for `cash_sessions`. Computes and freezes
 * `expected_amount`/`discrepancy` server-side in one transaction.
 */
export async function closeSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: { sessionId: string; countedAmount: number }
): Promise<{ session: CashSession | null; error: string | null }> {
  const { data, error } = await supabase.rpc('close_cash_session', {
    p_session_id: params.sessionId,
    p_counted_amount: params.countedAmount,
  })

  if (error) {
    return { session: null, error: error.message ?? 'Error al cerrar la sesión de caja.' }
  }

  return { session: mapCashSession(data as Record<string, unknown>), error: null }
}

/**
 * Record a manual cash-in/cash-out movement. Only usable while the target
 * session is open, per RLS on `cash_movements`; post-close corrections
 * (D6) are also inserted through this same function since the ledger
 * itself allows post-close movements.
 */
export async function addCashMovement(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: {
    cashSessionId: string
    storeId: string
    branchId: string
    type: 'cash_in' | 'cash_out'
    amount: number
    reason: string
    note?: string | null
    createdBy: string
  }
): Promise<{ movement: CashMovement | null; error: string | null }> {
  const { data, error } = await supabase
    .from('cash_movements')
    .insert({
      cash_session_id: params.cashSessionId,
      store_id: params.storeId,
      branch_id: params.branchId,
      type: params.type,
      amount: params.amount,
      reason: params.reason,
      note: params.note ?? null,
      created_by: params.createdBy,
    })
    .select('*')
    .single()

  if (error) {
    return { movement: null, error: error.message ?? 'Error al registrar el movimiento de caja.' }
  }

  const row = data as Record<string, unknown>
  return {
    movement: {
      id: String(row.id),
      cash_session_id: String(row.cash_session_id),
      store_id: String(row.store_id),
      branch_id: String(row.branch_id),
      type: row.type as 'cash_in' | 'cash_out',
      amount: Number(row.amount),
      reason: String(row.reason),
      note: row.note ? String(row.note) : null,
      created_by: row.created_by ? String(row.created_by) : null,
      created_at: String(row.created_at),
    },
    error: null,
  }
}
