'use client'

import { useState, useEffect, useCallback } from 'react'
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
} from '@/components/ui/dialog'
import { Contact, UserPlus, Search, Phone, Edit, Trash2, ShieldAlert } from 'lucide-react'
import { useToast, Toaster } from '@/components/ui/toast'

export interface Client {
  id: string
  store_id: string
  name: string
  phone: string | null
  created_at: string
}

interface ClientManagerProps {
  storeId: string | null
}

export function ClientManager({ storeId }: ClientManagerProps) {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  
  // Selected client for edit/delete
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  // Form states
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { toasts, toast, dismiss } = useToast()
  const supabase = createClient()

  // Fetch clients
  const fetchClients = useCallback(async () => {
    if (!storeId) return
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, store_id, name, phone, created_at')
        .order('name', { ascending: true })

      if (error) throw error
      setClients(data || [])
    } catch (err: unknown) {
      console.error('Error fetching clients:', err)
    } finally {
      setLoading(false)
    }
  }, [storeId, supabase])

  useEffect(() => {
    let ignore = false
    async function run() {
      if (!storeId) return
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('id, store_id, name, phone, created_at')
          .order('name', { ascending: true })

        if (error) throw error
        if (!ignore) setClients(data || [])
      } catch (err: unknown) {
        console.error('Error fetching clients:', err)
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    run()
    return () => { ignore = true }
  }, [storeId, supabase])

  // Handle Add Client
  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId) return

    if (!clientName.trim()) {
      setErrorMsg('Por favor introduce el nombre del cliente.')
      return
    }

    // Optimistic: close modal immediately, add to list
    const name = clientName.trim()
    const phone = clientPhone.trim() || null
    const tempId = Date.now().toString()
    const tempClient: Client = {
      id: tempId,
      store_id: storeId,
      name,
      phone,
      created_at: new Date().toISOString()
    }

    setIsAddOpen(false)
    setClientName('')
    setClientPhone('')
    setErrorMsg(null)
    setClients(prev => [tempClient, ...prev])
    setSubmitting(true)

    try {
      const { data: newClient, error } = await supabase
        .from('clients')
        .insert({ store_id: storeId, name, phone })
        .select('id, store_id, name, phone, created_at')
        .single()

      if (error) throw error

      if (newClient) {
        setClients(prev => prev.map(c => c.id === tempId ? newClient : c))
      }

      toast('Cliente creado con éxito.', 'success')
      await fetchClients()
    } catch (err: unknown) {
      console.error('Error creating client:', err)
      const msg = err instanceof Error ? err.message : 'Error al guardar el cliente.'
      toast(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Edit Client
  const handleEditClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedClient) return

    if (!clientName.trim()) {
      setErrorMsg('Por favor introduce el nombre del cliente.')
      return
    }

    // Optimistic: close modal immediately
    const id = selectedClient.id
    const name = clientName.trim()
    const phone = clientPhone.trim() || null
    setIsEditOpen(false)
    setSelectedClient(null)
    setErrorMsg(null)
    setSubmitting(true)

    try {
      const { error } = await supabase
        .from('clients')
        .update({ name, phone })
        .eq('id', id)

      if (error) throw error

      toast('Cliente actualizado con éxito.', 'success')
      await fetchClients()
    } catch (err: unknown) {
      console.error('Error updating client:', err)
      const msg = err instanceof Error ? err.message : 'Error al actualizar el cliente.'
      toast(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Delete Client
  const handleDeleteClient = async () => {
    if (!selectedClient) return

    // Optimistic: close modal immediately, remove from list
    const id = selectedClient.id
    const name = selectedClient.name
    setIsDeleteOpen(false)
    setSelectedClient(null)
    setClients(prev => prev.filter(c => c.id !== id))
    setSubmitting(true)

    try {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', id)

      if (error) throw error

      toast(`Cliente "${name}" eliminado.`, 'success')
    } catch (err: unknown) {
      console.error('Error deleting client:', err)
      const msg = err instanceof Error ? err.message : 'Error al eliminar el cliente.'
      toast(msg, 'error')
      await fetchClients() // restore on error
    } finally {
      setSubmitting(false)
    }
  }

  // Open Edit Dialog
  const openEdit = (client: Client) => {
    setSelectedClient(client)
    setClientName(client.name || '')
    setClientPhone(client.phone || '')
    setErrorMsg(null)
    setIsEditOpen(true)
  }

  // Open Delete Dialog
  const openDelete = (client: Client) => {
    setSelectedClient(client)
    setErrorMsg(null)
    setIsDeleteOpen(true)
  }

  // Filter clients list
  const filteredClients = clients.filter((client) => {
    const name = client.name || ''
    const phone = client.phone || ''
    const searchLower = searchTerm.toLowerCase()
    return name.toLowerCase().includes(searchLower) || phone.toLowerCase().includes(searchLower)
  })

  // Format date
  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleDateString('es-CL', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    } catch {
      return 'N/A'
    }
  }

  return (
    <>
    <Toaster toasts={toasts} dismiss={dismiss} />
    <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl overflow-hidden animate-fade-in">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0 pb-4 border-b border-zinc-100 dark:border-zinc-800/80">
        <div>
          <CardTitle className="text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <Contact className="h-5 w-5 text-indigo-500" />
            Directorio de Clientes
          </CardTitle>
          <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
            Administra los contactos de los clientes que han comprado en este local.
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search bar */}
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <Input
              placeholder="Buscar cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 h-8 bg-zinc-50/50 border-zinc-200 focus-visible:ring-zinc-400 dark:bg-zinc-950/30 dark:border-zinc-850 rounded-lg text-xs"
            />
          </div>

          {/* Add Client Dialog Trigger */}
          <Button
            onClick={() => {
              setClientName('')
              setClientPhone('')
              setErrorMsg(null)
              setIsAddOpen(true)
            }}
            size="sm"
            className="h-8 gap-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold"
          >
            <UserPlus className="h-4 w-4" />
            Registrar Cliente
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-400">
            No se encontraron clientes en el directorio.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-zinc-50/75 dark:bg-zinc-950/30 border-b border-zinc-100 dark:border-zinc-800/80">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="py-2.5 pl-6 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Cliente
                  </TableHead>
                  <TableHead className="py-2.5 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Teléfono Celular
                  </TableHead>
                  <TableHead className="py-2.5 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Fecha Registro
                  </TableHead>
                  <TableHead className="py-2.5 text-right pr-6 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {filteredClients.map((client) => (
                  <TableRow key={client.id} className="hover:bg-zinc-50/30 dark:hover:bg-zinc-800/20">
                    <TableCell className="py-3 pl-6 font-semibold text-zinc-850 dark:text-zinc-150">
                      {client.name || 'Sin nombre'}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-zinc-500 dark:text-zinc-400">
                      {client.phone ? `+${client.phone}` : 'No registrado'}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-zinc-400">
                      {formatDate(client.created_at)}
                    </TableCell>
                    <TableCell className="py-3 text-right pr-6 text-xs">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(client)}
                          className="h-7 w-7 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDelete(client)}
                          className="h-7 w-7 text-zinc-500 hover:text-red-650 hover:bg-red-50 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:bg-red-950/20 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* 1. Modal: Add Client */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-850 p-6 rounded-xl shadow-lg">
          <DialogHeader className="space-y-1.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              Registrar Nuevo Cliente
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Ingresa los datos para registrar este cliente en tu local.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddClient} className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="add-name" className="text-xs font-semibold text-zinc-650 dark:text-zinc-300">
                Nombre Completo
              </Label>
              <Input
                id="add-name"
                placeholder="Ej. Juan Pérez"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
                className="h-9 border-zinc-200 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-phone" className="text-xs font-semibold text-zinc-655 dark:text-zinc-300">
                Número Telefónico (Opcional)
              </Label>
              <div className="relative">
                <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
                <Input
                  id="add-phone"
                  placeholder="Ej. 56912345678"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value.replace(/\D/g, ''))}
                  className="pl-9 h-9 border-zinc-200 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 p-3 text-xs text-red-650 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-lg font-medium">
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
                Crear Cliente
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 2. Modal: Edit Client */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-850 p-6 rounded-xl shadow-lg">
          <DialogHeader className="space-y-1.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              Editar Cliente
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Modifica los detalles del contacto del cliente.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditClient} className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name" className="text-xs font-semibold text-zinc-650 dark:text-zinc-300">
                Nombre Completo
              </Label>
              <Input
                id="edit-name"
                placeholder="Ej. Juan Pérez"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
                className="h-9 border-zinc-200 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-phone" className="text-xs font-semibold text-zinc-655 dark:text-zinc-300">
                Número Telefónico (Opcional)
              </Label>
              <div className="relative">
                <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
                <Input
                  id="edit-phone"
                  placeholder="Ej. 56912345678"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value.replace(/\D/g, ''))}
                  className="pl-9 h-9 border-zinc-200 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/20 text-sm"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="submit"
                className="h-9 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold w-full sm:w-auto"
              >
                Actualizar Cliente
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 3. Modal: Delete Confirmation */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-850 p-6 rounded-xl shadow-lg">
          <DialogHeader className="space-y-1.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <DialogTitle className="text-base font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              ¿Confirmas eliminar este cliente?
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Esta acción es permanente y no se puede deshacer. Se eliminarán los datos de contacto del cliente <strong>{selectedClient?.name}</strong>.
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
              onClick={handleDeleteClient}
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
