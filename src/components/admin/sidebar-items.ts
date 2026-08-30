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
  BarChart3,
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
  | 'analytics'

export type SidebarGroupId = 'operacion' | 'ventas' | 'catalogo' | 'personas' | 'sistema'

export const SIDEBAR_GROUPS: { id: SidebarGroupId; label: string }[] = [
  { id: 'operacion', label: 'Operación' },
  { id: 'ventas', label: 'Ventas' },
  { id: 'catalogo', label: 'Catálogo' },
  { id: 'personas', label: 'Personas' },
  { id: 'sistema', label: 'Sistema' },
]

export interface SidebarItem {
  id: AdminSection
  label: string
  icon: LucideIcon
  description: string
  group: SidebarGroupId
}

export const ADMIN_MENU_ITEMS: SidebarItem[] = [
  {
    id: 'pos',
    label: 'Punto de Venta',
    icon: ShoppingCart,
    description: 'Registrar ventas',
    group: 'operacion',
  },
  {
    id: 'cash',
    label: 'Caja',
    icon: Wallet,
    description: 'Apertura, cierre y reconciliación de caja',
    group: 'operacion',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Métricas y ventas de hoy',
    group: 'ventas',
  },
  {
    id: 'history',
    label: 'Historial de Ventas',
    icon: Calendar,
    description: 'Filtrar por fechas y acumulados',
    group: 'ventas',
  },
  {
    id: 'employees',
    label: 'Rendimiento',
    icon: TrendingUp,
    description: 'Análisis de ventas por empleado/a',
    group: 'ventas',
  },
  {
    id: 'analytics',
    label: 'Analítica',
    icon: BarChart3,
    description: 'Ranking de productos, sucursales, stock y caja',
    group: 'ventas',
  },
  {
    id: 'stock',
    label: 'Stock / Precios',
    icon: Tags,
    description: 'Reglas de precio por cantidad',
    group: 'catalogo',
  },
  {
    id: 'clients',
    label: 'Clientes',
    icon: Contact,
    description: 'Gestión de clientes y contactos',
    group: 'personas',
  },
  {
    id: 'staff',
    label: 'Gestión de Personal',
    icon: Users,
    description: 'Administración e invitaciones',
    group: 'personas',
  },
  {
    id: 'branches',
    label: 'Sucursales',
    icon: Building2,
    description: 'Crear, renombrar y desactivar sucursales',
    group: 'sistema',
  },
  {
    id: 'settings',
    label: 'Configuración',
    icon: Settings,
    description: 'Ajustes de la tienda',
    group: 'sistema',
  },
]

export const ENCARGADO_MENU_ITEMS: SidebarItem[] = ADMIN_MENU_ITEMS.filter(
  (item) => item.id !== 'branches' && item.id !== 'settings'
)

export const EMPLOYEE_MENU_ITEMS: SidebarItem[] = [
  { id: 'pos',      label: 'Punto de Venta', icon: ShoppingCart, description: 'Registrar ventas', group: 'operacion' },
  { id: 'my_sales', label: 'Mis ventas',     icon: Receipt,      description: 'Ventas del día',   group: 'operacion' },
  { id: 'cash',     label: 'Caja',           icon: Wallet,       description: 'Apertura y cierre', group: 'operacion' },
]
