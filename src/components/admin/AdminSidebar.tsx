'use client'

import { LogOut, Store, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminSection, SidebarItem, ADMIN_MENU_ITEMS } from './sidebar-items'

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
}: AdminSidebarProps) {
  const menuItems = items

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
            <h1 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate">
              {storeName || 'Cargando tienda...'}
            </h1>
            <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold tracking-wider uppercase">
              {portalLabel}
            </p>
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
      <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = currentSection === item.id

          return (
            <button
              key={item.id}
              onClick={() => {
                setSection(item.id)
                setIsOpen(false) // Close drawer on mobile
              }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer group text-left ${isActive
                  ? 'bg-zinc-900 text-white shadow-xs dark:bg-zinc-50 dark:text-zinc-950 font-semibold'
                  : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
            >
              <Icon className={`h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-[1.05] ${isActive
                  ? 'text-white dark:text-zinc-950'
                  : 'text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300'
                }`} />
              <div className="min-w-0">
                <span className="text-sm block">{item.label}</span>
                <span className={`text-[10px] font-normal block truncate ${isActive ? 'text-zinc-300 dark:text-zinc-500' : 'text-zinc-400 dark:text-zinc-500'
                  }`}>
                  {item.description}
                </span>
              </div>
            </button>
          )
        })}
      </nav>

      {/* Profile & Logout Card */}
      <div className="p-4 border-t border-zinc-100 dark:border-zinc-800/80">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-850/50 border border-zinc-100 dark:border-zinc-800/30">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-300/30 font-bold text-xs">
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
        </div>

        <Button
          onClick={onLogout}
          variant="ghost"
          className="w-full mt-3 h-9 justify-center gap-2 text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl cursor-pointer text-xs"
        >
          <LogOut className="h-4 w-4" />
          Cerrar Sesión
        </Button>
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
