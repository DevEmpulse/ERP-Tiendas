'use client'

import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { EMPLOYEE_MENU_ITEMS, type AdminSection } from '@/components/admin/sidebar-items'

interface EmployeeSidebarProps {
  currentSection: AdminSection
  setSection: (section: AdminSection) => void
  storeName: string
  adminName: string
  adminEmail: string
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
  onLogout: () => void
  branchId?: string | null
  cashRefreshKey?: number
}

export function EmployeeSidebar(props: EmployeeSidebarProps) {
  return (
    <AdminSidebar
      {...props}
      items={EMPLOYEE_MENU_ITEMS}
      portalLabel="Portal Caja"
    />
  )
}
