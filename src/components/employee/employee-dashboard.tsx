'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { MySalesView } from './MySalesView'
import { StockAdjustmentView } from './StockAdjustmentView'
import { EmployeeSidebar } from './EmployeeSidebar'
import { CashSessionPanel } from '@/components/shared/CashSessionPanel'
import { CashSessionHistoryView } from '@/components/shared/CashSessionHistoryView'
import { Button } from '@/components/ui/button'
import { LogOut, Store, Menu } from 'lucide-react'
import { STOCK_ROLES } from '@/lib/roles'
import { type AdminSection } from '@/components/admin/sidebar-items'

// Re-export AdminSection to keep external usage compatible
export type { AdminSection }

interface Profile {
  id: string
  store_id: string
  name: string | null
  role: string | null
  email: string | null
  branch_id: string | null
}

interface EmployeeDashboardProps {
  profile: Profile
  storeName: string
  branchName?: string
  paperWidth?: '58mm' | '80mm'
}

type EmployeeSection = 'my_sales' | 'cash'

export default function EmployeeDashboard({
  profile,
  storeName,
  branchName,
  paperWidth = '58mm',
}: EmployeeDashboardProps) {
  const router = useRouter()
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [activeSection, setActiveSection] = useState<EmployeeSection>('my_sales')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // Sync section from query param if arriving from /pos or direct link
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const sec = params.get('section') as EmployeeSection | null
      if (sec && (sec === 'my_sales' || sec === 'cash')) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync activeSection from a URL query param on mount
        setActiveSection(sec)
      }
    }
  }, [])

  const isStockRole = (STOCK_ROLES as readonly string[]).includes(profile.role ?? '')

  const displayName = profile.name || (profile.email ? profile.email.split('@')[0] : 'Colaborador/a')

  const handleLogout = async () => {
    setLogoutLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const handleSetSection = (section: AdminSection) => {
    if (section === 'pos') {
      router.push('/pos')
      return
    }
    setActiveSection(section as EmployeeSection)
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'my_sales':
        return <MySalesView profile={profile} storeName={storeName} paperWidth={paperWidth} />
      case 'cash':
        return (
          <div className="space-y-6">
            <CashSessionPanel
              storeId={profile.store_id}
              branchId={profile.branch_id}
              branchName={branchName}
              role={profile.role}
              userId={profile.id}
              userBranchId={profile.branch_id}
            />
            <CashSessionHistoryView storeId={profile.store_id} branchId={profile.branch_id} />
          </div>
        )
      default:
        return null
    }
  }

  // Stock roles: keep the existing simple header-only layout (no sidebar)
  if (isStockRole) {
    return (
      <div className="w-full max-w-5xl mx-auto flex flex-col min-h-screen justify-between pb-8 p-4">
        <div className="flex-1 space-y-5">
          <header className="flex items-center justify-between p-4 bg-white/40 dark:bg-zinc-900/40 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-800/30 rounded-2xl shadow-sm mt-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-zinc-950 dark:bg-zinc-50 flex items-center justify-center text-white dark:text-zinc-950 font-bold shadow-sm">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                  ¡Hola, {displayName}! 👋
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium flex items-center gap-1 mt-0.5">
                  <Store className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <span>{storeName || 'Mi Tienda'}</span>
                  {branchName && <span className="text-zinc-400">· {branchName}</span>}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleLogout}
              disabled={logoutLoading}
              className="rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 transition-colors duration-200 cursor-pointer"
              title="Cerrar sesión"
            >
              {logoutLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
            </Button>
          </header>
          <main className="px-2">
            <StockAdjustmentView profile={profile} branchName={branchName} />
          </main>
        </div>
        <footer className="text-center pt-8 text-[11px] text-zinc-400 dark:text-zinc-500 font-medium tracking-wide">
          Portal de colaborador/a • ERP Tiendas
        </footer>
      </div>
    )
  }

  // POS roles: full sidebar shell (mirrors admin/page.tsx layout)
  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans text-zinc-900 dark:text-zinc-50 antialiased">

      {/* Sidebar */}
      <EmployeeSidebar
        currentSection={activeSection as AdminSection}
        setSection={handleSetSection}
        storeName={storeName}
        adminName={displayName}
        adminEmail={profile.email ?? ''}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        onLogout={handleLogout}
        branchId={profile.branch_id}
      />

      {/* Right area */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0 min-h-screen">

        {/* Header */}
        <header className="sticky top-0 z-20 h-16 w-full border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-900/80 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
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
                {storeName || 'Mi Tienda'}
              </h2>
              {branchName && (
                <span className="text-xs text-zinc-400 font-medium">· {branchName}</span>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            size="xs"
            onClick={handleLogout}
            disabled={logoutLoading}
            className="h-8 gap-1.5 rounded-lg border-zinc-200 text-zinc-650 hover:text-red-650 hover:bg-red-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-red-400 dark:hover:bg-red-950/20 cursor-pointer"
          >
            {logoutLoading ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </header>

        {/* Content */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10">
          <div className="transition-all duration-300 ease-in-out">
            {renderSection()}
          </div>
        </main>

      </div>
    </div>
  )
}
