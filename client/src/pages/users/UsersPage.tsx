import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
import { formatDate } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { PageSpinner, Spinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { Plus, ShieldAlert, UserCheck, UserX, Edit2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '../../store/authStore'
import type { User } from '../../types'

// ─── Constantes ──────────────────────────────────────────────────────────────

const ROLES: Record<string, { label: string; color: string }> = {
  ADMIN:       { label: 'Administrateur', color: 'badge-red' },
  MANAGER:     { label: 'Manager',        color: 'badge-purple' },
  COMMERCIAL:  { label: 'Commercial',     color: 'badge-blue' },
  TECHNICIEN:  { label: 'Technicien',     color: 'badge-orange' },
}

// ─── Schémas ─────────────────────────────────────────────────────────────────

const createUserSchema = z.object({
  email:     z.string().email('Email invalide'),
  password:  z.string().min(6, 'Mot de passe minimum 6 caractères'),
  firstName: z.string().min(1, 'Prénom requis'),
  lastName:  z.string().min(1, 'Nom requis'),
  phone:     z.string().optional(),
  role:      z.string().min(1, 'Rôle requis'),
})
type CreateUserForm = z.infer<typeof createUserSchema>

const editUserSchema = z.object({
  email:     z.string().email('Email invalide'),
  firstName: z.string().min(1, 'Prénom requis'),
  lastName:  z.string().min(1, 'Nom requis'),
  phone:     z.string().optional(),
  role:      z.string().min(1, 'Rôle requis'),
})
type EditUserForm = z.infer<typeof editUserSchema>

// ─── Page principale ─────────────────────────────────────────────────────────

export function UsersPage() {
  const { user: currentUser } = useAuthStore()
  const qc = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)

  // Restriction ADMIN/MANAGER uniquement
  const canAccess = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER'

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => { const { data } = await api.get('/users'); return data.data },
    staleTime: 30_000,
    enabled: canAccess,
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/users/${id}`, { isActive }),
    onSuccess: (_, { isActive }) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success(isActive ? 'Utilisateur réactivé' : 'Utilisateur désactivé')
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const changeRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.put(`/users/${id}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Rôle mis à jour') },
    onError: () => toast.error('Erreur lors du changement de rôle'),
  })

  const handleToggleActive = (user: User) => {
    const action = user.isActive ? 'désactiver' : 'réactiver'
    if (window.confirm(`Voulez-vous ${action} ${user.firstName} ${user.lastName} ?`)) {
      toggleActiveMutation.mutate({ id: user.id, isActive: !user.isActive })
    }
  }

  // Accès refusé
  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-80 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-red-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Accès refusé</h2>
          <p className="text-slate-500 text-sm">Vous n'avez pas les permissions pour accéder à cette page.</p>
          <p className="text-slate-400 text-xs mt-1">Seuls les administrateurs et managers peuvent gérer les utilisateurs.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestion des utilisateurs</h1>
          <p className="page-subtitle">{users?.length || 0} utilisateurs</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> Inviter un utilisateur
        </button>
      </div>

      {/* Table */}
      {isLoading ? <PageSpinner /> : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Membre depuis</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users?.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400">Aucun utilisateur</td></tr>
              ) : users?.map(u => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar firstName={u.firstName} lastName={u.lastName} size="sm" />
                      <div>
                        <p className="font-medium text-slate-900">{u.firstName} {u.lastName}</p>
                        {u.phone && <p className="text-xs text-slate-400">{u.phone}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="text-slate-600 text-sm">{u.email}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Badge variant={ROLES[u.role]?.color || 'badge-gray'}>
                        {ROLES[u.role]?.label || u.role}
                      </Badge>
                      {/* Changement rapide de rôle — ADMIN seulement */}
                      {currentUser?.role === 'ADMIN' && u.id !== currentUser?.id && (
                        <select
                          className="text-xs border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-600 bg-white cursor-pointer hover:border-slate-300"
                          value={u.role}
                          onChange={e => {
                            if (window.confirm(`Changer le rôle de ${u.firstName} en ${ROLES[e.target.value]?.label} ?`)) {
                              changeRoleMutation.mutate({ id: u.id, role: e.target.value })
                            }
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      )}
                    </div>
                  </td>
                  <td>
                    {u.isActive ? (
                      <Badge variant="badge-green">Actif</Badge>
                    ) : (
                      <Badge variant="badge-gray">Inactif</Badge>
                    )}
                  </td>
                  <td className="text-slate-400 text-xs">{formatDate(u.createdAt)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        className="btn-ghost btn-sm p-1.5 rounded-lg"
                        onClick={() => setEditUser(u)}
                        title="Modifier"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {u.id !== currentUser?.id && (
                        <button
                          className={`btn-ghost btn-sm p-1.5 rounded-lg ${u.isActive ? 'text-red-400 hover:text-red-600' : 'text-emerald-500 hover:text-emerald-700'}`}
                          onClick={() => handleToggleActive(u)}
                          title={u.isActive ? 'Désactiver' : 'Réactiver'}
                        >
                          {u.isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal création */}
      <CreateUserModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['users'] }); setShowCreate(false) }}
      />

      {/* Modal édition */}
      {editUser && (
        <EditUserModal
          open={!!editUser}
          user={editUser}
          onClose={() => setEditUser(null)}
          onSuccess={() => { qc.invalidateQueries({ queryKey: ['users'] }); setEditUser(null) }}
        />
      )}
    </div>
  )
}

// ─── Modal Créer utilisateur ──────────────────────────────────────────────────

interface CreateUserModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

function CreateUserModal({ open, onClose, onSuccess }: CreateUserModalProps) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { role: 'TECHNICIEN' },
  })

  useEffect(() => { if (open) reset({ role: 'TECHNICIEN' }) }, [open, reset])

  const mutation = useMutation({
    mutationFn: (values: CreateUserForm) => api.post('/users', values),
    onSuccess: () => { toast.success('Utilisateur créé'); onSuccess() },
    onError: () => toast.error('Erreur lors de la création'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Inviter un utilisateur">
      <form onSubmit={handleSubmit(v => mutation.mutate(v))} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Prénom *</label>
            <input {...register('firstName')} className={`input ${errors.firstName ? 'input-error' : ''}`} />
            {errors.firstName && <p className="form-error">{errors.firstName.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Nom *</label>
            <input {...register('lastName')} className={`input ${errors.lastName ? 'input-error' : ''}`} />
            {errors.lastName && <p className="form-error">{errors.lastName.message}</p>}
          </div>
        </div>
        <div className="form-group">
          <label className="label">Email *</label>
          <input {...register('email')} type="email" className={`input ${errors.email ? 'input-error' : ''}`} />
          {errors.email && <p className="form-error">{errors.email.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Téléphone</label>
          <input {...register('phone')} className="input" />
        </div>
        <div className="form-group">
          <label className="label">Mot de passe temporaire *</label>
          <input {...register('password')} type="password" className={`input ${errors.password ? 'input-error' : ''}`} />
          {errors.password && <p className="form-error">{errors.password.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Rôle *</label>
          <select {...register('role')} className="input">
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="w-4 h-4" /> : null}
            Créer l'utilisateur
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Modal Modifier utilisateur ───────────────────────────────────────────────

interface EditUserModalProps {
  open: boolean
  user: User
  onClose: () => void
  onSuccess: () => void
}

function EditUserModal({ open, user, onClose, onSuccess }: EditUserModalProps) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      email:     user.email,
      firstName: user.firstName,
      lastName:  user.lastName,
      phone:     user.phone || '',
      role:      user.role,
    },
  })

  useEffect(() => {
    if (open) reset({
      email:     user.email,
      firstName: user.firstName,
      lastName:  user.lastName,
      phone:     user.phone || '',
      role:      user.role,
    })
  }, [open, user, reset])

  const mutation = useMutation({
    mutationFn: (values: EditUserForm) => api.put(`/users/${user.id}`, values),
    onSuccess: () => { toast.success('Utilisateur mis à jour'); onSuccess() },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Modifier l'utilisateur">
      <form onSubmit={handleSubmit(v => mutation.mutate(v))} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Prénom *</label>
            <input {...register('firstName')} className={`input ${errors.firstName ? 'input-error' : ''}`} />
            {errors.firstName && <p className="form-error">{errors.firstName.message}</p>}
          </div>
          <div className="form-group">
            <label className="label">Nom *</label>
            <input {...register('lastName')} className={`input ${errors.lastName ? 'input-error' : ''}`} />
            {errors.lastName && <p className="form-error">{errors.lastName.message}</p>}
          </div>
        </div>
        <div className="form-group">
          <label className="label">Email *</label>
          <input {...register('email')} type="email" className={`input ${errors.email ? 'input-error' : ''}`} />
          {errors.email && <p className="form-error">{errors.email.message}</p>}
        </div>
        <div className="form-group">
          <label className="label">Téléphone</label>
          <input {...register('phone')} className="input" />
        </div>
        <div className="form-group">
          <label className="label">Rôle *</label>
          <select {...register('role')} className="input">
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="w-4 h-4" /> : null}
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  )
}
