import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { User, Building2, Users, Lock, Save, Eye, EyeOff, ExternalLink, Settings2, Play, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import api from '../../lib/api'
import { cn } from '../../lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileForm {
  firstName: string
  lastName: string
  email: string
  phone: string
}

interface PasswordForm {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

interface CompanySettings {
  name: string
  logoUrl: string
  address: string
  contactEmail: string
  phone: string
  siret: string
  vatNumber: string
}

// ─── Tab components ───────────────────────────────────────────────────────────

function ProfileTab() {
  const { user, setUser } = useAuthStore()
  const [form, setForm] = useState<ProfileForm>({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
  })
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const mutation = useMutation({
    mutationFn: async (values: ProfileForm) => {
      const { data } = await api.put(`/users/${user!.id}`, values)
      return data.data
    },
    onSuccess: (updated) => {
      setUser({ ...user!, ...updated })
      setSuccessMsg('Profil mis à jour avec succès.')
      setErrorMsg('')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Erreur lors de la mise à jour.'
      setErrorMsg(msg)
      setSuccessMsg('')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    mutation.mutate(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900">Informations personnelles</h2>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">Prénom</label>
          <input
            className="form-input"
            value={form.firstName}
            onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="form-label">Nom</label>
          <input
            className="form-input"
            value={form.lastName}
            onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
            required
          />
        </div>
      </div>

      <div>
        <label className="form-label">Email</label>
        <input
          className="form-input"
          type="email"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          required
        />
      </div>

      <div>
        <label className="form-label">Téléphone</label>
        <input
          className="form-input"
          type="tel"
          value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
        />
      </div>

      {successMsg && <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{successMsg}</p>}
      {errorMsg && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errorMsg}</p>}

      <button type="submit" className="btn-primary" disabled={mutation.isPending}>
        <Save className="w-4 h-4" />
        {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  )
}

function PasswordTab() {
  const { user } = useAuthStore()
  const [form, setForm] = useState<PasswordForm>({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const mutation = useMutation({
    mutationFn: async (values: PasswordForm) => {
      const { data } = await api.patch(`/users/${user!.id}/password`, {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })
      return data
    },
    onSuccess: () => {
      setSuccessMsg('Mot de passe modifié avec succès.')
      setErrorMsg('')
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Erreur lors du changement de mot de passe.'
      setErrorMsg(msg)
      setSuccessMsg('')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    if (form.newPassword !== form.confirmPassword) {
      setErrorMsg('Les nouveaux mots de passe ne correspondent pas.')
      return
    }
    if (form.newPassword.length < 8) {
      setErrorMsg('Le nouveau mot de passe doit contenir au moins 8 caractères.')
      return
    }
    mutation.mutate(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900">Changer le mot de passe</h2>

      <div>
        <label className="form-label">Mot de passe actuel</label>
        <div className="relative">
          <input
            className="form-input pr-10"
            type={showCurrent ? 'text' : 'password'}
            value={form.currentPassword}
            onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
            required
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            onClick={() => setShowCurrent(v => !v)}
          >
            {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div>
        <label className="form-label">Nouveau mot de passe</label>
        <div className="relative">
          <input
            className="form-input pr-10"
            type={showNew ? 'text' : 'password'}
            value={form.newPassword}
            onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
            required
            minLength={8}
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            onClick={() => setShowNew(v => !v)}
          >
            {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">Minimum 8 caractères.</p>
      </div>

      <div>
        <label className="form-label">Confirmer le nouveau mot de passe</label>
        <input
          className="form-input"
          type="password"
          value={form.confirmPassword}
          onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
          required
        />
      </div>

      {successMsg && <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{successMsg}</p>}
      {errorMsg && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errorMsg}</p>}

      <button type="submit" className="btn-primary" disabled={mutation.isPending}>
        <Lock className="w-4 h-4" />
        {mutation.isPending ? 'Modification…' : 'Modifier le mot de passe'}
      </button>
    </form>
  )
}

function CompanyTab() {
  const qc = useQueryClient()

  const { data: settings = [], isLoading } = useQuery<{ key: string; value: string }[]>({
    queryKey: ['admin-settings'],
    queryFn: async () => { const { data } = await api.get('/settings'); return data.data ?? [] },
  })

  const getValue = (key: string) => settings.find(s => s.key === key)?.value ?? ''

  const [form, setForm] = useState<CompanySettings>({
    name: '', logoUrl: '', address: '', contactEmail: '', phone: '', siret: '', vatNumber: '',
  })
  useEffect(() => {
    if (!isLoading && settings.length > 0) {
      setForm({
        name:         getValue('companyName'),
        logoUrl:      getValue('companyLogoUrl'),
        address:      getValue('companyAddress'),
        contactEmail: getValue('companyContactEmail'),
        phone:        getValue('companyPhone'),
        siret:        getValue('companySiret'),
        vatNumber:    getValue('companyVatNumber'),
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, settings])

  const updateMutation = useMutation({
    mutationFn: async (f: CompanySettings) => {
      const pairs: [string, string][] = [
        ['companyName', f.name],
        ['companyLogoUrl', f.logoUrl],
        ['companyAddress', f.address],
        ['companyContactEmail', f.contactEmail],
        ['companyPhone', f.phone],
        ['companySiret', f.siret],
        ['companyVatNumber', f.vatNumber],
      ]
      await Promise.all(pairs.map(([key, value]) => api.put(`/settings/${key}`, { value })))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-settings'] }),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateMutation.mutate(form)
  }

  if (isLoading) return <div className="py-8 text-center text-slate-400 text-sm">Chargement…</div>

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900">Paramètres de l'entreprise</h2>

      <div>
        <label className="form-label">Nom de l'entreprise</label>
        <input
          className="form-input"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">SIRET</label>
          <input
            className="form-input"
            value={form.siret}
            onChange={e => setForm(f => ({ ...f, siret: e.target.value }))}
            placeholder="123 456 789 00012"
          />
        </div>
        <div>
          <label className="form-label">N° TVA</label>
          <input
            className="form-input"
            value={form.vatNumber}
            onChange={e => setForm(f => ({ ...f, vatNumber: e.target.value }))}
            placeholder="FR 12 345678900"
          />
        </div>
      </div>

      <div>
        <label className="form-label">URL du logo</label>
        <input
          className="form-input"
          type="url"
          placeholder="https://…"
          value={form.logoUrl}
          onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))}
        />
        {form.logoUrl && (
          <img src={form.logoUrl} alt="Logo preview" className="mt-2 h-10 object-contain rounded border border-slate-200 p-1" />
        )}
      </div>

      <div>
        <label className="form-label">Adresse</label>
        <textarea
          className="form-input resize-none"
          rows={2}
          value={form.address}
          onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">Email de contact</label>
          <input
            className="form-input"
            type="email"
            value={form.contactEmail}
            onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Téléphone</label>
          <input
            className="form-input"
            type="tel"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          />
        </div>
      </div>

      {updateMutation.isSuccess && (
        <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Paramètres enregistrés.</p>
      )}
      {updateMutation.isError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Erreur lors de l'enregistrement.</p>
      )}

      <button type="submit" className="btn-primary" disabled={updateMutation.isPending}>
        <Save className="w-4 h-4" />
        {updateMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  )
}

function UsersTab() {
  const navigate = useNavigate()
  return (
    <div className="space-y-4 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900">Gestion des utilisateurs</h2>
      <p className="text-sm text-slate-500">Créez, modifiez et désactivez les comptes utilisateurs de votre organisation.</p>
      <button
        type="button"
        className="btn-primary"
        onClick={() => navigate('/users')}
      >
        <ExternalLink className="w-4 h-4" />
        Gérer les utilisateurs
      </button>
    </div>
  )
}

interface SettingRow { key: string; value: string; label: string }

function SystemTab() {
  const qc = useQueryClient()
  const [runResult, setRunResult] = useState<{ expired: number; expiringSoon: number; reactivated: number } | null>(null)
  const [runError, setRunError] = useState('')

  const { data: settings = [], isLoading } = useQuery<SettingRow[]>({
    queryKey: ['admin-settings'],
    queryFn: async () => { const { data } = await api.get('/settings'); return data.data ?? [] },
  })

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.put(`/settings/${key}`, { value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-settings'] }),
  })

  const runMutation = useMutation({
    mutationFn: () => api.post('/settings/actions/run-contract-update'),
    onSuccess: (res) => { setRunResult(res.data.data); setRunError('') },
    onError: () => setRunError('Erreur lors de l\'exécution du job'),
  })

  const getValue = (key: string) => settings.find(s => s.key === key)?.value ?? ''
  const setValue = (key: string, value: string) => updateMutation.mutate({ key, value })

  if (isLoading) return <div className="py-8 text-center text-slate-400 text-sm">Chargement…</div>

  return (
    <div className="space-y-8 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900">Paramètres système</h2>

      {/* Scheduler */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Mise à jour automatique des statuts</h3>
            <p className="text-xs text-slate-500 mt-0.5">S'exécute chaque jour pour recalculer les statuts contrats.</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              className={cn(
                'relative w-10 h-5 rounded-full transition-colors cursor-pointer',
                getValue('schedulerEnabled') !== 'false' ? 'bg-primary-600' : 'bg-slate-200',
              )}
              onClick={() => setValue('schedulerEnabled', getValue('schedulerEnabled') === 'false' ? 'true' : 'false')}
            >
              <div className={cn(
                'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                getValue('schedulerEnabled') !== 'false' ? 'translate-x-5' : '',
              )} />
            </div>
            <span className="text-sm text-slate-600">
              {getValue('schedulerEnabled') !== 'false' ? 'Activé' : 'Désactivé'}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Heure d'exécution</label>
            <input
              type="time"
              className="form-input"
              value={getValue('schedulerTime') || '02:00'}
              onChange={e => setValue('schedulerTime', e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">Heure serveur (Europe/Paris)</p>
          </div>
        </div>
      </div>

      {/* Seuils d'alerte */}
      <div className="space-y-4 pt-4 border-t border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Seuils d'alerte</h3>
          <p className="text-xs text-slate-500 mt-0.5">En dessous de ces délais, les statuts passent automatiquement en alerte.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Contrats expirant dans (jours)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                className="form-input"
                value={getValue('contractExpiringSoonDays') || '60'}
                onChange={e => setValue('contractExpiringSoonDays', e.target.value)}
              />
              <span className="text-sm text-slate-400 flex-shrink-0">jours</span>
            </div>
          </div>
          <div>
            <label className="form-label">Licences expirant dans (jours)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                className="form-input"
                value={getValue('licenseExpiringSoonDays') || '30'}
                onChange={e => setValue('licenseExpiringSoonDays', e.target.value)}
              />
              <span className="text-sm text-slate-400 flex-shrink-0">jours</span>
            </div>
          </div>
        </div>
      </div>

      {/* Exécution manuelle */}
      <div className="pt-4 border-t border-slate-100 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Exécution manuelle</h3>
          <p className="text-xs text-slate-500 mt-0.5">Lance immédiatement le job de mise à jour des statuts contrats.</p>
        </div>
        <button
          className="btn-secondary flex items-center gap-2"
          onClick={() => { setRunResult(null); runMutation.mutate() }}
          disabled={runMutation.isPending}
        >
          {runMutation.isPending
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Exécution…</>
            : <><Play className="w-4 h-4" /> Lancer maintenant</>
          }
        </button>
        {runResult && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
            ✅ Job terminé — <strong>{runResult.expired}</strong> contrat(s) expiré(s),{' '}
            <strong>{runResult.expiringSoon}</strong> passé(s) en "expirant bientôt",{' '}
            <strong>{runResult.reactivated}</strong> réactivé(s)
          </div>
        )}
        {runError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{runError}</div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'password' | 'company' | 'users' | 'system'

interface TabConfig {
  id: Tab
  label: string
  icon: React.ReactNode
  adminOnly: boolean
}

const TABS: TabConfig[] = [
  { id: 'profile', label: 'Profil', icon: <User className="w-4 h-4" />, adminOnly: false },
  { id: 'password', label: 'Mot de passe', icon: <Lock className="w-4 h-4" />, adminOnly: false },
  { id: 'company', label: 'Entreprise', icon: <Building2 className="w-4 h-4" />, adminOnly: true },
  { id: 'users', label: 'Utilisateurs', icon: <Users className="w-4 h-4" />, adminOnly: true },
  { id: 'system', label: 'Système', icon: <Settings2 className="w-4 h-4" />, adminOnly: true },
]

export function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'ADMIN'
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin)

  // If current tab becomes invisible (role change), fallback to profile
  const currentTab = visibleTabs.find(t => t.id === activeTab) ? activeTab : 'profile'

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div>
        <h1 className="page-title">Paramètres</h1>
        <p className="page-subtitle">Gérez votre profil et les paramètres de l'application</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <nav className="w-52 flex-shrink-0">
          <ul className="space-y-1">
            {visibleTabs.map(tab => (
              <li key={tab.id}>
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    currentTab === tab.id
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  )}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.adminOnly && (
                    <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">
                      ADMIN
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {!isAdmin && (
            <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="text-xs text-slate-500">Les onglets <strong>Entreprise</strong> et <strong>Utilisateurs</strong> sont réservés aux administrateurs.</p>
            </div>
          )}
        </nav>

        {/* Content */}
        <div className="flex-1 card p-6">
          {currentTab === 'profile' && <ProfileTab />}
          {currentTab === 'password' && <PasswordTab />}
          {currentTab === 'company' && (isAdmin ? <CompanyTab /> : <AccessDenied />)}
          {currentTab === 'users' && (isAdmin ? <UsersTab /> : <AccessDenied />)}
          {currentTab === 'system' && (isAdmin ? <SystemTab /> : <AccessDenied />)}
        </div>
      </div>
    </div>
  )
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
        <Lock className="w-5 h-5 text-red-500" />
      </div>
      <h3 className="font-semibold text-slate-800">Accès refusé</h3>
      <p className="text-sm text-slate-500 max-w-xs">Vous n'avez pas les droits nécessaires pour accéder à cette section. Contactez un administrateur.</p>
    </div>
  )
}
