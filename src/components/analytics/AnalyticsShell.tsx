'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { EncargadoSidebar } from '@/components/encargado/EncargadoSidebar'
import { ADMIN_MENU_ITEMS, type AdminSection } from '@/components/admin/sidebar-items'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Menu, LogOut, Store, MapPin, FileDown, RefreshCw } from 'lucide-react'
import { PeriodSelector, type PeriodDays } from './PeriodSelector'
import { ProductRankingPanel } from './ProductRankingPanel'
import { BranchComparisonPanel } from './BranchComparisonPanel'
import { LowStockPanel } from './LowStockPanel'
import { SalesTrendPanel } from './SalesTrendPanel'
import { CategoryComparisonPanel } from './CategoryComparisonPanel'
import {
  buildPeriod,
  fetchProductRanking,
  fetchBranchComparison,
  fetchLowStock,
  fetchSalesTrend,
  fetchCategoryComparison,
  type ProductRankingRow,
  type BranchComparisonRow,
  type LowStockRow,
  type SalesTrendRow,
  type CategoryComparisonRow,
} from '@/lib/analytics'
import { generateAnalyticsReportPdf } from '@/lib/pdfGenerator'
import type { Role } from '@/lib/roles'

interface Branch {
  id: string
  name: string
}

interface Profile {
  id: string
  store_id: string
  name: string | null
  role: Role
  email: string | null
  branch_id: string | null
}

interface AnalyticsShellProps {
  profile: Profile
  storeName: string
  branches: Branch[]
}

export function AnalyticsShell({ profile, storeName, branches }: AnalyticsShellProps) {
  const router = useRouter()
  const supabase = createClient()

  const isAdmin = profile.role === 'admin'

  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30)
  // Admin: null means "todas las sucursales" (store-wide). Encargado is
  // locked to their own branch — the RPCs/view resolve that server-side
  // regardless of what is passed, but we pass it explicitly for clarity.
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<ProductRankingRow[]>([])
  const [branchRows, setBranchRows] = useState<BranchComparisonRow[]>([])
  const [lowStock, setLowStock] = useState<LowStockRow[]>([])
  const [salesTrend, setSalesTrend] = useState<SalesTrendRow[]>([])
  const [categoryRows, setCategoryRows] = useState<CategoryComparisonRow[]>([])

  const period = useMemo(() => buildPeriod(periodDays), [periodDays])
  const effectiveBranchId = isAdmin ? selectedBranchId : profile.branch_id

  const branchLabel = isAdmin
    ? (branches.find((b) => b.id === selectedBranchId)?.name ?? 'Todas las sucursales')
    : (branches[0]?.name ?? 'Mi sucursal')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const currentPeriod = buildPeriod(periodDays)
      const [productsResult, branchResult, lowStockResult, salesTrendResult, categoryResult] = await Promise.all([
        fetchProductRanking(supabase, currentPeriod, effectiveBranchId),
        fetchBranchComparison(supabase, currentPeriod),
        fetchLowStock(supabase, effectiveBranchId),
        fetchSalesTrend(supabase, currentPeriod, effectiveBranchId),
        fetchCategoryComparison(supabase, currentPeriod, effectiveBranchId),
      ])
      setProducts(productsResult)
      setBranchRows(branchResult)
      setLowStock(lowStockResult)
      setSalesTrend(salesTrendResult)
      setCategoryRows(categoryResult)
    } catch (err) {
      console.error('Error loading analytics:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase, periodDays, effectiveBranchId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount/period/branch change, matches CashSessionHistoryView's convention
    refresh()
  }, [refresh])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleSetSection = (section: AdminSection) => {
    if (section === 'analytics') return // already here
    if (section === 'pos') {
      router.push('/pos')
      return
    }
    const home = isAdmin ? '/admin' : '/encargado'
    router.push(section === 'dashboard' ? home : `${home}?section=${section}`)
  }

  const handleExportPdf = () => {
    generateAnalyticsReportPdf({
      storeName: storeName || 'Mi Tienda',
      branchLabel,
      periodLabel: period.label,
      products,
      branches: branchRows,
      lowStock,
      salesTrend,
      categories: categoryRows,
      fileName: `analitica-${new Date().toISOString().split('T')[0]}.pdf`,
    })
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans text-zinc-900 dark:text-zinc-50 antialiased">
      {isAdmin ? (
        <AdminSidebar
          currentSection="analytics"
          setSection={handleSetSection}
          storeName={storeName || 'Cargando tienda...'}
          adminName={profile.name || 'Administrador'}
          adminEmail={profile.email || 'admin@tienda.com'}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
          onLogout={handleLogout}
          items={ADMIN_MENU_ITEMS}
        />
      ) : (
        <EncargadoSidebar
          currentSection="analytics"
          setSection={handleSetSection}
          storeName={storeName || 'Cargando tienda...'}
          adminName={profile.name || 'Encargado'}
          adminEmail={profile.email || 'encargado@tienda.com'}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
          onLogout={handleLogout}
        />
      )}

      <div className="flex-1 md:pl-64 flex flex-col min-w-0 min-h-screen">
        <header className="sticky top-0 z-20 h-16 w-full border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-900/80 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 rounded-xl text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 border border-zinc-200/60 dark:border-zinc-800 cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2">
              <span className="hidden md:flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/50">
                <Store className="h-4 w-4" />
              </span>
              <h2 className="text-xs sm:text-sm font-bold text-zinc-800 dark:text-zinc-200">
                {storeName || 'Cargando Tienda...'}
              </h2>
            </div>

            {isAdmin && branches.length > 0 ? (
              <Select
                value={selectedBranchId ?? 'all'}
                onValueChange={(v) => setSelectedBranchId(v === 'all' ? null : (v as string))}
              >
                <SelectTrigger size="sm" className="h-8 gap-1.5 rounded-lg border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
                  <Store className="h-3.5 w-3.5 text-zinc-400" />
                  <SelectValue placeholder="Sucursal...">
                    {(value: string | null) =>
                      !value || value === 'all'
                        ? 'Todas las sucursales'
                        : (branches.find((b) => b.id === value)?.name ?? 'Sucursal...')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las sucursales</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              !isAdmin && branchLabel && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                  <MapPin className="h-3.5 w-3.5 text-zinc-500" />
                  <span>{branchLabel}</span>
                </div>
              )
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleLogout}
              variant="outline"
              size="xs"
              className="h-8 gap-1.5 rounded-lg border-zinc-200 text-zinc-650 hover:text-red-650 hover:bg-red-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-red-400 dark:hover:bg-red-950/20 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Salir</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Analítica</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Ranking de productos, sucursales, stock y caja
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PeriodSelector value={periodDays} onChange={setPeriodDays} label={period.label} />
              <Button
                onClick={refresh}
                variant="outline"
                size="sm"
                disabled={loading}
                className="h-8 gap-1.5 rounded-lg text-xs cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Actualizar
              </Button>
              <Button
                onClick={handleExportPdf}
                variant="outline"
                size="sm"
                disabled={loading}
                className="h-8 gap-1.5 rounded-lg text-xs cursor-pointer"
              >
                <FileDown className="h-3.5 w-3.5" />
                Exportar PDF
              </Button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ProductRankingPanel rows={products} loading={loading} />
            <BranchComparisonPanel rows={branchRows} loading={loading} />
            <LowStockPanel rows={lowStock} loading={loading} showBranchColumn={isAdmin && !selectedBranchId} />
            <SalesTrendPanel rows={salesTrend} loading={loading} />
            <CategoryComparisonPanel rows={categoryRows} loading={loading} />
          </div>
        </main>
      </div>
    </div>
  )
}
