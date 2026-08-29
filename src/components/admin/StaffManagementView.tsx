'use client'

import { UserManager } from '@/components/admin/UserManager'
import { Users } from 'lucide-react'
import type { Role } from '@/lib/roles'

interface StaffManagementViewProps {
  storeId: string | null
  currentUserId?: string | null
  callerRole?: Role | string | null
  callerBranchId?: string | null
}

export function StaffManagementView({
  storeId,
  currentUserId,
  callerRole = 'admin',
  callerBranchId = null,
}: StaffManagementViewProps) {
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Title Header */}
      <div className="flex flex-col gap-1.5 border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2.5">
          <Users className="h-6 w-6 text-zinc-900 dark:text-white" />
          Gestión de Personal
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Revisa el equipo actual del local e invita a nuevos colaboradores a través de su cuenta Gmail.
        </p>
      </div>

      {/* Main User management component */}
      <UserManager
        storeId={storeId}
        currentUserId={currentUserId}
        callerRole={callerRole}
        callerBranchId={callerBranchId}
      />
    </div>
  )
}

