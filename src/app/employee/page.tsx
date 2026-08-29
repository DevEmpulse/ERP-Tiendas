'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import EmployeeDashboard from '@/components/employee/employee-dashboard'
import { Skeleton } from '@/components/ui/skeleton'
import { canAccess, homeFor, type Role } from '@/lib/roles'

interface Profile {
  id: string
  store_id: string
  name: string | null
  role: Role | null
  email: string | null
  branch_id: string | null
}

export default function EmployeePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [storeName, setStoreName] = useState<string>('')
  const [branchName, setBranchName] = useState<string>('')
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>('58mm')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient()
      
      // Use getSession (reads from cookie — no network round-trip)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/login')
        return
      }

      // Single query: profile + store name via join
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, store_id, name, role, email, branch_id, stores(name, thermal_paper_width)')
        .eq('id', session.user.id)
        .single()

      if (profileError || !profileData) {
        console.error('Error fetching user profile:', profileError)
        router.push('/login')
        return
      }

      if (!canAccess('/employee', profileData.role)) {
        router.push(homeFor(profileData.role))
        return
      }

      // If branch-scoped role has no branch, redirect to login
      if (profileData.role !== 'admin' && !profileData.branch_id) {
        router.push('/login')
        return
      }

      const { stores, ...profileObj } = profileData as unknown as Profile & { stores: { name: string; thermal_paper_width?: '58mm' | '80mm' } | null }
      setProfile(profileObj)
      setStoreName(stores?.name ?? '')
      setPaperWidth((stores?.thermal_paper_width as '58mm' | '80mm') ?? '58mm')

      if (profileObj.branch_id) {
        const { data: branchData } = await supabase
          .from('branches')
          .select('name')
          .eq('id', profileObj.branch_id)
          .single()

        if (branchData) {
          setBranchName(branchData.name)
        }
      }

      setLoading(false)
    }

    checkAuth()
  }, [router])

  if (loading) {
    return (
      <div className="relative min-h-screen w-full flex flex-col items-center justify-start bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.1),rgba(255,255,255,0))] dark:bg-zinc-950 p-4">
        <div className="w-full max-w-md space-y-6 mt-4">
          {/* Header Skeleton */}
          <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-zinc-900/40 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-800/30 rounded-2xl shadow-sm">
            <div className="flex items-center gap-3 w-full">
              <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
              <div className="space-y-2 w-1/2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
          </div>

          {/* Form Card Skeleton */}
          <div className="border border-zinc-200/80 bg-white/70 backdrop-blur-xl dark:border-zinc-800/50 dark:bg-zinc-900/60 rounded-2xl p-6 space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            
            {/* Description Textarea Skeleton */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-[70px] w-full rounded-xl" />
            </div>

            {/* Amount Skeleton */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>

            {/* Payment Method Skeleton */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <div className="flex gap-2">
                <Skeleton className="h-16 flex-1 rounded-xl" />
                <Skeleton className="h-16 flex-1 rounded-xl" />
                <Skeleton className="h-16 flex-1 rounded-xl" />
              </div>
            </div>

            {/* Client Accordion & Submit Button Skeleton */}
            <div className="space-y-4 pt-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Loaded state
  return (
    <div className="relative min-h-screen w-full flex flex-col bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.1),rgba(255,255,255,0))] dark:bg-zinc-950 p-4">
      {/* Blurry decorative background blobs */}
      <div className="absolute top-[-5%] left-[-5%] h-[250px] w-[250px] rounded-full bg-neutral-200/30 blur-[80px] dark:bg-neutral-800/10 pointer-events-none" />
      <div className="absolute bottom-[-5%] right-[-5%] h-[250px] w-[250px] rounded-full bg-zinc-200/30 blur-[80px] dark:bg-zinc-800/10 pointer-events-none" />
      
      {profile && <EmployeeDashboard profile={profile} storeName={storeName} branchName={branchName} paperWidth={paperWidth} />}
    </div>
  )
}
