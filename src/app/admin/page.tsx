'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { AdminSidebar, AdminSection } from '@/components/admin/AdminSidebar'
import { DashboardView } from '@/components/admin/DashboardView'
import { HistoryView } from '@/components/admin/HistoryView'
import { EmployeesView } from '@/components/admin/EmployeesView'
import { StaffManagementView } from '@/components/admin/StaffManagementView'
import { ClientManager } from '@/components/admin/ClientManager'
import { Button } from '@/components/ui/button'
import { groupSales } from '@/lib/salesHelper'
import { Skeleton } from '@/components/ui/skeleton'
import { Menu, LogOut, Store, User, ShieldCheck } from 'lucide-react'

interface Profile {
  id: string
  name: string | null
  email: string | null
  role: 'admin' | 'employee'
  store_id: string | null
}

interface StoreData {
  id: string
  name: string
}

interface Sale {
  id: string
  created_at: string
  description: string
  payment_method: 'cash' | 'transfer' | 'card'
  total_amount: number
  employee_id: string
  profiles?: {
    id: string
    name: string | null
    email: string | null
  } | null
}

export default function AdminPage() {
  const router = useRouter()
  const supabase = createClient()

  // App Layout States
  const [activeSection, setActiveSection] = useState<AdminSection>('dashboard')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false) // Mobile drawer toggle

  // Loading States
  const [initialLoading, setInitialLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(true)

  // Context States
  const [userProfile, setUserProfile] = useState<Profile | null>(null)
  const [storeInfo, setStoreInfo] = useState<StoreData | null>(null)
  
  // Data States
  const [sales, setSales] = useState<Sale[]>([])
  const [highlightedSaleIds, setHighlightedSaleIds] = useState<string[]>([])
  const [employeesList, setEmployeesList] = useState<Profile[]>([])
  const [refreshSalesKey, setRefreshSalesKey] = useState(0)
  const triggerRefreshSales = () => setRefreshSalesKey(prev => prev + 1)

  // Sign out handler
  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Load Admin Profile and Store Context
  useEffect(() => {
    async function loadAdminContext() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

        // Fetch user profile
        const { data: profile, error: pError } = await supabase
          .from('profiles')
          .select('id, name, email, role, store_id')
          .eq('id', user.id)
          .single()

        if (pError || !profile) {
          console.error('Error fetching admin profile:', pError)
          router.push('/login')
          return
        }

        if (profile.role !== 'admin') {
          router.push('/employee')
          return
        }

        setUserProfile(profile as Profile)

        // Fetch store info
        if (profile.store_id) {
          const { data: store, error: sError } = await supabase
            .from('stores')
            .select('id, name')
            .eq('id', profile.store_id)
            .single()

          if (!sError && store) {
            setStoreInfo(store as StoreData)
          }
        }
      } catch (err) {
        console.error('Error loading admin context:', err)
      } finally {
        setInitialLoading(false)
      }
    }

    loadAdminContext()
  }, [router, supabase])
  // Load Sales Data once store is known
  useEffect(() => {
    if (!userProfile?.store_id) return

    async function loadSalesData() {
      setDataLoading(true)
      try {
        // Fetch all sales for this store
        const { data, error } = await supabase
          .from('sales')
          .select(`
            id,
            created_at,
            description,
            payment_method,
            total_amount,
            employee_id,
            client_id,
            clients (
              id,
              phone
            ),
            profiles (
              id,
              name,
              email
            )
          `)
          .order('created_at', { ascending: false })

        if (error) throw error
        
        // Mapped values
        const mappedSales = (data || []).map((sale: any) => ({
          ...sale,
          total_amount: Number(sale.total_amount)
        }))

        setSales(mappedSales)
      } catch (err) {
        console.error('Error fetching sales:', err)
      } finally {
        setDataLoading(false)
      }
    }

    loadSalesData()
  }, [userProfile, supabase, refreshSalesKey])

  // Load Employees list
  useEffect(() => {
    if (!userProfile?.store_id) return

    async function loadEmployees() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, name, email, role, store_id')
          .order('name', { ascending: true })

        if (!error && data) {
          setEmployeesList(data as Profile[])
        }
      } catch (err) {
        console.error('Error loading employees:', err)
      }
    }

    loadEmployees()
  }, [userProfile, supabase])

  // Realtime subscription for sales INSERT events
  useEffect(() => {
    if (!userProfile?.store_id) return

    const storeId = userProfile.store_id

    console.log(`Setting up realtime subscription for store ${storeId}...`)
    const channel = supabase
      .channel(`realtime-sales-${storeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sales',
          filter: `store_id=eq.${storeId}`,
        },
        async (payload) => {
          console.log('Realtime INSERT payload received:', payload)
          const newRecord = payload.new as any
          if (!newRecord) return

          try {
            // Fetch employee profile to enrich joined data
            const { data: profile } = await supabase
              .from('profiles')
              .select('id, name, email')
              .eq('id', newRecord.employee_id)
              .single()

            const enrichedSale: Sale = {
              id: newRecord.id,
              created_at: newRecord.created_at,
              description: newRecord.description,
              payment_method: newRecord.payment_method,
              total_amount: Number(newRecord.total_amount),
              employee_id: newRecord.employee_id,
              profiles: profile || null,
            }

            console.log('Enriched realtime sale:', enrichedSale)

            // Update sales state (prepend new sale)
            setSales((prev) => {
              if (prev.some(s => s.id === enrichedSale.id)) return prev
              return [enrichedSale, ...prev]
            })

            // Highlight the new sale ID
            setHighlightedSaleIds((prev) => [...prev, enrichedSale.id])

            // Remove highlighted ID after 3.5 seconds
            setTimeout(() => {
              setHighlightedSaleIds((prev) => prev.filter((id) => id !== enrichedSale.id))
            }, 3500)

          } catch (err) {
            console.error('Error handling realtime sale insert:', err)
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`Realtime subscription status for store ${storeId}:`, status)
        if (err) console.error('Realtime subscription error:', err)
      })

    return () => {
      console.log(`Cleaning up realtime subscription for store ${storeId}...`)
      supabase.removeChannel(channel)
    }
  }, [userProfile, supabase])

  // Compute metrics in local timezone
  const localTodayStats = () => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(23, 59, 59, 999)

    const yesterdayStart = new Date(start)
    yesterdayStart.setDate(yesterdayStart.getDate() - 1)
    const yesterdayEnd = new Date(end)
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1)

    // Today's Sales
    const todaySalesRaw = sales.filter(s => {
      const d = new Date(s.created_at)
      return d >= start && d <= end
    })

    // Group today's sales for display and transaction count
    const groupedTodaySales = groupSales(todaySalesRaw as any)

    // Yesterday's Sales
    const yesterdaySales = sales.filter(s => {
      const d = new Date(s.created_at)
      return d >= yesterdayStart && d <= yesterdayEnd
    })

    const dailyIncome = todaySalesRaw.reduce((acc, s) => acc + s.total_amount, 0)
    const dailySalesCount = groupedTodaySales.length
    const previousIncome = yesterdaySales.reduce((acc, s) => acc + s.total_amount, 0)

    return {
      todaySales: groupedTodaySales as any,
      dailyIncome,
      dailySalesCount,
      previousIncome
    }
  }

  const { todaySales, dailyIncome, dailySalesCount, previousIncome } = localTodayStats()

  // Render view depending on selected sidebar menu item
  const renderActiveView = () => {
    switch (activeSection) {
      case 'dashboard':
        return (
          <DashboardView
            sales={todaySales}
            dailyIncome={dailyIncome}
            dailySalesCount={dailySalesCount}
            previousIncome={previousIncome}
            loading={dataLoading}
            highlightedSaleIds={highlightedSaleIds}
            employees={employeesList as any}
            storeId={userProfile?.store_id || null}
            storeName={storeInfo?.name || 'Mi Tienda'}
            onSalesChange={triggerRefreshSales}
          />
        )
      case 'history':
        return (
          <HistoryView
            sales={groupSales(sales as any)}
            loading={dataLoading}
            employees={employeesList as any}
            storeId={userProfile?.store_id || null}
            storeName={storeInfo?.name || 'Mi Tienda'}
            onSalesChange={triggerRefreshSales}
          />
        )
      case 'employees':
        return <EmployeesView />
      case 'clients':
        return <ClientManager storeId={userProfile?.store_id || null} />
      case 'staff':
        return <StaffManagementView storeId={userProfile?.store_id || null} />
      default:
        return (
          <div className="py-8 text-center text-sm text-zinc-400">
            Sección no encontrada
          </div>
        )
    }
  }

  // Initial Load Screen
  if (initialLoading) {
    return (
      <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
        {/* Mock Sidebar Skeleton */}
        <div className="hidden md:flex flex-col w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200/80 dark:border-zinc-800/80 p-4 space-y-6">
          <Skeleton className="h-10 w-full rounded-xl" />
          <div className="space-y-3 flex-1 pt-6">
            <Skeleton className="h-9 w-full rounded-xl" />
            <Skeleton className="h-9 w-full rounded-xl" />
            <Skeleton className="h-9 w-full rounded-xl" />
            <Skeleton className="h-9 w-full rounded-xl" />
          </div>
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
        
        {/* Mock Content area Skeleton */}
        <div className="flex-1 flex flex-col">
          <header className="h-16 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/80 px-6 flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </header>
          <main className="flex-1 p-6 md:p-8 space-y-6">
            <div className="space-y-2 pb-4">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
            <Skeleton className="h-64 w-full rounded-xl" />
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans text-zinc-900 dark:text-zinc-50 antialiased transition-all duration-300">
      
      {/* 1. SIDEBAR Navigation */}
      <AdminSidebar
        currentSection={activeSection}
        setSection={setActiveSection}
        storeName={storeInfo?.name || 'Cargando tienda...'}
        adminName={userProfile?.name || 'Administrador'}
        adminEmail={userProfile?.email || 'admin@tienda.com'}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        onLogout={handleLogout}
      />

      {/* RIGHT AREA Container (Header + Content) */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0 min-h-screen">
        
        {/* 2. HEADER Block */}
        <header className="sticky top-0 z-20 h-16 w-full border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-900/80 transition-all duration-300 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Hamburger Button for Mobile */}
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 rounded-xl text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 border border-zinc-200/60 dark:border-zinc-800 cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            
            {/* Header info */}
            <div className="flex items-center gap-2">
              <span className="hidden md:flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/50">
                <Store className="h-4 w-4" />
              </span>
              <h2 className="text-xs sm:text-sm font-bold text-zinc-800 dark:text-zinc-200">
                {storeInfo?.name || 'Cargando Tienda...'}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Admin Badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 border border-zinc-800 dark:border-zinc-200 shadow-2xs">
              <ShieldCheck className="h-3.5 w-3.5" />
              Administrador
            </div>
            
            {/* Logout button */}
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

        {/* 3. CONTENT Block (Main independent scroll view) */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10">
          <div className="transition-all duration-300 ease-in-out">
            {renderActiveView()}
          </div>
        </main>

      </div>
    </div>
  )
}
