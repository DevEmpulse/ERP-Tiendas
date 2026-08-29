'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast, Toaster } from '@/components/ui/toast'
import { Users, UserPlus, Search, Mail, ShieldAlert, Edit, Trash2, Building2, ShieldCheck } from 'lucide-react'
import {
  Role,
  ADMIN_ASSIGNABLE_ROLES,
  ENCARGADO_ASSIGNABLE_ROLES,
  BRANCH_SCOPED_ROLES,
} from '@/lib/roles'

interface UserProfile {
  id: string
  name: string | null
  email: string | null
  role: Role
  branch_id: string | null
  created_at: string
}

interface Branch {
  id: string
  name: string
}

interface UserManagerProps {
  storeId: string | null
  currentUserId?: string | null
  callerRole?: Role | string | null
  callerBranchId?: string | null
}

export function UserManager({
  storeId,
  currentUserId: propCurrentUserId,
  callerRole = 'admin',
  callerBranchId = null,
}: UserManagerProps) {
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  // Invite form states
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<Role>('caja')
  const [newBranchId, setNewBranchId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Branches (active only)
  const [branches, setBranches] = useState<Branch[]>([])

  // Edit/Delete states
  const [currentUserId, setCurrentUserId] = useState<string | null>(propCurrentUserId || null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<Role>('caja')
  const [editBranchId, setEditBranchId] = useState<string | null>(null)

  const { toasts, toast, dismiss } = useToast()
  const supabase = createClient()

  // Assignable roles based on caller
  const assignableRoles = useMemo(() => {
    if (callerRole === 'encargado') {
      return ENCARGADO_ASSIGNABLE_ROLES as readonly Role[]
    }
    return ADMIN_ASSIGNABLE_ROLES as readonly Role[]
  }, [callerRole])

  // Fetch current profiles
  const fetchProfiles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, role, branch_id, created_at')
        .order('role', { ascending: true })
        .order('name', { ascending: true })

      if (error) throw error
      setProfiles((data as UserProfile[]) || [])
    } catch (err: unknown) {
      console.error('Error fetching users:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    let ignore = false
    async function run() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, name, email, role, branch_id, created_at')
          .order('role', { ascending: true })
          .order('name', { ascending: true })

        if (error) throw error
        if (!ignore) setProfiles((data as UserProfile[]) || [])
      } catch (err: unknown) {
        console.error('Error fetching users:', err)
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    run()

    if (!propCurrentUserId) {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user && !ignore) {
          setCurrentUserId(data.user.id)
        }
      })
    }

    return () => { ignore = true }
  }, [supabase, propCurrentUserId])

  // Load active branches once
  useEffect(() => {
    let ignore = false
    async function run() {
      try {
        const { data, error } = await supabase
          .from('branches')
          .select('id, name')
          .eq('is_active', true)
          .order('name', { ascending: true })
        if (error) throw error
        if (!ignore) {
          const list = (data as Branch[]) || []
          setBranches(list)
          if (callerRole === 'encargado' && callerBranchId) {
            setNewBranchId(callerBranchId)
          } else {
            setNewBranchId(prev => prev || list[0]?.id || '')
          }
        }
      } catch (err: unknown) {
        console.error('Error loading branches:', err)
      }
    }
    run()
    return () => { ignore = true }
  }, [supabase, callerRole, callerBranchId])

  const getRoleLabel = (role: Role | string) => {
    switch (role) {
      case 'admin':
        return 'Administrador'
      case 'encargado':
        return 'Encargado/a de Sucursal'
      case 'caja':
        return 'Cajero/a (POS)'
      case 'stock':
        return 'Stock / Inventario'
      case 'employee':
        return 'Empleado/a (Legado)'
      case 'superadmin':
        return 'Superadmin'
      default:
        return role
    }
  }

  // Handle Edit Member
  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return

    if (!editName.trim()) {
      setErrorMsg('Por favor introduce el nombre.')
      return
    }

    if (!editEmail.toLowerCase().endsWith('@gmail.com')) {
      setErrorMsg('Por el momento, solo se admiten correos de Gmail (@gmail.com).')
      return
    }

    const requiresBranch = (BRANCH_SCOPED_ROLES as readonly string[]).includes(editRole)
    if (requiresBranch && !editBranchId) {
      setErrorMsg('Selecciona una sucursal para este rol.')
      return
    }

    // Optimistic close
    const userSnapshot = selectedUser
    const nameSnapshot = editName.trim()
    const emailSnapshot = editEmail.trim().toLowerCase()
    const editRoleSnapshot = editRole
    const branchIdSnapshot = requiresBranch ? editBranchId : null

    setIsEditOpen(false)
    setSelectedUser(null)
    setErrorMsg(null)

    try {
      let rpcRes = await supabase.rpc('update_employee_user', {
        p_employee_id: userSnapshot.id,
        p_name: nameSnapshot,
        p_email: emailSnapshot,
        p_branch_id: branchIdSnapshot,
        p_role: editRoleSnapshot,
      })

      // Fallback for older 4-arg signature if DB hasn't applied section 16 yet
      if (rpcRes.error && (rpcRes.error.code === 'PGRST202' || rpcRes.error.message?.includes('PGRST202') || rpcRes.error.message?.includes('function'))) {
        const fallbackRes = await supabase.rpc('update_employee_user', {
          p_employee_id: userSnapshot.id,
          p_name: nameSnapshot,
          p_email: emailSnapshot,
          p_branch_id: branchIdSnapshot,
        })
        if (!fallbackRes.error) {
          rpcRes = fallbackRes
        }
      }

      if (rpcRes.error) throw rpcRes.error

      toast('Miembro del equipo actualizado con éxito.', 'success')
      await fetchProfiles()
    } catch (err: unknown) {
      console.error('Error updating employee:', err)
      const postgrestErr = err as { message?: string; details?: string; hint?: string }
      const msg = postgrestErr?.message || (err instanceof Error ? err.message : 'Error al actualizar el miembro del equipo.')
      toast(msg, 'error')
    }
  }

  // Handle Delete Member
  const handleDeleteUser = async () => {
    if (!selectedUser) return

    const userSnapshot = selectedUser
    setIsDeleteOpen(false)
    setSelectedUser(null)
    setProfiles(prev => prev.filter(p => p.id !== userSnapshot.id))

    try {
      const { error } = await supabase.rpc('delete_employee_user', {
        p_employee_id: userSnapshot.id,
      })

      if (error) throw error

      toast('Miembro del equipo eliminado con éxito.', 'success')
    } catch (err: unknown) {
      console.error('Error deleting employee:', err)
      const postgrestErr = err as { message?: string; details?: string }
      const msg = postgrestErr?.message || (err instanceof Error ? err.message : 'Error al eliminar el miembro del equipo.')
      toast(msg, 'error')
      await fetchProfiles()
    }
  }

  // Permission guard: Who can manage which user
  const canManageUser = useCallback((user: UserProfile) => {
    // Cannot edit yourself
    if (user.id === currentUserId) return false

    // Superadmin is read-only in store view
    if (user.role === 'superadmin') return false

    // If target is admin: no non-admin (e.g. encargado) can touch them
    if (user.role === 'admin') {
      return callerRole === 'admin'
    }

    // If target is encargado: only admin can manage them
    if (user.role === 'encargado') {
      return callerRole === 'admin'
    }

    // If caller is encargado: can ONLY edit caja, stock, employee in their own branch
    if (callerRole === 'encargado') {
      if (!['caja', 'stock', 'employee'].includes(user.role)) return false
      if (callerBranchId && user.branch_id !== callerBranchId) return false
      return true
    }

    // Caller is admin: can manage store members
    return callerRole === 'admin'
  }, [currentUserId, callerRole, callerBranchId])

  const openEdit = (user: UserProfile) => {
    if (!canManageUser(user)) return
    setSelectedUser(user)
    setEditName(user.name || '')
    setEditEmail(user.email || '')
    setEditRole(user.role)
    setEditBranchId(user.branch_id || (callerRole === 'encargado' ? callerBranchId : branches[0]?.id || null))
    setErrorMsg(null)
    setIsEditOpen(true)
  }

  const openDelete = (user: UserProfile) => {
    if (!canManageUser(user)) return
    setSelectedUser(user)
    setIsDeleteOpen(true)
  }

  // Handle invitation submission
  const handleSubmitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId) {
      setErrorMsg('No se ha detectado el ID de la tienda.')
      return
    }

    if (!newEmail.toLowerCase().endsWith('@gmail.com')) {
      setErrorMsg('Por el momento, solo se admiten correos de Gmail (@gmail.com).')
      return
    }

    if (!newName.trim()) {
      setErrorMsg('Por favor introduce el nombre.')
      return
    }

    const requiresBranch = (BRANCH_SCOPED_ROLES as readonly string[]).includes(newRole)
    const effectiveBranchId = callerRole === 'encargado' ? callerBranchId : newBranchId

    if (requiresBranch && !effectiveBranchId) {
      setErrorMsg('Selecciona una sucursal.')
      return
    }

    // Optimistic close
    const emailSnapshot = newEmail.trim().toLowerCase()
    const nameSnapshot = newName.trim()
    const roleSnapshot = newRole
    const branchIdSnapshot = requiresBranch ? effectiveBranchId : null

    setIsDialogOpen(false)
    setNewEmail('')
    setNewName('')
    setNewRole(assignableRoles[0] || 'caja')
    setErrorMsg(null)

    setSubmitting(true)
    try {
      let rpcRes = await supabase.rpc('preload_employee', {
        p_email: emailSnapshot,
        p_name: nameSnapshot,
        p_role: roleSnapshot,
        p_store_id: storeId,
        p_branch_id: branchIdSnapshot,
      })

      if (rpcRes.error && (rpcRes.error.code === 'PGRST202' || rpcRes.error.message?.includes('PGRST202') || rpcRes.error.message?.includes('function'))) {
        const fallbackRes = await supabase.rpc('preload_employee', {
          p_email: emailSnapshot,
          p_name: nameSnapshot,
          p_store_id: storeId,
          p_branch_id: branchIdSnapshot,
        })
        if (!fallbackRes.error) {
          rpcRes = fallbackRes
        }
      }

      if (rpcRes.error) {
        throw rpcRes.error
      }

      toast(`¡Perfil pre-creado! Se asociará cuando ${emailSnapshot} inicie sesión.`, 'success')
      await fetchProfiles()
    } catch (err: unknown) {
      console.error('Error preloading employee:', err)
      const postgrestErr = err as { message?: string; details?: string }
      const msg = postgrestErr?.message || (err instanceof Error ? err.message : 'Error de conexión con la base de datos.')
      toast(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Filter local profiles list
  const filteredProfiles = profiles.filter((profile) => {
    const name = profile.name || ''
    const email = profile.email || ''
    const searchLower = searchTerm.toLowerCase()
    return name.toLowerCase().includes(searchLower) || email.toLowerCase().includes(searchLower)
  })

  // Format date
  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleDateString('es-CL', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    } catch {
      return 'N/A'
    }
  }

  // Get Initials
  const getInitials = (name: string | null, email: string | null) => {
    const text = name || email || '?'
    return text.split(' ').map(t => t[0]).slice(0, 2).join('').toUpperCase()
  }

  const renderRoleBadge = (role: Role) => {
    switch (role) {
      case 'admin':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950">
            Administrador
          </span>
        )
      case 'encargado':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800/40">
            Encargado/a
          </span>
        )
      case 'caja':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/40">
            Caja (POS)
          </span>
        )
      case 'stock':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40">
            Stock
          </span>
        )
      case 'employee':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-100 text-zinc-600 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-350 dark:border-zinc-700">
            Empleado/a (Legado)
          </span>
        )
      case 'superadmin':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800/40">
            Superadmin
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-100 text-zinc-600">
            {role}
          </span>
        )
    }
  }

  return (
    <>
      <Toaster toasts={toasts} dismiss={dismiss} />
      <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl overflow-hidden">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0 pb-4 border-b border-zinc-100 dark:border-zinc-800/80">
          <div>
            <CardTitle className="text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-500" />
              Gestión del Equipo
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Administra los roles, accesos y registra invitaciones para miembros del equipo.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search bar */}
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
              <Input
                placeholder="Buscar miembro..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 h-8 bg-zinc-50/50 border-zinc-200 focus-visible:ring-zinc-400 dark:bg-zinc-950/30 dark:border-zinc-850 rounded-lg text-xs"
              />
            </div>

            {/* Invitation Dialog Trigger */}
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open)
              if (!open) {
                setErrorMsg(null)
              }
            }}>
              <DialogTrigger render={
                <Button size="sm" className="h-8 gap-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold">
                  <UserPlus className="h-4 w-4" />
                  Registrar Gmail
                </Button>
              } />

              <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-850 p-6 rounded-xl shadow-lg">
                <DialogHeader className="space-y-1.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                  <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                    Pre-cargar miembro del equipo
                  </DialogTitle>
                  <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
                    Registra el correo Gmail. Cuando el usuario inicie sesión con Google, se unirá automáticamente a esta tienda con el rol asignado.
                  </DialogDescription>
                </DialogHeader>

                {/* Form */}
                <form onSubmit={handleSubmitInvite} className="space-y-4 pt-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                      Nombre Completo
                    </Label>
                    <Input
                      id="name"
                      placeholder="Ej. María González"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                      className="h-9 border-zinc-200 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                      Correo Electrónico (Gmail)
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="ejemplo@gmail.com"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        required
                        className="pl-9 h-9 border-zinc-200 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm"
                      />
                    </div>
                  </div>

                  {/* Role select */}
                  <div className="space-y-1.5">
                    <Label htmlFor="new-role" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
                      Rol
                    </Label>
                    <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
                      <SelectTrigger id="new-role" className="h-9 w-full border-zinc-200 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm">
                        <SelectValue placeholder="Selecciona un rol...">
                          {(value: string) => getRoleLabel(value as Role)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {assignableRoles.map((r) => (
                          <SelectItem key={r} value={r}>
                            {getRoleLabel(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Branch select — only for branch-scoped roles */}
                  {(BRANCH_SCOPED_ROLES as readonly string[]).includes(newRole) && (
                    <div className="space-y-1.5">
                      <Label htmlFor="new-branch" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-zinc-400" />
                        Sucursal
                      </Label>
                      {callerRole === 'encargado' ? (
                        <div className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 flex items-center text-sm text-zinc-700 dark:text-zinc-300 font-medium">
                          {branches.find((b) => b.id === callerBranchId)?.name || 'Tu sucursal'}
                        </div>
                      ) : (
                        <Select value={newBranchId} onValueChange={(v) => setNewBranchId(v as string)}>
                          <SelectTrigger id="new-branch" className="h-9 w-full border-zinc-200 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm">
                            <SelectValue placeholder="Selecciona una sucursal...">
                              {(value: string | null) => branches.find((b) => b.id === value)?.name ?? 'Selecciona una sucursal...'}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {branches.map((branch) => (
                              <SelectItem key={branch.id} value={branch.id}>
                                {branch.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}

                  {/* Validation error only */}
                  {errorMsg && (
                    <div className="flex items-start gap-2 p-3 text-xs text-red-600 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-lg font-medium">
                      <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <DialogFooter className="pt-2">
                    <Button
                      type="submit"
                      disabled={submitting}
                      className="h-9 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold w-full sm:w-auto"
                    >
                      {submitting ? 'Guardando...' : 'Pre-cargar miembro'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filteredProfiles.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-400">
              No se encontraron miembros de equipo.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-zinc-50/75 dark:bg-zinc-950/30 border-b border-zinc-100 dark:border-zinc-800/80">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-2.5 pl-6 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      Miembro
                    </TableHead>
                    <TableHead className="py-2.5 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      Email
                    </TableHead>
                    <TableHead className="py-2.5 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      Rol
                    </TableHead>
                    <TableHead className="py-2.5 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      Sucursal
                    </TableHead>
                    <TableHead className="py-2.5 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      Fecha Ingreso
                    </TableHead>
                    <TableHead className="py-2.5 text-right pr-6 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      Acciones
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {filteredProfiles.map((user) => (
                    <TableRow key={user.id} className="hover:bg-zinc-50/30 dark:hover:bg-zinc-800/20">
                      <TableCell className="py-3 pl-6 font-semibold text-zinc-850 dark:text-zinc-150">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-350 border border-zinc-200 dark:border-zinc-700">
                            {getInitials(user.name, user.email)}
                          </div>
                          <span className="truncate max-w-[150px] sm:max-w-xs">
                            {user.name || 'Invitado pre-cargado'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-xs text-zinc-500 dark:text-zinc-400">
                        {user.email || 'N/A'}
                      </TableCell>
                      <TableCell className="py-3 text-xs">
                        {renderRoleBadge(user.role)}
                      </TableCell>
                      <TableCell className="py-3 text-xs text-zinc-500 dark:text-zinc-400">
                        {user.branch_id
                          ? branches.find(b => b.id === user.branch_id)?.name || '—'
                          : '—'}
                      </TableCell>
                      <TableCell className="py-3 text-xs text-zinc-400">
                        {formatDate(user.created_at)}
                      </TableCell>
                      <TableCell className="py-3 text-right pr-6 text-xs">
                        {canManageUser(user) && (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(user)}
                              className="h-7 w-7 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                              title="Editar miembro"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDelete(user)}
                              className="h-7 w-7 text-zinc-500 hover:text-red-650 hover:bg-red-50 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:bg-red-950/20 rounded-lg cursor-pointer"
                              title="Eliminar miembro"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        {/* Edit Member Modal */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-850 p-6 rounded-xl shadow-lg">
            <DialogHeader className="space-y-1.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                Editar Perfil de Miembro
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
                Actualiza el nombre, correo, rol y sucursal del miembro del equipo.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleEditUser} className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-emp-name" className="text-xs font-semibold text-zinc-650 dark:text-zinc-300">
                  Nombre Completo
                </Label>
                <Input
                  id="edit-emp-name"
                  placeholder="Ej. María González"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="h-9 border-zinc-200 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-emp-email" className="text-xs font-semibold text-zinc-650 dark:text-zinc-300">
                  Correo Electrónico (Gmail)
                </Label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
                  <Input
                    id="edit-emp-email"
                    type="email"
                    placeholder="ejemplo@gmail.com"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    required
                    className="pl-9 h-9 border-zinc-200 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm"
                  />
                </div>
              </div>

              {/* Edit Role Select */}
              <div className="space-y-1.5">
                <Label htmlFor="edit-emp-role" className="text-xs font-semibold text-zinc-650 dark:text-zinc-300 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
                  Rol
                </Label>
                <Select
                  value={editRole}
                  onValueChange={(v) => setEditRole(v as Role)}
                  disabled={selectedUser?.role === 'admin'}
                >
                  <SelectTrigger id="edit-emp-role" className="h-9 w-full border-zinc-200 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm">
                    <SelectValue placeholder="Selecciona un rol...">
                      {(value: string) => getRoleLabel(value as Role)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {assignableRoles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {getRoleLabel(r)}
                      </SelectItem>
                    ))}
                    {selectedUser?.role === 'employee' && (
                      <SelectItem value="employee">
                        {getRoleLabel('employee')}
                      </SelectItem>
                    )}
                    {selectedUser?.role === 'admin' && (
                      <SelectItem value="admin">
                        {getRoleLabel('admin')}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {selectedUser?.role === 'admin' && (
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    El rol Administrador no puede ser modificado.
                  </p>
                )}
              </div>

              {/* Edit Branch Select */}
              {(BRANCH_SCOPED_ROLES as readonly string[]).includes(editRole) && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-branch" className="text-xs font-semibold text-zinc-650 dark:text-zinc-300 flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-zinc-400" />
                    Sucursal
                  </Label>
                  {callerRole === 'encargado' ? (
                    <div className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 flex items-center text-sm text-zinc-700 dark:text-zinc-300 font-medium">
                      {branches.find((b) => b.id === callerBranchId)?.name || 'Tu sucursal'}
                    </div>
                  ) : (
                    <Select value={editBranchId ?? ''} onValueChange={(v) => setEditBranchId(v as string)}>
                      <SelectTrigger id="edit-branch" className="h-9 w-full border-zinc-200 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm">
                        <SelectValue placeholder="Selecciona una sucursal...">
                          {(value: string | null) => branches.find((b) => b.id === value)?.name ?? 'Selecciona una sucursal...'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {errorMsg && (
                <div className="flex items-start gap-2 p-3 text-xs text-red-650 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-lg font-medium">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button
                  type="submit"
                  className="h-9 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold w-full sm:w-auto"
                >
                  Actualizar Miembro
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Modal */}
        <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-850 p-6 rounded-xl shadow-lg">
            <DialogHeader className="space-y-1.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <DialogTitle className="text-base font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" />
                ¿Confirmas eliminar este miembro?
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
                Esta acción eliminará de forma permanente al usuario <strong>{selectedUser?.name}</strong> de la base de datos y de la autenticación de Supabase. El usuario ya no podrá iniciar sesión.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="pt-4 flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDeleteOpen(false)}
                className="h-9 px-4 rounded-lg border-zinc-200 text-zinc-650 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-350 dark:hover:bg-zinc-950 cursor-pointer text-xs font-semibold"
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteUser}
                className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white dark:bg-red-750 dark:hover:bg-red-700 cursor-pointer text-xs font-semibold"
              >
                Sí, Eliminar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </>
  )
}
