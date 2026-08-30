'use client'

import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { ENCARGADO_MENU_ITEMS, type AdminSection } from '@/components/admin/sidebar-items'

interface EncargadoSidebarProps {
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

export function EncargadoSidebar(props: EncargadoSidebarProps) {
  return (
    <AdminSidebar
      {...props}
      items={ENCARGADO_MENU_ITEMS}
      portalLabel="Portal Encargado"
    />
  )
}
