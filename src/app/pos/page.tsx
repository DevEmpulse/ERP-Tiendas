'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { PosShell } from '@/components/pos/PosShell'
import { Skeleton } from '@/components/ui/skeleton'
import { POS_ENTRY_ROLES, homeFor, type Role } from '@/lib/roles'

interface Profile {
  id: string
  store_id: string
  name: string | null
  role: Role
  email: string | null
  branch_id: string | null
}

export default function PosPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [storeName, setStoreName] = useState<string>('')
  const [branchName, setBranchName] = useState<string>('')
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>('58mm')
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
        .select('id, store_id, name, role, email, branch_id, stores(name, thermal_paper_width)')
        .eq('id', session.user.id)
        .single()

      if (error || !profileData) {
        router.push('/login')
        return
      }

      if (!(POS_ENTRY_ROLES as readonly string[]).includes(profileData.role ?? '')) {
        router.push(homeFor(profileData.role))
        return
      }

      if (profileData.role !== 'admin' && !profileData.branch_id) {
        router.push('/login')
        return
      }

      const { stores, ...profileObj } = profileData as unknown as Profile & {
        stores: { name: string; thermal_paper_width?: '58mm' | '80mm' } | null
      }
      setProfile(profileObj)
      setStoreName(stores?.name ?? '')
      setPaperWidth((stores?.thermal_paper_width as '58mm' | '80mm') ?? '58mm')

      if (profileObj.branch_id) {
        const { data: branchData } = await supabase
          .from('branches')
          .select('name')
          .eq('id', profileObj.branch_id)
          .single()
        if (branchData) setBranchName(branchData.name)
      }

      setLoading(false)
    }

    init()
  }, [router])

  if (loading) {
    return (
      <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
        {/* Sidebar skeleton */}
        <div className="hidden md:flex flex-col w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200/80 dark:border-zinc-800/80 p-4 space-y-6">
          <Skeleton className="h-10 w-full rounded-xl" />
          <div className="space-y-3 flex-1 pt-6">
            <Skeleton className="h-9 w-full rounded-xl" />
            <Skeleton className="h-9 w-full rounded-xl" />
            <Skeleton className="h-9 w-full rounded-xl" />
          </div>
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
        {/* Content skeleton */}
        <div className="flex-1 flex flex-col">
          <div className="h-16 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/80 px-6 flex items-center gap-3">
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="flex-1 p-6 space-y-4">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  return profile ? (
    <PosShell
      profile={profile}
      storeName={storeName}
      branchName={branchName}
      paperWidth={paperWidth}
    />
  ) : null
}
