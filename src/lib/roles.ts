// src/lib/roles.ts — the single source of truth every gate imports

export type Role = 'admin' | 'encargado' | 'caja' | 'stock' | 'employee' | 'superadmin'

export const POS_ROLES = ['caja', 'employee'] as const // legacy pairing
export const STOCK_ROLES = ['stock'] as const
export const BRANCH_SCOPED_ROLES = ['encargado', 'caja', 'stock', 'employee'] as const
export const CATALOG_WRITE_ROLES = ['admin', 'superadmin', 'encargado'] as const
export const ADMIN_ASSIGNABLE_ROLES = ['admin', 'encargado', 'caja', 'stock'] as const
export const ENCARGADO_ASSIGNABLE_ROLES = ['caja', 'stock'] as const

export function homeFor(role: string | null | undefined): string {
  if (role === 'superadmin') return '/superadmin'
  if (role === 'admin') return '/admin'
  if (role === 'encargado') return '/encargado'
  return '/employee'
}

export function canAccess(prefix: string, role: string | null | undefined): boolean {
  if (!role) return false
  if (role === 'superadmin') return prefix.startsWith('/superadmin')
  if (prefix.startsWith('/admin')) return role === 'admin'
  if (prefix.startsWith('/encargado')) return role === 'encargado'
  if (prefix.startsWith('/employee')) {
    return role === 'admin' || (POS_ROLES as readonly string[]).includes(role) || (STOCK_ROLES as readonly string[]).includes(role)
  }
  return false
}
