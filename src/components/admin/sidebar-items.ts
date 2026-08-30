import {
  LayoutDashboard,
  Calendar,
  TrendingUp,
  Users,
  Contact,
  Tags,
  Settings,
  Building2,
  Wallet,
  ShoppingCart,
  Receipt,
  type LucideIcon,
} from 'lucide-react'

export type AdminSection =
  | 'pos'
  | 'my_sales'
  | 'dashboard'
  | 'history'
  | 'employees'
  | 'staff'
  | 'clients'
  | 'stock'
  | 'cash'
  | 'branches'
  | 'settings'

export interface SidebarItem {
  id: AdminSection
  label: string
  icon: LucideIcon
  description: string
}

export const ADMIN_MENU_ITEMS: SidebarItem[] = [
  {
    id: 'pos',
    label: 'Punto de Venta',
    icon: ShoppingCart,
    description: 'Registrar ventas',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Métricas y ventas de hoy',
  },
  {
    id: 'history',
    label: 'Historial de Ventas',
    icon: Calendar,
    description: 'Filtrar por fechas y acumulados',
  },
  {
    id: 'employees',
    label: 'Rendimiento',
    icon: TrendingUp,
    description: 'Análisis de ventas por empleado/a',
  },
  {
    id: 'clients',
    label: 'Clientes',
    icon: Contact,
    description: 'Gestión de clientes y contactos',
  },
  {
    id: 'staff',
    label: 'Gestión de Personal',
    icon: Users,
    description: 'Administración e invitaciones',
  },
  {
    id: 'stock',
    label: 'Stock / Precios',
    icon: Tags,
    description: 'Reglas de precio por cantidad',
  },
  {
    id: 'cash',
    label: 'Caja',
    icon: Wallet,
    description: 'Apertura, cierre y reconciliación de caja',
  },
  {
    id: 'branches',
    label: 'Sucursales',
    icon: Building2,
    description: 'Crear, renombrar y desactivar sucursales',
  },
  {
    id: 'settings',
    label: 'Configuración',
    icon: Settings,
    description: 'Ajustes de la tienda',
  },
]

export const ENCARGADO_MENU_ITEMS: SidebarItem[] = ADMIN_MENU_ITEMS.filter(
  (item) => item.id !== 'branches' && item.id !== 'settings'
)

export const EMPLOYEE_MENU_ITEMS: SidebarItem[] = [
  { id: 'pos',      label: 'Punto de Venta', icon: ShoppingCart, description: 'Registrar ventas' },
  { id: 'my_sales', label: 'Mis ventas',     icon: Receipt,      description: 'Ventas del día' },
  { id: 'cash',     label: 'Caja',           icon: Wallet,       description: 'Apertura y cierre' },
]
