'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Building2,
  Plus,
  Pencil,
  Power,
  PowerOff,
  Loader2,
  ShieldAlert,
} from 'lucide-react'
import { useToast, Toaster } from '@/components/ui/toast'

interface Branch {
  id: string
  name: string
  is_active: boolean
  created_at: string
}

interface BranchManagerProps {
  storeId: string | null
  onBranchesChange?: () => void
}

export function BranchManager({ storeId, onBranchesChange = () => {} }: BranchManagerProps) {
  const supabase = createClient()

  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)

  // Create / rename modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Deactivate/reactivate confirmation state
  const [toggleTarget, setToggleTarget] = useState<Branch | null>(null)
  const [toggling, setToggling] = useState(false)

  const { toasts, toast, dismiss } = useToast()

  const loadBranches = useCallback(async () => {
    if (!storeId) return
    try {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, is_active, created_at')
        .order('name', { ascending: true })
      if (error) throw error
      setBranches((data as Branch[]) || [])
    } catch (err: unknown) {
      console.error('Error loading branches:', err)
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
          .from('branches')
          .select('id, name, is_active, created_at')
          .order('name', { ascending: true })
        if (error) throw error
        if (!ignore) setBranches((data as Branch[]) || [])
      } catch (err: unknown) {
        console.error('Error loading branches:', err)
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    run()
    return () => { ignore = true }
  }, [storeId, supabase])

  const activeCount = branches.filter(b => b.is_active).length

  const openCreateModal = () => {
    setEditingBranch(null)
    setNameInput('')
    setErrorMsg(null)
    setIsModalOpen(true)
  }

  const openEditModal = (branch: Branch) => {
    setEditingBranch(branch)
    setNameInput(branch.name)
    setErrorMsg(null)
    setIsModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId) return

    const name = nameInput.trim()
    if (!name) { setErrorMsg('El nombre de la sucursal no puede estar vacío.'); return }

    const isEditing = !!editingBranch
    const editingId = editingBranch?.id
    setIsModalOpen(false)
    setErrorMsg(null)
    setSaving(true)

    try {
      if (isEditing && editingId) {
        const { error } = await supabase
          .from('branches')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('id', editingId)
        if (error) throw error
        toast('Sucursal renombrada.', 'success')
      } else {
        const { error } = await supabase
          .from('branches')
          .insert({ store_id: storeId, name })
        if (error) throw error
        toast('Sucursal creada.', 'success')
      }
      await loadBranches()
      onBranchesChange()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar la sucursal.'
      toast(msg, 'error')
      await loadBranches()
    } finally {
      setSaving(false)
    }
  }

  const confirmToggle = (branch: Branch) => {
    // Client-side courtesy guard: refuse to deactivate the last active branch.
    if (branch.is_active && activeCount <= 1) {
      toast('No puedes desactivar la única sucursal activa.', 'error')
      return
    }
    setToggleTarget(branch)
  }

  const handleToggle = async () => {
    if (!toggleTarget) return
    const target = toggleTarget
    const nextActive = !target.is_active
    setToggleTarget(null)
    setToggling(true)
    try {
      const { error } = await supabase
        .from('branches')
        .update({ is_active: nextActive, updated_at: new Date().toISOString() })
        .eq('id', target.id)
      if (error) throw error
      toast(nextActive ? 'Sucursal reactivada.' : 'Sucursal desactivada.', 'success')
      await loadBranches()
      onBranchesChange()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar la sucursal.'
      toast(msg, 'error')
      await loadBranches()
    } finally {
      setToggling(false)
    }
  }

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

  return (
    <>
      <Toaster toasts={toasts} dismiss={dismiss} />

      {/* Deactivate/Reactivate Confirm Dialog */}
      <Dialog open={!!toggleTarget} onOpenChange={(open) => { if (!open) setToggleTarget(null) }}>
        <DialogContent className="sm:max-w-sm bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              {toggleTarget?.is_active ? '¿Desactivar esta sucursal?' : '¿Reactivar esta sucursal?'}
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
              {toggleTarget?.is_active
                ? 'La sucursal dejará de aparecer en los selectores y nuevas asignaciones, pero los empleados ya asignados mantienen su acceso.'
                : 'La sucursal volverá a estar disponible en los selectores y nuevas asignaciones.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setToggleTarget(null)}
              disabled={toggling}
              className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleToggle}
              disabled={toggling}
              className={`h-9 px-4 rounded-xl text-white text-xs font-semibold cursor-pointer flex items-center gap-1.5 ${
                toggleTarget?.is_active ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {toggling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : toggleTarget?.is_active ? (
                <PowerOff className="h-3.5 w-3.5" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
              {toggleTarget?.is_active ? 'Desactivar' : 'Reactivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Rename Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-2xl shadow-xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-zinc-400" />
              {editingBranch ? 'Renombrar Sucursal' : 'Nueva Sucursal'}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              {editingBranch
                ? 'Cambiá el nombre de esta sucursal.'
                : 'Creá una nueva sucursal para esta tienda.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave}>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="branch-name" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  Nombre de la Sucursal
                </Label>
                <Input
                  id="branch-name"
                  placeholder="Ej: Sucursal Centro"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  disabled={saving}
                  className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm"
                />
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 p-3 text-xs text-red-600 bg-red-50 border border-red-200/50 dark:text-red-400 dark:bg-red-950/20 dark:border-red-900/30 rounded-xl font-medium">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            <DialogFooter className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsModalOpen(false)}
                className="h-9 px-4 rounded-xl border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-9 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex-1 sm:flex-none"
              >
                {editingBranch ? 'Guardar Cambios' : 'Crear Sucursal'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Main View */}
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-zinc-400" />
              Sucursales
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Creá, renombrá y desactivá las sucursales de tu tienda.
            </p>
          </div>
          <Button
            onClick={openCreateModal}
            className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-950 cursor-pointer text-xs font-semibold flex items-center gap-1.5 shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nueva Sucursal
          </Button>
        </div>

        {/* Table / Empty state */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 animate-pulse" />
            ))}
          </div>
        ) : branches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-4">
              <Building2 className="h-7 w-7 text-zinc-400" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Sin sucursales
            </h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs mb-5">
              Creá tu primera sucursal para poder asignar empleados y ventas.
            </p>
            <Button
              onClick={openCreateModal}
              variant="outline"
              className="h-9 px-4 rounded-xl border-zinc-200 dark:border-zinc-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Crear primera sucursal
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
            {/* Table Header */}
            <div className="grid grid-cols-[1fr_110px_130px_90px] gap-3 px-5 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Sucursal</span>
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-center">Estado</span>
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-right">Creada</span>
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider text-center">Acciones</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {branches.map((branch) => (
                <div
                  key={branch.id}
                  className="grid grid-cols-[1fr_110px_130px_90px] gap-3 px-5 py-4 items-center hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors duration-150 group"
                >
                  {/* Name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 shrink-0">
                      <Building2 className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <span className={`text-sm font-semibold truncate ${branch.is_active ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-500'}`}>
                      {branch.name}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="text-center">
                    {branch.is_active ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/50 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/30">
                        Activa
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-100 text-zinc-500 border border-zinc-200 dark:bg-zinc-850 dark:text-zinc-400 dark:border-zinc-800">
                        Inactiva
                      </span>
                    )}
                  </div>

                  {/* Created */}
                  <div className="text-right">
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      {formatDate(branch.created_at)}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      onClick={() => openEditModal(branch)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer"
                      title="Renombrar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => confirmToggle(branch)}
                      className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                        branch.is_active
                          ? 'text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/30'
                          : 'text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-950/30'
                      }`}
                      title={branch.is_active ? 'Desactivar' : 'Reactivar'}
                    >
                      {branch.is_active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
