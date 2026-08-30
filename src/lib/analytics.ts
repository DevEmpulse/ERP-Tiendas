// src/lib/analytics.ts — typed wrappers over migration.sql §18's read-only
// aggregation view/RPCs (Store Analytics, P7). Every call runs SECURITY
// INVOKER under the CALLING user's RLS — see design.md's Architecture
// Decisions for why this is safe (and why analytics_branch_comparison is the
// one exception that re-derives scoping by hand, server-side, not here).

import type { createClient } from '@/utils/supabase/client'

type SupabaseClient = ReturnType<typeof createClient>

export interface AnalyticsPeriod {
  from: Date
  to: Date
  label: string
}

export const DEFAULT_PERIOD_DAYS = 30

export interface ProductRankingRow {
  product_id: string
  product_name: string
  units_sold: number
  revenue: number
  margin_estimated: number
  margin_realized: number
}

export interface BranchComparisonRow {
  branch_id: string
  branch_name: string
  revenue: number
  sales_count: number
  stock_units: number
}

export interface LowStockRow {
  branch_id: string
  branch_name: string
  product_id: string
  product_name: string
  barcode: string | null
  current_stock: number
  min_stock: number
  deficit: number
}

export interface SalesTrendRow {
  day: string
  revenue: number
}

export interface CategoryComparisonRow {
  category_id: string | null
  category_name: string
  revenue: number
  units_sold: number
}

/** Rolling last-N-days window, defaulting to the spec's 30-day default. */
export function buildPeriod(days: number = DEFAULT_PERIOD_DAYS): AnalyticsPeriod {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - days)

  const fmt = (d: Date) => d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })
  return {
    from,
    to,
    label: `Últimos ${days} días (${fmt(from)} – ${fmt(to)})`,
  }
}

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value)

export async function fetchProductRanking(
  sb: SupabaseClient,
  period: AnalyticsPeriod,
  branchId: string | null
): Promise<ProductRankingRow[]> {
  const { data, error } = await sb.rpc('analytics_product_ranking', {
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
    p_branch_id: branchId,
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    product_id: String(row.product_id),
    product_name: String(row.product_name ?? ''),
    units_sold: Number(row.units_sold ?? 0),
    revenue: Number(row.revenue ?? 0),
    margin_estimated: Number(row.margin_estimated ?? 0),
    margin_realized: Number(row.margin_realized ?? 0),
  }))
}

export async function fetchBranchComparison(
  sb: SupabaseClient,
  period: AnalyticsPeriod
): Promise<BranchComparisonRow[]> {
  const { data, error } = await sb.rpc('analytics_branch_comparison', {
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    branch_id: String(row.branch_id),
    branch_name: String(row.branch_name ?? ''),
    revenue: Number(row.revenue ?? 0),
    sales_count: Number(row.sales_count ?? 0),
    stock_units: Number(row.stock_units ?? 0),
  }))
}

export async function fetchLowStock(
  sb: SupabaseClient,
  branchId: string | null
): Promise<LowStockRow[]> {
  let query = sb
    .from('analytics_low_stock')
    .select('branch_id, branch_name, product_id, product_name, barcode, current_stock, min_stock, deficit')

  if (branchId) {
    query = query.eq('branch_id', branchId)
  }

  const { data, error } = await query.order('deficit', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    branch_id: String(row.branch_id),
    branch_name: String(row.branch_name ?? ''),
    product_id: String(row.product_id),
    product_name: String(row.product_name ?? ''),
    barcode: row.barcode ? String(row.barcode) : null,
    current_stock: Number(row.current_stock ?? 0),
    min_stock: Number(row.min_stock ?? 0),
    deficit: Number(row.deficit ?? 0),
  }))
}

export async function fetchSalesTrend(
  sb: SupabaseClient,
  period: AnalyticsPeriod,
  branchId: string | null
): Promise<SalesTrendRow[]> {
  const { data, error } = await sb.rpc('analytics_sales_trend', {
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
    p_branch_id: branchId,
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    day: String(row.day),
    revenue: Number(row.revenue ?? 0),
  }))
}

export async function fetchCategoryComparison(
  sb: SupabaseClient,
  period: AnalyticsPeriod,
  branchId: string | null
): Promise<CategoryComparisonRow[]> {
  const { data, error } = await sb.rpc('analytics_category_comparison', {
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
    p_branch_id: branchId,
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    category_id: row.category_id ? String(row.category_id) : null,
    category_name: String(row.category_name ?? 'Sin categoría'),
    revenue: Number(row.revenue ?? 0),
    units_sold: Number(row.units_sold ?? 0),
  }))
}
