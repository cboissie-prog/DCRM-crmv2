import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { User, Building2, Users, Lock, Save, Eye, EyeOff, ExternalLink, Settings2, Play, RefreshCw, Key, Plus, Trash2, Copy, CheckCheck, AlertTriangle } from 'lucide-react'
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Prénom</label>
          <input
            className="input"
            value={form.firstName}
            onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="label">Nom</label>
          <input
            className="input"
            value={form.lastName}
            onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
            required
          />
        </div>
      </div>

      <div>
        <label className="label">Email</label>
        <input
          className="input"
          type="email"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          required
        />
      </div>

      <div>
        <label className="label">Téléphone</label>
        <input
          className="input"
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

// ─── API Keys tab ─────────────────────────────────────────────────────────────

interface ApiKey {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  expiresAt: string | null
  isActive: boolean
  createdAt: string
}

function ApiKeysTab() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyExpiry, setNewKeyExpiry] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['apikeys'],
    queryFn: async () => { const { data } = await api.get('/apikeys'); return data.data ?? [] },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/apikeys', {
        name: newKeyName.trim(),
        expiresAt: newKeyExpiry || undefined,
      })
      return data.data
    },
    onSuccess: (data) => {
      setCreatedKey(data.key)
      setNewKeyName('')
      setNewKeyExpiry('')
      setShowCreate(false)
      qc.invalidateQueries({ queryKey: ['apikeys'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/apikeys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apikeys'] }),
  })

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR') : '—'
  const isExpired = (d: string | null) => d ? new Date(d) < new Date() : false

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Clés API</h2>
          <p className="text-sm text-slate-500 mt-0.5">Pour connecter des outils externes (Zapier, n8n, scripts…). Chaque clé hérite de vos permissions.</p>
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="btn-primary btn-sm flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Nouvelle clé
        </button>
      </div>

      {/* Formulaire création */}
      {showCreate && (
        <div className="card p-4 space-y-3 border-primary-200 bg-primary-50/30">
          <h3 className="text-sm font-semibold text-slate-800">Créer une clé API</h3>
          <div>
            <label className="label">Nom de la clé</label>
            <input
              className="input"
              placeholder="ex: Intégration n8n, Zapier CRM…"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Date d'expiration <span className="text-slate-400 font-normal">(optionnel)</span></label>
            <input
              className="input"
              type="date"
              value={newKeyExpiry}
              onChange={e => setNewKeyExpiry(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              className="btn-primary btn-sm"
              disabled={!newKeyName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Génération…' : 'Générer'}
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => { setShowCreate(false); setNewKeyName(''); setNewKeyExpiry('') }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Clé générée — affichée une seule fois */}
      {createdKey && (
        <div className="card p-4 border-emerald-200 bg-emerald-50 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700">
            <Key className="w-4 h-4" />
            <p className="text-sm font-semibold">Clé générée — copiez-la maintenant, elle ne sera plus visible</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-emerald-200 rounded-lg px-3 py-2 font-mono break-all text-slate-800">
              {createdKey}
            </code>
            <button
              onClick={() => copyToClipboard(createdKey)}
              className="btn-secondary btn-sm flex-shrink-0 flex items-center gap-1"
            >
              {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          <p className="text-xs text-emerald-600">
            À utiliser dans le header HTTP : <code className="bg-white px-1 py-0.5 rounded border border-emerald-200">X-API-Key: {createdKey.slice(0, 20)}…</code>
          </p>
          <button
            className="text-xs text-emerald-700 underline"
            onClick={() => setCreatedKey(null)}
          >
            J'ai copié la clé, fermer
          </button>
        </div>
      )}

      {/* Liste des clés */}
      {isLoading ? (
        <div className="py-6 text-center text-sm text-slate-400">Chargement…</div>
      ) : keys.length === 0 ? (
        <div className="py-10 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          <Key className="w-8 h-8 mx-auto mb-2 text-slate-200" />
          Aucune clé API — créez-en une pour connecter vos outils externes.
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map(key => (
            <div key={key.id} className={cn('card p-4 flex items-center gap-3', isExpired(key.expiresAt) && 'border-amber-200 bg-amber-50/30')}>
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Key className="w-4 h-4 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-900">{key.name}</p>
                  {isExpired(key.expiresAt) && (
                    <span className="badge badge-yellow text-[10px]">
                      <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />Expirée
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <code className="text-xs text-slate-400 font-mono">{key.prefix}…</code>
                  <span className="text-xs text-slate-400">Créée le {formatDate(key.createdAt)}</span>
                  {key.lastUsedAt && <span className="text-xs text-slate-400">Dernière utilisation : {formatDate(key.lastUsedAt)}</span>}
                  {key.expiresAt && <span className="text-xs text-slate-400">Expire le {formatDate(key.expiresAt)}</span>}
                </div>
              </div>
              <button
                onClick={() => { if (confirm(`Révoquer la clé "${key.name}" ?`)) deleteMutation.mutate(key.id) }}
                disabled={deleteMutation.isPending}
                className="btn-ghost p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0"
                title="Révoquer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Usage example */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Exemple d'utilisation</p>
        <code className="block text-xs text-slate-700 font-mono whitespace-pre-wrap break-all">
{`curl https://votre-domaine.com/api/contacts \\
  -H "X-API-Key: dcrm_votre_cle_api"`}
        </code>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'password' | 'apikeys' | 'company' | 'users' | 'system'

interface TabConfig {
  id: Tab
  label: string
  icon: React.ReactNode
  adminOnly: boolean
}

const TABS: TabConfig[] = [
  { id: 'profile',  label: 'Profil',         icon: <User className="w-4 h-4" />,     adminOnly: false },
  { id: 'password', label: 'Mot de passe',    icon: <Lock className="w-4 h-4" />,     adminOnly: false },
  { id: 'apikeys',  label: 'Clés API',        icon: <Key className="w-4 h-4" />,      adminOnly: false },
  { id: 'company',  label: 'Entreprise',      icon: <Building2 className="w-4 h-4" />, adminOnly: true },
  { id: 'users',    label: 'Utilisateurs',    icon: <Users className="w-4 h-4" />,    adminOnly: true },
  { id: 'system',   label: 'Système',         icon: <Settings2 className="w-4 h-4" />, adminOnly: true },
]

export function SettingsPage() {
  const { user, hasPermission } = useAuthStore()
  const isAdmin = user?.role === 'ADMIN'
  const canManageApiKeys = hasPermission('apikeys:manage')
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  const visibleTabs = TABS.filter(t => {
    if (t.adminOnly && !isAdmin) return false
    if (t.id === 'apikeys' && !canManageApiKeys) return false
    return true
  })

  // If current tab becomes invisible (role change), fallback to profile
  const currentTab = visibleTabs.find(t => t.id === activeTab) ? activeTab : 'profile'

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div>
        <h1 className="page-title">Paramètres</h1>
        <p className="page-subtitle">Gérez votre profil et les paramètres de l'application</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Sidebar tabs */}
        <nav className="w-full sm:w-52 flex-shrink-0">
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
              <p className="text-xs text-slate-500">Les onglets <strong>Entreprise</strong>, <strong>Utilisateurs</strong> et <strong>Système</strong> sont réservés aux administrateurs.</p>
            </div>
          )}
        </nav>

        {/* Content */}
        <div className="flex-1 card p-4 sm:p-6">
          {currentTab === 'profile'  && <ProfileTab />}
          {currentTab === 'password' && <PasswordTab />}
          {currentTab === 'apikeys'  && (canManageApiKeys ? <ApiKeysTab /> : <AccessDenied />)}
          {currentTab === 'company'  && (isAdmin ? <CompanyTab /> : <AccessDenied />)}
          {currentTab === 'users'    && (isAdmin ? <UsersTab /> : <AccessDenied />)}
          {currentTab === 'system'   && (isAdmin ? <SystemTab /> : <AccessDenied />)}
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
