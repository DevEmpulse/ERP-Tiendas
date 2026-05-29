'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { LogOut, ShieldAlert, PlusCircle, Trash2, Mail, Store, AlertCircle, CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react'

export default function SuperAdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [authorizedUsers, setAuthorizedUsers] = useState<any[]>([])
  const [actionLoading, setActionLoading] = useState(false)
  const [revokeLoadingId, setRevokeLoadingId] = useState<string | null>(null)
  
  // Form states
  const [email, setEmail] = useState('')
  const [storeName, setStoreName] = useState('')
  
  // Feedback alert state
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Verify role and load context
  useEffect(() => {
    async function checkSuperAdmin() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

        const { data: profileData, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        if (error || !profileData || profileData.role !== 'superadmin') {
          console.error('Unauthorized access attempt to superadmin dashboard')
          router.push('/login')
          return
        }

        setProfile(profileData)
        await loadAuthorizedUsers()
      } catch (err) {
        console.error('Error verifying superadmin status:', err)
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }

    checkSuperAdmin()
  }, [router, supabase])

  // Load whitelisted admins awaiting registration & registered active store admins
  async function loadAuthorizedUsers() {
    try {
      // 1. Fetch pending invitations
      const { data: pendingData, error: pendingError } = await supabase
        .from('allowed_admins')
        .select('*')
        .order('created_at', { ascending: false })

      if (pendingError) throw pendingError

      // 2. Fetch active store admins
      const { data: activeProfiles, error: activeError } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          store_id,
          stores (
            id,
            name
          )
        `)
        .eq('role', 'admin')

      if (activeError) throw activeError

      // Map pending whitelists
      const pendingList = (pendingData || []).map((p: any) => ({
        id: p.id,
        email: p.email,
        store_name: p.store_name,
        status: 'pending',
        store_id: null,
        created_at: p.created_at
      }))

      // Map active stores (excluding the superadmin's store if it has role admin, but role is superadmin anyway)
      const activeList = (activeProfiles || [])
        .filter((ap: any) => ap.email !== profile?.email && ap.stores) // Ensure they have a valid store
        .map((ap: any) => ({
          id: ap.id,
          email: ap.email,
          store_name: ap.stores.name,
          status: 'active',
          store_id: ap.stores.id,
          created_at: null // Active doesn't strictly need a creation timestamp here
        }))

      // Combine both lists (pending first, then active)
      setAuthorizedUsers([...pendingList, ...activeList])
    } catch (err) {
      console.error('Error loading whitelisted and active admins:', err)
      showFeedback('error', 'Error al cargar los accesos autorizados.')
    }
  }

  // Helper to show alert feedback
  function showFeedback(type: 'success' | 'error', message: string) {
    setFeedback({ type, message })
    setTimeout(() => {
      setFeedback(null)
    }, 6000)
  }

  // Handle Form Submission (Authorize new email & store)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !storeName.trim()) {
      showFeedback('error', 'Por favor, rellene todos los campos.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      showFeedback('error', 'El correo ingresado no tiene un formato válido.')
      return
    }

    const cleanedEmail = email.trim().toLowerCase()
    const cleanedStoreName = storeName.trim()

    // Check if email is already in the list
    const alreadyAuthorized = authorizedUsers.some(
      (u) => u.email.toLowerCase() === cleanedEmail
    )
    if (alreadyAuthorized) {
      showFeedback('error', 'Este correo electrónico ya cuenta con acceso habilitado (activo o pendiente).')
      return
    }

    setActionLoading(true)
    try {
      const { error } = await supabase
        .from('allowed_admins')
        .insert({
          email: cleanedEmail,
          store_name: cleanedStoreName
        })

      if (error) {
        if (error.code === '23505') {
          throw new Error('Este correo electrónico ya cuenta con una autorización pendiente.')
        }
        throw error
      }

      showFeedback('success', `Autorización registrada con éxito para ${cleanedEmail}.`)
      setEmail('')
      setStoreName('')
      await loadAuthorizedUsers()
    } catch (err: any) {
      console.error('Error inserting allowed admin:', err)
      showFeedback('error', err.message || 'Ocurrió un error al autorizar el acceso.')
    } finally {
      setActionLoading(false)
    }
  }

  // Handle Revoke or Delete Store
  const handleRevoke = async (id: string, emailStr: string, status: string, storeId: string | null) => {
    const isPending = status === 'pending'
    const confirmationMessage = isPending
      ? `¿Estás seguro de que deseas revocar el acceso autorizado para ${emailStr}?`
      : `¿Estás seguro de que deseas ELIMINAR la tienda de ${emailStr}? Esta acción borrará todas sus ventas, empleados e información de forma permanente.`

    if (!confirm(confirmationMessage)) {
      return
    }

    setRevokeLoadingId(id)
    try {
      if (isPending) {
        // Delete pending invitation from allowed_admins
        const { error } = await supabase
          .from('allowed_admins')
          .delete()
          .eq('id', id)

        if (error) throw error
        showFeedback('success', `Acceso revocado para ${emailStr}.`)
      } else {
        // Delete active store from stores table (cascades to profiles, sales, clients)
        if (!storeId) throw new Error('Identificador de la tienda faltante.')
        
        const { error } = await supabase
          .from('stores')
          .delete()
          .eq('id', storeId)

        if (error) throw error
        showFeedback('success', `Tienda y perfiles de ${emailStr} eliminados permanentemente.`)
      }
      
      await loadAuthorizedUsers()
    } catch (err: any) {
      console.error('Error revoking/deleting:', err)
      showFeedback('error', err.message || 'Error al procesar la solicitud.')
    } finally {
      setRevokeLoadingId(null)
    }
  }

  // Handle Logout
  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Skeleton Loader for Initial Setup Verification
  if (loading) {
    return (
      <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 md:p-12">
        <div className="max-w-6xl mx-auto w-full space-y-8">
          <div className="flex justify-between items-center border-b border-zinc-200 dark:border-zinc-800 pb-6">
            <div className="space-y-2">
              <Skeleton className="h-8 w-64 rounded-lg" />
              <Skeleton className="h-4 w-40 rounded-lg" />
            </div>
            <Skeleton className="h-10 w-24 rounded-lg" />
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="md:col-span-1">
              <Skeleton className="h-[280px] w-full rounded-2xl" />
            </div>
            <div className="md:col-span-2">
              <Skeleton className="h-[400px] w-full rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans text-zinc-900 dark:text-zinc-50 antialiased transition-all duration-300">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 flex flex-col gap-8">
        
        {/* HEADER */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-zinc-200/80 dark:border-zinc-800/80 pb-6 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 border border-zinc-800 dark:border-zinc-200 shadow-sm">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-zinc-900 via-zinc-700 to-zinc-900 dark:from-zinc-100 dark:via-zinc-300 dark:to-zinc-100 bg-clip-text text-transparent">
                ERP Tiendas - Súper Admin
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 font-medium">
              Panel de control exclusivo para la gestión de accesos y tiendas autorizadas
            </p>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-center">
            {/* Developer profile badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-900/5 dark:bg-white/5 border border-zinc-200/80 dark:border-zinc-850">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-zinc-650 dark:text-zinc-300 max-w-[140px] truncate sm:max-w-none">
                {profile?.email || 'empulse.dev@gmail.com'}
              </span>
              <span className="px-1.5 py-0.5 rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 text-[10px] uppercase font-bold tracking-wider">
                Developer
              </span>
            </div>

            {/* Logout */}
            <Button
              onClick={handleLogout}
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl border-zinc-200 hover:text-red-650 hover:bg-red-50 dark:border-zinc-850 dark:text-zinc-300 dark:hover:text-red-400 dark:hover:bg-red-950/20 cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Cerrar Sesión</span>
            </Button>
          </div>
        </header>

        {/* FEEDBACK ALERTS */}
        {feedback && (
          <div
            data-slot="feedback-alert"
            className={`flex items-start gap-3 p-4 rounded-2xl border transition-all duration-300 animate-in fade-in-50 slide-in-from-top-3 ${
              feedback.type === 'success'
                ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-400'
                : 'bg-destructive/5 border-destructive/20 text-destructive dark:text-red-400'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            )}
            <div className="text-sm font-medium">{feedback.message}</div>
          </div>
        )}

        {/* MAIN LAYOUT */}
        <div className="grid lg:grid-cols-3 gap-8 items-start">
          
          {/* COLUMN 1: AUTHORIZATION FORM */}
          <div className="lg:col-span-1">
            <Card className="rounded-2xl border border-zinc-200/70 dark:border-zinc-850/60 bg-white/70 dark:bg-zinc-900/40 backdrop-blur-xs shadow-xs">
              <CardHeader className="border-b border-zinc-250/20 dark:border-zinc-800/40 pb-4">
                <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2">
                  <PlusCircle className="h-4.5 w-4.5 text-zinc-500" />
                  Autorizar Nueva Tienda
                </CardTitle>
                <CardDescription className="text-xs">
                  Añade un correo de Google de un cliente para permitirle registrar una nueva tienda en el sistema.
                </CardDescription>
              </CardHeader>
              
              <CardContent className="pt-5">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      Correo Google del Cliente
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="cliente@gmail.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-9 h-10 rounded-xl"
                        disabled={actionLoading}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="storeName" className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      Nombre de la Tienda
                    </Label>
                    <div className="relative">
                      <Store className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                      <Input
                        id="storeName"
                        type="text"
                        placeholder="Ej. Tienda de Ropa Empulse"
                        value={storeName}
                        onChange={(e) => setStoreName(e.target.value)}
                        className="pl-9 h-10 rounded-xl"
                        disabled={actionLoading}
                        required
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-10 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-950 font-semibold cursor-pointer transition-all duration-200 shadow-sm mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Procesando...
                      </>
                    ) : (
                      'Autorizar Acceso'
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* COLUMN 2: TABLE OF ALLOWED ADMINS */}
          <div className="lg:col-span-2">
            <Card className="rounded-2xl border border-zinc-200/70 dark:border-zinc-850/60 bg-white/70 dark:bg-zinc-900/40 backdrop-blur-xs shadow-xs">
              <CardHeader className="border-b border-zinc-250/20 dark:border-zinc-800/40 pb-4">
                <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2">
                  <ShieldAlert className="h-4.5 w-4.5 text-zinc-500" />
                  Accesos y Tiendas Habilitadas
                </CardTitle>
                <CardDescription className="text-xs">
                  Lista de accesos habilitados en el sistema, mostrando tanto invitaciones pendientes de registro como tiendas activas creadas.
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-4 px-0 sm:px-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-zinc-100 dark:border-zinc-800">
                        <TableHead className="text-xs font-semibold py-3 px-4">Correo Habilitado</TableHead>
                        <TableHead className="text-xs font-semibold py-3 px-4">Tienda Asignada</TableHead>
                        <TableHead className="text-xs font-semibold py-3 px-4 text-center">Estado</TableHead>
                        <TableHead className="text-xs font-semibold py-3 px-4 text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    
                    <TableBody>
                      {authorizedUsers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-10 text-zinc-400 dark:text-zinc-500 text-xs">
                            No hay accesos ni tiendas registradas en el sistema.
                          </TableCell>
                        </TableRow>
                      ) : (
                        authorizedUsers.map((user) => (
                          <TableRow 
                            key={user.status + '-' + user.id} 
                            className="hover:bg-zinc-900/2 border-zinc-100 dark:border-zinc-800/60 transition-colors"
                          >
                            <TableCell className="py-3 px-4 font-medium max-w-[200px] truncate text-xs sm:text-sm">
                              {user.email}
                            </TableCell>
                            <TableCell className="py-3 px-4 text-xs sm:text-sm text-zinc-650 dark:text-zinc-350">
                              {user.store_name}
                            </TableCell>
                            <TableCell className="py-3 px-4 text-center">
                              {user.status === 'pending' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                  Esperando registro
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                  Activo
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="py-3 px-4 text-right">
                              <Button
                                onClick={() => handleRevoke(user.id, user.email, user.status, user.store_id)}
                                variant="outline"
                                size="xs"
                                className="h-8 w-8 p-0 rounded-lg border-zinc-200 hover:text-red-650 hover:bg-red-50 dark:border-zinc-850 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:bg-red-950/20 cursor-pointer"
                                disabled={revokeLoadingId === user.id}
                                title={user.status === 'pending' ? 'Revocar Acceso' : 'Eliminar Tienda'}
                              >
                                {revokeLoadingId === user.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>

      </div>
    </div>
  )
}
