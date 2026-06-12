'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import SalesForm from './sales-form'
import { Button } from '@/components/ui/button'
import { LogOut, Store } from 'lucide-react'

interface Profile {
  id: string
  store_id: string
  name: string | null
  role: string | null
  email: string | null
}

interface EmployeeDashboardProps {
  profile: Profile
  storeName: string
  paperWidth?: '58mm' | '80mm'
}

export default function EmployeeDashboard({ profile, storeName, paperWidth = '58mm' }: EmployeeDashboardProps) {
  const router = useRouter()
  const [logoutLoading, setLogoutLoading] = useState(false)

  const handleLogout = async () => {
    setLogoutLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // Fallback display name
  const displayName = profile.name || (profile.email ? profile.email.split('@')[0] : 'Colaboradora')

  return (
    <div className="w-full max-w-md mx-auto flex flex-col min-h-screen justify-between pb-8">
      <div className="flex-1 space-y-6">
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

        {/* Core Sales Registration Form */}
        <main className="px-2">
          <SalesForm profile={profile} storeName={storeName} paperWidth={paperWidth} />
        </main>
      </div>

      {/* Footer Branding */}
      <footer className="text-center pt-8 text-[11px] text-zinc-400 dark:text-zinc-500 font-medium tracking-wide">
        Portal de empleado/a • ERP Tiendas
      </footer>
    </div>
  )
}
