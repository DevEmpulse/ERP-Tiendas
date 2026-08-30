'use client'

import { LogOut, Store, X } from 'lucide-react'
import { AdminSection, SidebarItem, ADMIN_MENU_ITEMS, SIDEBAR_GROUPS } from './sidebar-items'
import { SidebarCashWidget } from './SidebarCashWidget'

export type { AdminSection, SidebarItem }

interface AdminSidebarProps {
  currentSection: AdminSection
  setSection: (section: AdminSection) => void
  storeName: string
  adminName: string
  adminEmail: string
  isOpen: boolean // For mobile drawer state
  setIsOpen: (isOpen: boolean) => void
  onLogout: () => void
  items?: SidebarItem[]
  portalLabel?: string
  branchId?: string | null
  cashRefreshKey?: number
}

export function AdminSidebar({
  currentSection,
  setSection,
  storeName,
  adminName,
  adminEmail,
  isOpen,
  setIsOpen,
  onLogout,
  items = ADMIN_MENU_ITEMS,
  portalLabel = 'Admin Portal',
  branchId = null,
  cashRefreshKey,
}: AdminSidebarProps) {
  const menuItems = items
  const groups = SIDEBAR_GROUPS.map((group) => ({
    ...group,
    items: menuItems.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0)

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }

  // Sidebar Inner Layout
  const sidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Store Header logo */}
      <div className="h-16 px-6 border-b border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-xs">
            <Store className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate">
                {storeName || 'Cargando tienda...'}
              </h1>
              <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
                {portalLabel}
              </span>
            </div>
          </div>
        </div>
        {/* Mobile close button inside drawer */}
        <button
          onClick={() => setIsOpen(false)}
          className="md:hidden p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-5 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.id} className="mb-5 last:mb-0">
            <p className="px-4 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = currentSection === item.id

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSection(item.id)
                      setIsOpen(false) // Close drawer on mobile
                    }}
                    title={item.description}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group text-left ${isActive
                        ? 'bg-zinc-900 text-white shadow-xs dark:bg-zinc-50 dark:text-zinc-950 font-semibold'
                        : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                  >
                    <Icon className={`h-4.5 w-4.5 shrink-0 transition-transform duration-200 group-hover:scale-[1.05] ${isActive
                        ? 'text-white dark:text-zinc-950'
                        : 'text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300'
                      }`} />
                    <span className="text-sm truncate">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Mi Caja summary */}
      <SidebarCashWidget branchId={branchId} refreshKey={cashRefreshKey} onManage={setSection} />

      {/* Profile & Logout */}
      <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-800/80 pt-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-300/30 font-bold text-xs">
            {adminName ? getInitials(adminName) : 'AD'}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-50 block truncate">
              {adminName || 'Admin'}
            </span>
            <span className="text-[10px] text-zinc-400 block truncate">
              {adminEmail || 'admin@tienda.com'}
            </span>
          </div>
          <button
            onClick={onLogout}
            title="Cerrar sesión"
            className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 dark:hover:text-red-400 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* 1. Desktop Sidebar (Always Visible on md+) */}
      <aside className="hidden md:flex flex-col md:w-64 h-screen fixed left-0 top-0 z-30 border-r border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
        {sidebarContent}
      </aside>

      {/* 2. Mobile Drawer Sidebar (Using Tailwind Slide-in overlay) */}
      <div className={`md:hidden fixed inset-0 z-50 transition-all duration-300 ${isOpen ? 'visible pointer-events-auto' : 'invisible pointer-events-none'
        }`}>
        {/* Backdrop overlay */}
        <div
          onClick={() => setIsOpen(false)}
          className={`absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'
            }`}
        />

        {/* Sliding Menu panel */}
        <aside className={`absolute top-0 left-0 w-72 h-full shadow-2xl transition-transform duration-300 ease-out flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}>
          {sidebarContent}
        </aside>
      </div>
    </>
  )
}
