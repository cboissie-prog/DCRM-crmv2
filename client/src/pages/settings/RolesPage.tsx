import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Shield, Users, Plus, Trash2, Edit, Lock, AlertCircle,
} from 'lucide-react'
import api from '../../lib/api'
import {
  useRoles,
  useAllPermissions,
  useUpdateRolePermissions,
  useCreateRole,
  useDeleteRole,
  type RoleSummary,
  type RoleDetail,
} from '../../hooks/useRoles'
import { usePermission } from '../../hooks/usePermission'
import { CanDo } from '../../components/CanDo'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { Drawer } from '../../components/ui/Drawer'
import { PageSpinner, Spinner } from '../../components/ui/Spinner'
import { toast } from '../../components/ui/Toast'

// ─── Constantes ───────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  ADMIN:       'badge-red',
  MANAGER:     'badge-purple',
  COMMERCIAL:  'badge-blue',
  TECHNICIEN:  'badge-orange',
}

function getRoleBadge(name: string) {
  return ROLE_COLORS[name] ?? 'badge-gray'
}

// ─── Schémas Zod v4 ───────────────────────────────────────────────────────────

const createRoleSchema = z.object({
  name:  z.string().min(1, 'Nom requis'),
  label: z.string().min(1, 'Label requis'),
})
type CreateRoleForm = z.infer<typeof createRoleSchema>

// ─── Hook détail rôle ─────────────────────────────────────────────────────────

function useRoleDetail(id: string, enabled: boolean) {
  return useQuery<RoleDetail>({
    queryKey: ['roles', id],
    queryFn: async () => {
      const { data } = await api.get(`/roles/${id}`)
      return data.data
    },
    enabled: !!id && enabled,
    staleTime: 30_000,
  })
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function RolesPage() {
  const canAccess = usePermission('settings:roles')
  const { data: roles, isLoading, isError } = useRoles()
  const deleteMutation = useDeleteRole()

  const [permDrawerRoleId, setPermDrawerRoleId] = useState<string | null>(null)
  const [showCreate, setShowCreate]             = useState(false)

  const selectedRole = roles?.find(r => r.id === permDrawerRoleId) ?? null

  const handleDelete = (role: RoleSummary) => {
    if (!window.confirm(`Supprimer le rôle "${role.label}" ? Cette action est irréversible.`)) return
    deleteMutation.mutate(role.id, {
      onSuccess: () => toast.success('Rôle supprimé'),
      onError:   () => toast.error('Impossible de supprimer ce rôle'),
    })
  }

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-80 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Accès refusé</h2>
          <p className="text-slate-500 text-sm">Vous n'avez pas la permission d'accéder à cette page.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestion des rôles</h1>
          <p className="page-subtitle">
            {roles?.length ?? 0} rôle{(roles?.length ?? 0) > 1 ? 's' : ''}
          </p>
        </div>
        <CanDo permission="settings:roles">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Nouveau rôle
          </button>
        </CanDo>
      </div>

      {/* Contenu */}
      {isLoading ? (
        <PageSpinner />
      ) : isError ? (
        <div className="flex items-center gap-3 text-red-600 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">Impossible de charger les rôles.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Rôle</th>
                <th>Label</th>
                <th>Permissions</th>
                <th>Utilisateurs</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-400">
                    Aucun rôle trouvé
                  </td>
                </tr>
              ) : roles?.map(role => (
                <tr key={role.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <Badge variant={getRoleBadge(role.name)}>{role.name}</Badge>
                      {role.isSystem && (
                        <span className="text-xs text-slate-400 italic">système</span>
                      )}
                    </div>
                  </td>
                  <td className="text-slate-700 font-medium">{role.label}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                      {role.permissionsCount}
                    </span>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      {role.usersCount}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        className="btn-ghost btn-sm p-1.5 rounded-lg"
                        title="Modifier les permissions"
                        onClick={() => setPermDrawerRoleId(role.id)}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="btn-ghost btn-sm p-1.5 rounded-lg text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          role.isSystem
                            ? 'Rôle système, non supprimable'
                            : role.usersCount > 0
                            ? 'Des utilisateurs ont ce rôle'
                            : 'Supprimer'
                        }
                        disabled={role.isSystem || role.usersCount > 0}
                        onClick={() => handleDelete(role)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer permissions */}
      {selectedRole && (
        <PermissionsDrawer
          role={selectedRole}
          open={!!permDrawerRoleId}
          onClose={() => setPermDrawerRoleId(null)}
        />
      )}

      {/* Modal création */}
      <CreateRoleModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => setShowCreate(false)}
      />
    </div>
  )
}

// ─── Drawer édition permissions ───────────────────────────────────────────────

interface PermissionsDrawerProps {
  role: RoleSummary
  open: boolean
  onClose: () => void
}

function PermissionsDrawer({ role, open, onClose }: PermissionsDrawerProps) {
  const { data: allPermissions, isLoading: loadingPerms } = useAllPermissions()
  const { data: roleDetail, isLoading: loadingDetail }    = useRoleDetail(role.id, open)
  const updatePermsMutation = useUpdateRolePermissions()

  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [initialized, setInitialized] = useState(false)

  // Initialise la sélection depuis le détail du rôle (une seule fois par ouverture)
  useEffect(() => {
    if (roleDetail && !initialized) {
      setSelected(new Set(roleDetail.permissions.map(p => p.id)))
      setInitialized(true)
    }
  }, [roleDetail, initialized])

  // Reset lors de la fermeture
  useEffect(() => {
    if (!open) setInitialized(false)
  }, [open])

  const togglePermission = (permId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(permId)) next.delete(permId)
      else next.add(permId)
      return next
    })
  }

  const toggleCategory = (perms: { id: string }[]) => {
    const allSelected = perms.every(p => selected.has(p.id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) perms.forEach(p => next.delete(p.id))
      else perms.forEach(p => next.add(p.id))
      return next
    })
  }

  const handleSave = () => {
    updatePermsMutation.mutate(
      { id: role.id, permissionIds: Array.from(selected) },
      {
        onSuccess: () => {
          toast.success('Permissions mises à jour')
          onClose()
        },
        onError: () => toast.error('Erreur lors de la mise à jour des permissions'),
      }
    )
  }

  const isLoading = loadingPerms || loadingDetail || !initialized

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Permissions — ${role.label}`}
      width="w-[520px]"
    >
      <div className="flex flex-col h-full">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Spinner className="w-8 h-8" />
          </div>
        ) : (
          <>
            {/* Avertissement */}
            <div className="mx-4 sm:mx-5 mt-4 mb-2 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-700">
                Tous les utilisateurs de ce rôle devront se reconnecter après sauvegarde.
              </p>
            </div>

            {/* Liste des catégories */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-5">
              {allPermissions && Object.entries(allPermissions).map(([category, perms]) => {
                const allCatSelected  = perms.every(p => selected.has(p.id))
                const someCatSelected = perms.some(p => selected.has(p.id))

                return (
                  <div key={category}>
                    {/* En-tête catégorie */}
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        id={`cat-${category}`}
                        checked={allCatSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someCatSelected && !allCatSelected
                        }}
                        onChange={() => toggleCategory(perms)}
                        className="w-4 h-4 rounded accent-primary-600 cursor-pointer"
                      />
                      <label
                        htmlFor={`cat-${category}`}
                        className="text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none"
                      >
                        {category}
                      </label>
                      <span className="text-xs text-slate-400">
                        ({perms.filter(p => selected.has(p.id)).length}/{perms.length})
                      </span>
                    </div>

                    {/* Permissions */}
                    <div className="grid grid-cols-1 gap-1 pl-2">
                      {perms.map(perm => (
                        <label
                          key={perm.id}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer group"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(perm.id)}
                            onChange={() => togglePermission(perm.id)}
                            className="w-4 h-4 rounded accent-primary-600 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-slate-700 group-hover:text-slate-900">
                              {perm.label}
                            </span>
                            <span className="ml-2 text-xs text-slate-400 font-mono">
                              {perm.key}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-4 border-t border-slate-100 flex-shrink-0">
              <span className="text-sm text-slate-500">
                {selected.size} permission{selected.size !== 1 ? 's' : ''}
              </span>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={onClose}>
                  Annuler
                </button>
                <button
                  className="btn-primary"
                  onClick={handleSave}
                  disabled={updatePermsMutation.isPending}
                >
                  {updatePermsMutation.isPending ? <Spinner className="w-4 h-4" /> : null}
                  Sauvegarder
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}

// ─── Modal création de rôle ───────────────────────────────────────────────────

interface CreateRoleModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

function CreateRoleModal({ open, onClose, onSuccess }: CreateRoleModalProps) {
  const createMutation = useCreateRole()

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateRoleForm>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', label: '' },
  })

  const nameValue = watch('name')

  useEffect(() => {
    if (open) reset({ name: '', label: '' })
  }, [open, reset])

  // Forcer uppercase sur le champ nom
  useEffect(() => {
    if (nameValue) {
      const upper = nameValue.toUpperCase().replace(/\s/g, '_')
      if (upper !== nameValue) setValue('name', upper, { shouldValidate: false })
    }
  }, [nameValue, setValue])

  const onSubmit = (values: CreateRoleForm) => {
    createMutation.mutate(
      { ...values, name: values.name.toUpperCase() },
      {
        onSuccess: () => {
          toast.success('Rôle créé')
          onSuccess()
          reset()
        },
        onError: () => toast.error('Erreur lors de la création du rôle'),
      }
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau rôle">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="form-group">
          <label className="label">Nom technique *</label>
          <input
            {...register('name')}
            className={`input uppercase ${errors.name ? 'input-error' : ''}`}
            placeholder="SUPERVISEUR"
            autoComplete="off"
          />
          {errors.name && <p className="form-error">{errors.name.message}</p>}
          <p className="text-xs text-slate-400 mt-1">
            Identifiant unique en majuscules, espaces convertis en underscores.
          </p>
        </div>

        <div className="form-group">
          <label className="label">Label affiché *</label>
          <input
            {...register('label')}
            className={`input ${errors.label ? 'input-error' : ''}`}
            placeholder="Superviseur"
            autoComplete="off"
          />
          {errors.label && <p className="form-error">{errors.label.message}</p>}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting || createMutation.isPending}
          >
            {(isSubmitting || createMutation.isPending) ? <Spinner className="w-4 h-4" /> : null}
            Créer le rôle
          </button>
        </div>
      </form>
    </Modal>
  )
}
