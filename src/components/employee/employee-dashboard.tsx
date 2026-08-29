'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import SalesForm from './sales-form'
import { MySalesView } from './MySalesView'
import { StockAdjustmentView } from './StockAdjustmentView'
import { Button } from '@/components/ui/button'
import { LogOut, Store, PlusCircle, Receipt, Boxes } from 'lucide-react'
import { STOCK_ROLES, type Role } from '@/lib/roles'

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

export default function EmployeeDashboard({
  profile,
  storeName,
  branchName,
  paperWidth = '58mm',
}: EmployeeDashboardProps) {
  const router = useRouter()
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'form' | 'my_sales'>('form')

  const handleLogout = async () => {
    setLogoutLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isStockRole = (STOCK_ROLES as readonly string[]).includes(profile.role ?? '')

  // Fallback display name
  const displayName = profile.name || (profile.email ? profile.email.split('@')[0] : 'Colaborador/a')

  return (
    <div className={`w-full ${isStockRole ? 'max-w-5xl' : 'max-w-md'} mx-auto flex flex-col min-h-screen justify-between pb-8`}>
      <div className="flex-1 space-y-5">
        {/* Header Section */}
        <header className="flex items-center justify-between p-4 bg-white/40 dark:bg-zinc-900/40 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-800/30 rounded-2xl shadow-sm mt-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-zinc-950 dark:bg-zinc-50 flex items-center justify-center text-white dark:text-zinc-950 font-bold shadow-sm">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-1">
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

        {/* Content dispatch by role */}
        {isStockRole ? (
          <main className="px-2">
            <StockAdjustmentView profile={profile} branchName={branchName} />
          </main>
        ) : (
          <div className="space-y-4">
            {/* Two-tab toggle for POS roles */}
            <div className="flex rounded-xl bg-zinc-100 dark:bg-zinc-800/70 p-1 border border-zinc-200/80 dark:border-zinc-700 mx-2">
              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'form'
                    ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Nueva venta
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('my_sales')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'my_sales'
                    ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <Receipt className="h-3.5 w-3.5" />
                Mis ventas de hoy
              </button>
            </div>

            <main className="px-2">
              {activeTab === 'form' ? (
                <SalesForm profile={profile} storeName={storeName} paperWidth={paperWidth} />
              ) : (
                <MySalesView profile={profile} storeName={storeName} paperWidth={paperWidth} />
              )}
            </main>
          </div>
        )}
      </div>

      {/* Footer Branding */}
      <footer className="text-center pt-8 text-[11px] text-zinc-400 dark:text-zinc-500 font-medium tracking-wide">
        Portal de colaborador/a • ERP Tiendas
      </footer>
    </div>
  )
}
