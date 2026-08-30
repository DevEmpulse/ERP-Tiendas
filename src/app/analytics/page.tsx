'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { AnalyticsShell } from '@/components/analytics/AnalyticsShell'
import { Skeleton } from '@/components/ui/skeleton'
import { ANALYTICS_ROLES, homeFor, type Role } from '@/lib/roles'

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

export default function AnalyticsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [storeName, setStoreName] = useState<string>('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      const supabase = createClient()

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }

      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('id, store_id, name, role, email, branch_id, stores(name)')
        .eq('id', session.user.id)
        .single()

      if (error || !profileData) {
        router.push('/login')
        return
      }

      if (!(ANALYTICS_ROLES as readonly string[]).includes(profileData.role ?? '')) {
        router.push(homeFor(profileData.role))
        return
      }

      const { stores, ...profileObj } = profileData as unknown as Profile & {
        stores: { name: string } | null
      }
      setProfile(profileObj)
      setStoreName(stores?.name ?? '')

      // Admin sees every active branch (for the branch filter); encargado is
      // locked to their own branch, resolved server-side by the RPCs/view.
      if (profileObj.role === 'admin' && profileObj.store_id) {
        const { data: branchData } = await supabase
          .from('branches')
          .select('id, name')
          .eq('is_active', true)
          .order('name', { ascending: true })
        setBranches((branchData as Branch[]) || [])
      } else if (profileObj.branch_id) {
        const { data: branchData } = await supabase
          .from('branches')
          .select('id, name')
          .eq('id', profileObj.branch_id)
          .single()
        if (branchData) setBranches([branchData as Branch])
      }

      setLoading(false)
    }

    init()
  }, [router])

  if (loading) {
    return (
      <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="flex-1 flex flex-col">
          <div className="h-16 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/80 px-6 flex items-center gap-3">
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="flex-1 p-6 space-y-4">
            <Skeleton className="h-12 w-full rounded-xl" />
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  return profile ? (
    <AnalyticsShell
      profile={profile}
      storeName={storeName}
      branches={branches}
    />
  ) : null
}
