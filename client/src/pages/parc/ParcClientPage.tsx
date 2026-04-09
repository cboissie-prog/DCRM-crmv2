import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import { differenceInDays, parseISO, isAfter } from 'date-fns'
import api from '../../lib/api'
import { formatDate, formatCurrency, EQUIPMENT_TYPES, CONTRACT_STATUSES, CONTRACT_TYPES } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { Drawer } from '../../components/ui/Drawer'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import type { Equipment, License, Contract } from '../../types'
import {
  ArrowLeft, Plus, Pencil, Trash2, AlertTriangle,
  Monitor, Laptop, Server, Printer, ShoppingCart, Network,
  Router, HardDrive, Tablet, Smartphone, HelpCircle, Key, FileText,
} from 'lucide-react'

// ── Constants ──────────────────────────────────────────────────────────────────

const EQUIPMENT_STATUSES: Record<string, { label: string; color: string }> = {
  ACTIVE:    { label: 'Actif',          color: 'badge-green'  },
  IN_REPAIR: { label: 'En réparation',  color: 'badge-orange' },
  RETIRED:   { label: 'Retraité',       color: 'badge-gray'   },
  LOST:      { label: 'Perdu',          color: 'badge-red'    },
}

const LICENSE_TYPES: Record<string, string> = {
  PERPETUAL:    'Perpétuelle',
  ANNUAL:       'Annuelle',
  MONTHLY:      'Mensuelle',
  SUBSCRIPTION: 'Abonnement',
}

const CONTRACT_TYPE_OPTIONS = Object.entries(CONTRACT_TYPES)
const CONTRACT_STATUS_OPTIONS = Object.entries(CONTRACT_STATUSES).map(([v, { label }]) => ({ value: v, label }))
const EQUIPMENT_TYPE_OPTIONS  = Object.entries(EQUIPMENT_TYPES).map(([value, label]) => ({ value, label }))
const LICENSE_TYPE_OPTIONS    = Object.entries(LICENSE_TYPES).map(([value, label]) => ({ value, label }))
const EQUIPMENT_STATUS_OPTIONS = Object.entries(EQUIPMENT_STATUSES).map(([v, { label }]) => ({ value: v, label }))

// ── Zod schemas ────────────────────────────────────────────────────────────────

const equipmentSchema = z.object({
  contractId:    z.string().optional(),
  type:          z.string().min(1, 'Type requis'),
  brand:         z.string().optional(),
  model:         z.string().optional(),
  serialNumber:  z.string().optional(),
  purchaseDate:  z.string().optional(),
  warrantyExpiry:z.string().optional(),
  location:      z.string().optional(),
  status:        z.string().min(1),
  notes:         z.string().optional(),
})
type EquipmentForm = z.infer<typeof equipmentSchema>

const licenseSchema = z.object({
  equipmentId:  z.string().optional(),
  software:     z.string().min(1, 'Logiciel requis'),
  vendor:       z.string().optional(),
  licenseKey:   z.string().optional(),
  seats:        z.coerce.number().min(1),
  type:         z.string().min(1),
  purchaseDate: z.string().optional(),
  expiryDate:   z.string().optional(),
  cost:         z.coerce.number().optional(),
  notes:        z.string().optional(),
})
type LicenseForm = z.infer<typeof licenseSchema>

const contractSchema = z.object({
  type:            z.string().min(1),
  title:           z.string().min(1, 'Titre requis'),
  description:     z.string().optional(),
  status:          z.string().min(1),
  startDate:       z.string().min(1, 'Date de début requise'),
  endDate:         z.string().min(1, 'Date de fin requise'),
  renewalDate:     z.string().optional(),
  monthlyAmount:   z.coerce.number().min(0),
  annualAmount:    z.coerce.number().min(0),
  slaResponseTime: z.coerce.number().optional(),
  autoRenewal:     z.boolean().optional(),
  notes:           z.string().optional(),
})
type ContractForm = z.infer<typeof contractSchema>

// ── Helpers ────────────────────────────────────────────────────────────────────

function EquipmentIcon({ type }: { type: string }) {
  const cls = 'w-4 h-4 text-slate-400'
  switch (type) {
    case 'DESKTOP':       return <Monitor className={cls} />
    case 'LAPTOP':        return <Laptop className={cls} />
    case 'SERVER':        return <Server className={cls} />
    case 'PRINTER':       return <Printer className={cls} />
    case 'CASH_REGISTER': return <ShoppingCart className={cls} />
    case 'SWITCH':        return <Network className={cls} />
    case 'ROUTER':        return <Router className={cls} />
    case 'NAS':           return <HardDrive className={cls} />
    case 'SCREEN':        return <Monitor className={cls} />
    case 'TABLET':        return <Tablet className={cls} />
    case 'PHONE':         return <Smartphone className={cls} />
    default:              return <HelpCircle className={cls} />
  }
}

function expiryBadge(date?: string | null) {
  if (!date) return <span className="text-slate-300">—</span>
  const days = differenceInDays(parseISO(date), new Date())
  if (days < 0)  return <Badge variant="badge-red">{formatDate(date)} — Expirée</Badge>
  if (days <= 30) return <Badge variant="badge-orange">{formatDate(date)} — {days}j</Badge>
  return <span className="text-slate-500 text-xs">{formatDate(date)}</span>
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

type Tab = 'equipment' | 'licenses' | 'contracts'

// ── Main page ──────────────────────────────────────────────────────────────────

export function ParcClientPage() {
  const { companyId } = useParams<{ companyId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const canWrite = ['ADMIN', 'MANAGER', 'TECHNICIEN'].includes(user?.role ?? '')
  const canDelete = ['ADMIN', 'MANAGER'].includes(user?.role ?? '')

  const [tab, setTab] = useState<Tab>('equipment')
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const goTo = (target: Tab, id: string) => {
    setHighlightId(id)
    setTab(target)
    setTimeout(() => setHighlightId(null), 2000)
  }

  // Fetch company name
  const { data: company, isLoading: loadingCompany } = useQuery<{ id: string; name: string; city?: string; sector?: string }>({
    queryKey: ['company-basic', companyId],
    queryFn: async () => { const { data } = await api.get(`/companies/${companyId}`); return data.data },
    enabled: !!companyId,
    staleTime: 60_000,
  })

  // Fetch equipments for this company
  const { data: equipData, isLoading: loadingEquip } = useQuery<{ data: Equipment[] }>({
    queryKey: ['parc-equipment', companyId],
    queryFn: async () => { const { data } = await api.get('/equipment', { params: { companyId, limit: 200 } }); return data },
    enabled: !!companyId,
    staleTime: 30_000,
  })

  // Fetch licenses for this company
  const { data: licData, isLoading: loadingLic } = useQuery<{ data: License[] }>({
    queryKey: ['parc-licenses', companyId],
    queryFn: async () => { const { data } = await api.get('/licenses', { params: { companyId, limit: 200 } }); return data },
    enabled: !!companyId,
    staleTime: 30_000,
  })

  // Fetch contracts for this company
  const { data: contractData, isLoading: loadingContracts } = useQuery<{ data: Contract[] }>({
    queryKey: ['parc-contracts', companyId],
    queryFn: async () => { const { data } = await api.get('/contracts', { params: { companyId, limit: 200 } }); return data },
    enabled: !!companyId,
    staleTime: 30_000,
  })

  const equipments = equipData?.data ?? []
  const licenses   = licData?.data ?? []
  const contracts  = contractData?.data ?? []

  // Alert counts for tab badges
  const now = new Date()
  const threshold = new Date(); threshold.setDate(threshold.getDate() + 60)
  const equipAlerts  = equipments.filter(e => e.warrantyExpiry && (new Date(e.warrantyExpiry) < now || new Date(e.warrantyExpiry) <= threshold)).length
  const licAlerts    = licenses.filter(l => l.expiryDate && (new Date(l.expiryDate) < now || differenceInDays(parseISO(l.expiryDate), now) <= 30)).length

  if (loadingCompany) return <PageSpinner />

  const tabClass = (t: Tab) =>
    `px-4 py-2.5 text-sm font-medium rounded-lg transition-colors relative ${
      tab === t
        ? 'bg-white text-primary-700 shadow-sm border border-slate-200'
        : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
    }`

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/parc')} className="btn-ghost btn-sm p-2 rounded-lg">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="page-title">{company?.name ?? '—'}</h1>
            <p className="page-subtitle">
              {company?.city && <span>{company.city}</span>}
              {company?.city && company?.sector && <span> · </span>}
              {company?.sector && <span>{company.sector}</span>}
            </p>
          </div>
        </div>
        <button
          className="btn-secondary btn-sm"
          onClick={() => navigate(`/companies/${companyId}`)}
        >
          Voir la fiche entreprise
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-slate-100 rounded-xl p-1 flex gap-1 w-fit">
        <button className={tabClass('equipment')} onClick={() => setTab('equipment')}>
          <Monitor className="w-4 h-4 inline mr-1.5" />
          Équipements
          {equipAlerts > 0 && <span className="ml-1.5 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">{equipAlerts}</span>}
          <span className="ml-1.5 text-slate-400 font-normal">({equipments.length})</span>
        </button>
        <button className={tabClass('licenses')} onClick={() => setTab('licenses')}>
          <Key className="w-4 h-4 inline mr-1.5" />
          Licences
          {licAlerts > 0 && <span className="ml-1.5 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">{licAlerts}</span>}
          <span className="ml-1.5 text-slate-400 font-normal">({licenses.length})</span>
        </button>
        <button className={tabClass('contracts')} onClick={() => setTab('contracts')}>
          <FileText className="w-4 h-4 inline mr-1.5" />
          Contrats
          <span className="ml-1.5 text-slate-400 font-normal">({contracts.length})</span>
        </button>
      </div>

      {/* Tab content */}
      {tab === 'equipment' && (
        <EquipmentTab
          companyId={companyId!}
          equipments={equipments}
          licenses={licenses}
          contracts={contracts}
          isLoading={loadingEquip}
          canWrite={canWrite}
          canDelete={canDelete}
          goTo={goTo}
        />
      )}
      {tab === 'licenses' && (
        <LicensesTab
          companyId={companyId!}
          licenses={licenses}
          equipments={equipments}
          isLoading={loadingLic}
          canWrite={canWrite}
          canDelete={canDelete}
          highlightId={highlightId}
        />
      )}
      {tab === 'contracts' && (
        <ContractsTab
          companyId={companyId!}
          contracts={contracts}
          isLoading={loadingContracts}
          canWrite={canWrite}
          canDelete={canDelete}
          highlightId={highlightId}
        />
      )}
    </div>
  )
}

// ── Equipment tab ──────────────────────────────────────────────────────────────

function EquipmentTab({ companyId, equipments, licenses, contracts, isLoading, canWrite, canDelete, goTo }: {
  companyId: string
  equipments: Equipment[]
  licenses: License[]
  contracts: Contract[]
  isLoading: boolean
  canWrite: boolean
  canDelete: boolean
  goTo: (tab: Tab, id: string) => void
}) {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Equipment | null>(null)
  const [deleting, setDeleting] = useState<Equipment | null>(null)
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null)

  const form = useForm<EquipmentForm>({
    resolver: zodResolver(equipmentSchema) as Resolver<EquipmentForm>,
    defaultValues: { status: 'ACTIVE' },
  })
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = form

  const invalidate = () => qc.invalidateQueries({ queryKey: ['parc-equipment', companyId] })

  const createMutation = useMutation({
    mutationFn: (v: EquipmentForm) => api.post('/equipment', { ...v, companyId }),
    onSuccess: () => { invalidate(); setShowModal(false); toast.success('Équipement ajouté') },
    onError: () => toast.error('Erreur lors de la création'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, v }: { id: string; v: EquipmentForm }) => api.put(`/equipment/${id}`, { ...v, companyId }),
    onSuccess: () => { invalidate(); setShowModal(false); setEditing(null); toast.success('Équipement modifié') },
    onError: () => toast.error('Erreur lors de la modification'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/equipment/${id}`),
    onSuccess: () => { invalidate(); setDeleting(null); toast.success('Équipement supprimé') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const openCreate = () => { setEditing(null); reset({ status: 'ACTIVE' }); setShowModal(true) }
  const openEdit = (eq: Equipment) => {
    setEditing(eq)
    reset({
      contractId:    eq.contractId ?? '',
      type:          eq.type,
      brand:         eq.brand ?? '',
      model:         eq.model ?? '',
      serialNumber:  eq.serialNumber ?? '',
      purchaseDate:  eq.purchaseDate?.slice(0, 10) ?? '',
      warrantyExpiry:eq.warrantyExpiry?.slice(0, 10) ?? '',
      location:      eq.location ?? '',
      status:        eq.status,
      notes:         eq.notes ?? '',
    })
    setSelectedEquipment(null)
    setShowModal(true)
  }
  const onSubmit = (v: EquipmentForm) => {
    const payload = { ...v, contractId: v.contractId || undefined }
    editing ? updateMutation.mutate({ id: editing.id, v: payload }) : createMutation.mutate(payload)
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canWrite && (
          <button className="btn-primary" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Ajouter équipement
          </button>
        )}
      </div>

      {isLoading ? <PageSpinner /> : equipments.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Monitor className="w-10 h-10 mx-auto mb-2 text-slate-200" />
          <p className="text-sm">Aucun équipement enregistré</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {equipments.map(eq => {
            const linkedLicenses = licenses.filter(l => l.equipmentId === eq.id)
            const warrantyExpired = eq.warrantyExpiry && isAfter(new Date(), parseISO(eq.warrantyExpiry))
            const warrantyDays = eq.warrantyExpiry ? differenceInDays(parseISO(eq.warrantyExpiry), new Date()) : null
            const hasAlert = warrantyExpired || (warrantyDays !== null && warrantyDays <= 60 && warrantyDays >= 0)

            return (
              <div
                key={eq.id}
                className={`bg-white border rounded-xl shadow-sm flex flex-col cursor-pointer hover:shadow-md transition-shadow ${hasAlert ? 'border-amber-200' : 'border-slate-200'}`}
                onClick={() => setSelectedEquipment(eq)}
              >
                {/* Card header */}
                <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      eq.status === 'IN_REPAIR' ? 'bg-orange-100' :
                      eq.status === 'RETIRED'   ? 'bg-slate-100' :
                      eq.status === 'LOST'      ? 'bg-red-100'   : 'bg-blue-50'
                    }`}>
                      <div className={
                        eq.status === 'IN_REPAIR' ? 'text-orange-500' :
                        eq.status === 'RETIRED'   ? 'text-slate-400' :
                        eq.status === 'LOST'      ? 'text-red-500'   : 'text-blue-500'
                      }>
                        <EquipmentIcon type={eq.type} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 leading-tight">
                        {[eq.brand, eq.model].filter(Boolean).join(' ') || EQUIPMENT_TYPES[eq.type] || eq.type}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{EQUIPMENT_TYPES[eq.type] ?? eq.type}</p>
                    </div>
                  </div>
                  <Badge variant={EQUIPMENT_STATUSES[eq.status]?.color ?? 'badge-gray'} >
                    {EQUIPMENT_STATUSES[eq.status]?.label ?? eq.status}
                  </Badge>
                </div>

                {/* Meta info */}
                <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {eq.serialNumber && (
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <span className="text-slate-300 font-medium">S/N</span>
                      <span className="font-mono truncate">{eq.serialNumber}</span>
                    </div>
                  )}
                  {eq.location && (
                    <div className="flex items-center gap-1.5 text-slate-500 truncate">
                      <span className="text-slate-300">📍</span>
                      <span className="truncate">{eq.location}</span>
                    </div>
                  )}
                  {eq.purchaseDate && (
                    <div className="text-slate-400">
                      Achat : {formatDate(eq.purchaseDate)}
                    </div>
                  )}
                  {eq.warrantyExpiry && (
                    <div className={`flex items-center gap-1 ${warrantyExpired ? 'text-red-500' : warrantyDays !== null && warrantyDays <= 60 ? 'text-amber-500' : 'text-emerald-600'}`}>
                      {(warrantyExpired || (warrantyDays !== null && warrantyDays <= 60)) && <AlertTriangle className="w-3 h-3 flex-shrink-0" />}
                      Garantie : {formatDate(eq.warrantyExpiry)}
                      {!warrantyExpired && warrantyDays !== null && warrantyDays <= 60 && ` (${warrantyDays}j)`}
                      {warrantyExpired && ' — Expirée'}
                    </div>
                  )}
                </div>

                {/* Linked items */}
                {(eq.contract || linkedLicenses.length > 0) && (
                  <div className="mx-4 mb-3 pt-3 border-t border-slate-100 space-y-2" onClick={e => e.stopPropagation()}>
                    {/* Contract */}
                    {eq.contract && (
                      <div className="flex items-start gap-2">
                        <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="text-xs text-slate-400 font-medium">Contrat</span>
                          <button
                            onClick={() => goTo('contracts', eq.contract!.id)}
                            className="block text-xs text-primary-700 font-medium truncate hover:underline text-left w-full mt-0.5"
                          >
                            {eq.contract.reference} — {eq.contract.title}
                          </button>
                        </div>
                      </div>
                    )}
                    {/* Licenses */}
                    {linkedLicenses.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Key className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-slate-400 font-medium">Licences</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {linkedLicenses.map(l => {
                              const licExpired = l.expiryDate && isAfter(new Date(), parseISO(l.expiryDate))
                              const licDays = l.expiryDate ? differenceInDays(parseISO(l.expiryDate), new Date()) : null
                              const licAlert = licExpired || (licDays !== null && licDays <= 30)
                              return (
                                <button
                                  key={l.id}
                                  onClick={() => goTo('licenses', l.id)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80 ${
                                    licAlert ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-violet-50 text-violet-700 border border-violet-200'
                                  }`}
                                >
                                  {licAlert && <AlertTriangle className="w-3 h-3" />}
                                  {l.software}
                                  {l.seats > 1 && <span className="text-xs opacity-60">×{l.seats}</span>}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer actions */}
                {(canWrite || canDelete) && (
                  <div className="px-4 pb-3 pt-2 mt-auto border-t border-slate-100 flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                    {canWrite && (
                      <button className="btn-ghost btn-sm px-2 py-1 rounded-lg flex items-center gap-1.5 text-slate-500 hover:text-primary-600" onClick={() => openEdit(eq)}>
                        <Pencil className="w-3.5 h-3.5" /> Modifier
                      </button>
                    )}
                    {canDelete && (
                      <button className="btn-ghost btn-sm px-2 py-1 rounded-lg flex items-center gap-1.5 text-slate-400 hover:text-red-500" onClick={() => setDeleting(eq)}>
                        <Trash2 className="w-3.5 h-3.5" /> Supprimer
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Equipment detail drawer */}
      {selectedEquipment && (() => {
        const eq = selectedEquipment
        const linkedLicenses = licenses.filter(l => l.equipmentId === eq.id)
        const warrantyExpired = eq.warrantyExpiry && isAfter(new Date(), parseISO(eq.warrantyExpiry))
        const warrantyDays = eq.warrantyExpiry ? differenceInDays(parseISO(eq.warrantyExpiry), new Date()) : null
        return (
          <Drawer
            open={!!selectedEquipment}
            onClose={() => setSelectedEquipment(null)}
            title={[eq.brand, eq.model].filter(Boolean).join(' ') || EQUIPMENT_TYPES[eq.type] || eq.type}
            actions={canWrite ? (
              <button
                className="btn-secondary btn-sm flex items-center gap-1.5"
                onClick={() => openEdit(eq)}
              >
                <Pencil className="w-3.5 h-3.5" /> Modifier
              </button>
            ) : undefined}
          >
            <div className="p-5 space-y-6">
              {/* Type + status */}
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  eq.status === 'IN_REPAIR' ? 'bg-orange-100' :
                  eq.status === 'RETIRED'   ? 'bg-slate-100' :
                  eq.status === 'LOST'      ? 'bg-red-100'   : 'bg-blue-50'
                }`}>
                  <div className={`scale-150 ${
                    eq.status === 'IN_REPAIR' ? 'text-orange-500' :
                    eq.status === 'RETIRED'   ? 'text-slate-400' :
                    eq.status === 'LOST'      ? 'text-red-500'   : 'text-blue-500'
                  }`}>
                    <EquipmentIcon type={eq.type} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{EQUIPMENT_TYPES[eq.type] ?? eq.type}</p>
                  <Badge variant={EQUIPMENT_STATUSES[eq.status]?.color ?? 'badge-gray'}>
                    {EQUIPMENT_STATUSES[eq.status]?.label ?? eq.status}
                  </Badge>
                </div>
              </div>

              {/* Info fields */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Informations</h3>
                <div className="grid grid-cols-2 gap-3">
                  {eq.brand && (
                    <div>
                      <p className="text-xs text-slate-400">Marque</p>
                      <p className="text-sm font-medium text-slate-800">{eq.brand}</p>
                    </div>
                  )}
                  {eq.model && (
                    <div>
                      <p className="text-xs text-slate-400">Modèle</p>
                      <p className="text-sm font-medium text-slate-800">{eq.model}</p>
                    </div>
                  )}
                  {eq.serialNumber && (
                    <div>
                      <p className="text-xs text-slate-400">Numéro de série</p>
                      <p className="text-sm font-mono text-slate-800">{eq.serialNumber}</p>
                    </div>
                  )}
                  {eq.location && (
                    <div>
                      <p className="text-xs text-slate-400">Emplacement</p>
                      <p className="text-sm text-slate-800">{eq.location}</p>
                    </div>
                  )}
                  {eq.purchaseDate && (
                    <div>
                      <p className="text-xs text-slate-400">Date d'achat</p>
                      <p className="text-sm text-slate-800">{formatDate(eq.purchaseDate)}</p>
                    </div>
                  )}
                  {eq.warrantyExpiry && (
                    <div>
                      <p className="text-xs text-slate-400">Garantie</p>
                      <p className={`text-sm font-medium flex items-center gap-1 ${
                        warrantyExpired ? 'text-red-600' :
                        warrantyDays !== null && warrantyDays <= 60 ? 'text-amber-600' : 'text-emerald-600'
                      }`}>
                        {(warrantyExpired || (warrantyDays !== null && warrantyDays <= 60)) && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                        {formatDate(eq.warrantyExpiry)}
                        {!warrantyExpired && warrantyDays !== null && warrantyDays <= 60 && ` (${warrantyDays}j)`}
                        {warrantyExpired && ' — Expirée'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Contract */}
              {eq.contract && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Contrat associé</h3>
                  <button
                    onClick={() => { setSelectedEquipment(null); goTo('contracts', eq.contract!.id) }}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-primary-300 hover:bg-primary-50/30 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-400 group-hover:text-primary-600" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-primary-700 truncate">{eq.contract.title}</p>
                        <p className="text-xs text-slate-400">{eq.contract.reference}</p>
                      </div>
                    </div>
                  </button>
                </div>
              )}

              {/* Licenses */}
              {linkedLicenses.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Licences associées</h3>
                  <div className="space-y-2">
                    {linkedLicenses.map(l => {
                      const licExpired = l.expiryDate && isAfter(new Date(), parseISO(l.expiryDate))
                      const licDays = l.expiryDate ? differenceInDays(parseISO(l.expiryDate), new Date()) : null
                      const licAlert = licExpired || (licDays !== null && licDays <= 30)
                      return (
                        <button
                          key={l.id}
                          onClick={() => { setSelectedEquipment(null); goTo('licenses', l.id) }}
                          className={`w-full text-left p-3 rounded-lg border transition-colors group ${
                            licAlert ? 'border-red-200 bg-red-50/30 hover:bg-red-50' : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/30'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Key className={`w-4 h-4 flex-shrink-0 ${licAlert ? 'text-red-400' : 'text-slate-400 group-hover:text-violet-600'}`} />
                              <div className="min-w-0">
                                <p className={`text-sm font-medium truncate ${licAlert ? 'text-red-700' : 'text-violet-700'}`}>{l.software}</p>
                                <p className="text-xs text-slate-400">{l.vendor ?? ''}{l.seats > 1 ? ` · ${l.seats} postes` : ''}</p>
                              </div>
                            </div>
                            {licAlert && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                          </div>
                          {l.expiryDate && (
                            <p className={`text-xs mt-1 ml-6 ${licAlert ? 'text-red-500' : 'text-slate-400'}`}>
                              Expire : {formatDate(l.expiryDate)}
                              {!licExpired && licDays !== null && licDays <= 30 && ` (${licDays}j)`}
                              {licExpired && ' — Expirée'}
                            </p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Notes */}
              {eq.notes && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Notes</h3>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 border border-slate-100">{eq.notes}</p>
                </div>
              )}

              {canDelete && (
                <div className="pt-2 border-t border-slate-100">
                  <button
                    className="btn-ghost btn-sm text-red-500 hover:bg-red-50 flex items-center gap-1.5"
                    onClick={() => { setSelectedEquipment(null); setDeleting(eq) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Supprimer l'équipement
                  </button>
                </div>
              )}
            </div>
          </Drawer>
        )
      })()}

      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }} title={editing ? "Modifier l'équipement" : 'Ajouter un équipement'} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Type *</label>
              <select {...register('type')} className={`input ${errors.type ? 'input-error' : ''}`}>
                <option value="">Sélectionner</option>
                {EQUIPMENT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {errors.type && <p className="form-error">{errors.type.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Statut *</label>
              <select {...register('status')} className="input">
                {EQUIPMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Marque</label>
              <input {...register('brand')} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Modèle</label>
              <input {...register('model')} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Numéro de série</label>
              <input {...register('serialNumber')} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Emplacement</label>
              <input {...register('location')} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Date d'achat</label>
              <input {...register('purchaseDate')} type="date" className="input" />
            </div>
            <div className="form-group">
              <label className="label">Fin de garantie</label>
              <input {...register('warrantyExpiry')} type="date" className="input" />
            </div>
            <div className="form-group col-span-2">
              <label className="label">Contrat lié</label>
              <select {...register('contractId')} className="input">
                <option value="">Aucun</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.reference} — {c.title}</option>)}
              </select>
            </div>
            <div className="form-group col-span-2">
              <label className="label">Notes</label>
              <textarea {...register('notes')} className="input" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setEditing(null) }}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {editing ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Supprimer l'équipement" size="sm">
        <p className="text-slate-600 mb-6">Supprimer <strong>{[deleting?.brand, deleting?.model].filter(Boolean).join(' ') || EQUIPMENT_TYPES[deleting?.type ?? ''] || 'cet équipement'}</strong> ? Cette action est irréversible.</p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeleting(null)}>Annuler</button>
          <button className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700" disabled={deleteMutation.isPending} onClick={() => deleting && deleteMutation.mutate(deleting.id)}>Supprimer</button>
        </div>
      </Modal>
    </div>
  )
}

// ── Licenses tab ───────────────────────────────────────────────────────────────

function LicensesTab({ companyId, licenses, equipments, isLoading, canWrite, canDelete, highlightId }: {
  companyId: string
  licenses: License[]
  equipments: Equipment[]
  isLoading: boolean
  canWrite: boolean
  canDelete: boolean
  highlightId: string | null
}) {
  const qc = useQueryClient()
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  useEffect(() => {
    if (highlightId && rowRefs.current[highlightId]) {
      rowRefs.current[highlightId]!.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId])

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<License | null>(null)
  const [deleting, setDeleting] = useState<License | null>(null)

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<LicenseForm>({
    resolver: zodResolver(licenseSchema) as Resolver<LicenseForm>,
    defaultValues: { seats: 1, type: 'ANNUAL' },
  })

  // Software catalog for quick prefill
  const { data: softwareCatalog } = useQuery<{ data: { id: string; name: string; supplier?: string; price: number; type: string }[] }>({
    queryKey: ['products-software'],
    queryFn: async () => { const { data } = await api.get('/products', { params: { category: 'SOFTWARE', limit: 200 } }); return data },
    staleTime: 120_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['parc-licenses', companyId] })

  const createMutation = useMutation({
    mutationFn: (v: LicenseForm) => api.post('/licenses', { ...v, companyId }),
    onSuccess: () => { invalidate(); setShowModal(false); toast.success('Licence ajoutée') },
    onError: () => toast.error('Erreur lors de la création'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, v }: { id: string; v: LicenseForm }) => api.put(`/licenses/${id}`, { ...v, companyId }),
    onSuccess: () => { invalidate(); setShowModal(false); setEditing(null); toast.success('Licence modifiée') },
    onError: () => toast.error('Erreur lors de la modification'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/licenses/${id}`),
    onSuccess: () => { invalidate(); setDeleting(null); toast.success('Licence supprimée') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const openCreate = () => { setEditing(null); reset({ seats: 1, type: 'ANNUAL' }); setShowModal(true) }
  const openEdit = (l: License) => {
    setEditing(l)
    reset({
      equipmentId:  l.equipmentId ?? '',
      software:     l.software,
      vendor:       l.vendor ?? '',
      licenseKey:   l.licenseKey ?? '',
      seats:        l.seats,
      type:         l.type,
      purchaseDate: l.purchaseDate?.slice(0, 10) ?? '',
      expiryDate:   l.expiryDate?.slice(0, 10) ?? '',
      cost:         l.cost ?? undefined,
      notes:        l.notes ?? '',
    })
    setShowModal(true)
  }
  const onSubmit = (v: LicenseForm) => {
    const payload = { ...v, equipmentId: v.equipmentId || undefined }
    editing ? updateMutation.mutate({ id: editing.id, v: payload }) : createMutation.mutate(payload)
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canWrite && <button className="btn-primary" onClick={openCreate}><Plus className="w-4 h-4" /> Ajouter licence</button>}
      </div>

      {isLoading ? <PageSpinner /> : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Logiciel</th>
                <th>Fournisseur</th>
                <th>Type</th>
                <th>Postes</th>
                <th>Expiration</th>
                <th>Coût</th>
                <th>Équipement lié</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {licenses.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">Aucune licence</td></tr>
              ) : licenses.map(l => (
                <tr
                  key={l.id}
                  ref={el => { rowRefs.current[l.id] = el }}
                  className={highlightId === l.id ? 'animate-highlight' : ''}
                >
                  <td className="font-medium text-slate-900">{l.software}</td>
                  <td className="text-slate-500 text-sm">{l.vendor ?? '—'}</td>
                  <td><Badge variant="badge-blue">{LICENSE_TYPES[l.type] ?? l.type}</Badge></td>
                  <td className="text-slate-600 text-sm">{l.seats}</td>
                  <td>{expiryBadge(l.expiryDate)}</td>
                  <td className="text-slate-600 text-sm">{formatCurrency(l.cost)}</td>
                  <td>
                    {l.equipment ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-md">
                        <EquipmentIcon type={l.equipment.type} />
                        {[l.equipment.brand, l.equipment.model].filter(Boolean).join(' ') || EQUIPMENT_TYPES[l.equipment.type] || l.equipment.type}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      {canWrite && <button className="btn-ghost btn-sm p-1.5 rounded-lg" onClick={() => openEdit(l)}><Pencil className="w-3.5 h-3.5" /></button>}
                      {canDelete && <button className="btn-ghost btn-sm p-1.5 rounded-lg text-red-400 hover:text-red-600" onClick={() => setDeleting(l)}><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }} title={editing ? 'Modifier la licence' : 'Ajouter une licence'} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Catalog picker (create only) */}
          {!editing && softwareCatalog && softwareCatalog.data.length > 0 && (
            <div className="bg-violet-50 border border-violet-100 rounded-lg p-3">
              <label className="label text-violet-700">Choisir depuis le catalogue</label>
              <select
                className="input border-violet-200 bg-white"
                defaultValue=""
                onChange={e => {
                  const p = softwareCatalog.data.find(x => x.id === e.target.value)
                  if (!p) return
                  setValue('software', p.name)
                  setValue('vendor', p.supplier ?? '')
                  setValue('cost', p.price)
                  setValue('type', p.type === 'SUBSCRIPTION' ? 'ANNUAL' : 'PERPETUAL')
                }}
              >
                <option value="">— Sélectionner un logiciel —</option>
                {softwareCatalog.data.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.supplier ? ` (${p.supplier})` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Logiciel *</label>
              <input {...register('software')} className={`input ${errors.software ? 'input-error' : ''}`} />
              {errors.software && <p className="form-error">{errors.software.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Fournisseur</label>
              <input {...register('vendor')} className="input" />
            </div>
            <div className="form-group col-span-2">
              <label className="label">Clé de licence</label>
              <input {...register('licenseKey')} className="input font-mono" placeholder="XXXXX-XXXXX-XXXXX" />
            </div>
            <div className="form-group">
              <label className="label">Type *</label>
              <select {...register('type')} className="input">
                {LICENSE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Postes *</label>
              <input {...register('seats')} type="number" min={1} className={`input ${errors.seats ? 'input-error' : ''}`} />
            </div>
            <div className="form-group">
              <label className="label">Date d'achat</label>
              <input {...register('purchaseDate')} type="date" className="input" />
            </div>
            <div className="form-group">
              <label className="label">Date d'expiration</label>
              <input {...register('expiryDate')} type="date" className="input" />
            </div>
            <div className="form-group">
              <label className="label">Coût annuel (€)</label>
              <input {...register('cost')} type="number" min={0} step={0.01} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Équipement lié</label>
              <select {...register('equipmentId')} className="input">
                <option value="">Aucun</option>
                {equipments.map(eq => <option key={eq.id} value={eq.id}>{[eq.brand, eq.model].filter(Boolean).join(' ') || EQUIPMENT_TYPES[eq.type]}</option>)}
              </select>
            </div>
            <div className="form-group col-span-2">
              <label className="label">Notes</label>
              <textarea {...register('notes')} className="input" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setEditing(null) }}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {editing ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Supprimer la licence" size="sm">
        <p className="text-slate-600 mb-6">Supprimer la licence <strong>{deleting?.software}</strong> ?</p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeleting(null)}>Annuler</button>
          <button className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700" disabled={deleteMutation.isPending} onClick={() => deleting && deleteMutation.mutate(deleting.id)}>Supprimer</button>
        </div>
      </Modal>
    </div>
  )
}

// ── Contracts tab ──────────────────────────────────────────────────────────────

function ContractsTab({ companyId, contracts, isLoading, canWrite, canDelete, highlightId }: {
  companyId: string
  contracts: Contract[]
  isLoading: boolean
  canWrite: boolean
  canDelete: boolean
  highlightId: string | null
}) {
  const qc = useQueryClient()
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  useEffect(() => {
    if (highlightId && rowRefs.current[highlightId]) {
      rowRefs.current[highlightId]!.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId])

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [deleting, setDeleting] = useState<Contract | null>(null)

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<ContractForm>({
    resolver: zodResolver(contractSchema) as Resolver<ContractForm>,
    defaultValues: { status: 'ACTIVE', autoRenewal: false, monthlyAmount: 0, annualAmount: 0 },
  })

  // Contract template catalog
  const { data: contractTemplates } = useQuery<{ data: { id: string; name: string; description?: string; price: number; supplier?: string }[] }>({
    queryKey: ['products-contract-templates'],
    queryFn: async () => { const { data } = await api.get('/products', { params: { category: 'CONTRACT_TEMPLATE', limit: 100 } }); return data },
    staleTime: 120_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['parc-contracts', companyId] })

  const createMutation = useMutation({
    mutationFn: (v: ContractForm) => api.post('/contracts', { ...v, companyId }),
    onSuccess: () => { invalidate(); setShowModal(false); toast.success('Contrat créé') },
    onError: () => toast.error('Erreur lors de la création'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, v }: { id: string; v: ContractForm }) => api.put(`/contracts/${id}`, { ...v, companyId }),
    onSuccess: () => { invalidate(); setShowModal(false); setEditing(null); toast.success('Contrat modifié') },
    onError: () => toast.error('Erreur lors de la modification'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/contracts/${id}`),
    onSuccess: () => { invalidate(); setDeleting(null); toast.success('Contrat supprimé') },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  const openCreate = () => { setEditing(null); reset({ status: 'ACTIVE', autoRenewal: false, monthlyAmount: 0, annualAmount: 0 }); setShowModal(true) }
  const openEdit = (c: Contract) => {
    setEditing(c)
    reset({
      type:            c.type,
      title:           c.title,
      description:     c.description ?? '',
      status:          c.status,
      startDate:       c.startDate?.slice(0, 10) ?? '',
      endDate:         c.endDate?.slice(0, 10) ?? '',
      renewalDate:     c.renewalDate?.slice(0, 10) ?? '',
      monthlyAmount:   c.monthlyAmount,
      annualAmount:    c.annualAmount,
      slaResponseTime: c.slaResponseTime ?? undefined,
      autoRenewal:     c.autoRenewal,
      notes:           c.notes ?? '',
    })
    setShowModal(true)
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canWrite && <button className="btn-primary" onClick={openCreate}><Plus className="w-4 h-4" /> Nouveau contrat</button>}
      </div>

      {isLoading ? <PageSpinner /> : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Réf.</th>
                <th>Titre</th>
                <th>Type</th>
                <th>Statut</th>
                <th>Début</th>
                <th>Fin</th>
                <th>Mensuel</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contracts.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">Aucun contrat</td></tr>
              ) : contracts.map(c => (
                <tr
                  key={c.id}
                  ref={el => { rowRefs.current[c.id] = el }}
                  className={highlightId === c.id ? 'animate-highlight' : ''}
                >
                  <td className="font-mono text-xs text-slate-500">{c.reference}</td>
                  <td className="font-medium text-slate-900">{c.title}</td>
                  <td className="text-slate-500 text-xs">{CONTRACT_TYPES[c.type] ?? c.type}</td>
                  <td><Badge variant={CONTRACT_STATUSES[c.status]?.color ?? 'badge-gray'}>{CONTRACT_STATUSES[c.status]?.label ?? c.status}</Badge></td>
                  <td className="text-slate-400 text-xs">{formatDate(c.startDate)}</td>
                  <td className="text-slate-400 text-xs">{formatDate(c.endDate)}</td>
                  <td className="text-slate-600 text-sm font-medium">{formatCurrency(c.monthlyAmount)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {canWrite && <button className="btn-ghost btn-sm p-1.5 rounded-lg" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></button>}
                      {canDelete && <button className="btn-ghost btn-sm p-1.5 rounded-lg text-red-400 hover:text-red-600" onClick={() => setDeleting(c)}><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }} title={editing ? 'Modifier le contrat' : 'Nouveau contrat'} size="lg">
        <form onSubmit={handleSubmit(v => editing ? updateMutation.mutate({ id: editing.id, v }) : createMutation.mutate(v))} className="space-y-4">
          {/* Template picker (create only) */}
          {!editing && contractTemplates && contractTemplates.data.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
              <label className="label text-indigo-700">Partir d'un modèle</label>
              <select
                className="input border-indigo-200 bg-white"
                defaultValue=""
                onChange={e => {
                  const t = contractTemplates.data.find(x => x.id === e.target.value)
                  if (!t) return
                  setValue('title', t.name)
                  setValue('description', t.description ?? '')
                  setValue('monthlyAmount', t.price)
                  setValue('annualAmount', Math.round(t.price * 12 * 100) / 100)
                  if (t.supplier) setValue('type', t.supplier)
                }}
              >
                <option value="">— Choisir un modèle —</option>
                {contractTemplates.data.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.price ? ` — ${t.price} €/mois` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Type *</label>
              <select {...register('type')} className="input">
                {CONTRACT_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Statut *</label>
              <select {...register('status')} className="input">
                {CONTRACT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group col-span-2">
              <label className="label">Titre *</label>
              <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} />
              {errors.title && <p className="form-error">{errors.title.message}</p>}
            </div>
            <div className="form-group">
              <label className="label">Date début *</label>
              <input {...register('startDate')} type="date" className={`input ${errors.startDate ? 'input-error' : ''}`} />
            </div>
            <div className="form-group">
              <label className="label">Date fin *</label>
              <input {...register('endDate')} type="date" className={`input ${errors.endDate ? 'input-error' : ''}`} />
            </div>
            <div className="form-group">
              <label className="label">Montant mensuel (€)</label>
              <input {...register('monthlyAmount')} type="number" min={0} step={0.01} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Montant annuel (€)</label>
              <input {...register('annualAmount')} type="number" min={0} step={0.01} className="input" />
            </div>
            <div className="form-group">
              <label className="label">SLA réponse (h)</label>
              <input {...register('slaResponseTime')} type="number" min={0} className="input" />
            </div>
            <div className="form-group">
              <label className="label">Renouvellement</label>
              <input {...register('renewalDate')} type="date" className="input" />
            </div>
            <div className="form-group col-span-2 flex items-center gap-3">
              <input {...register('autoRenewal')} type="checkbox" id="autoRenewal" className="w-4 h-4 rounded border-slate-300 text-primary-600" />
              <label htmlFor="autoRenewal" className="text-sm text-slate-700 cursor-pointer">Renouvellement automatique</label>
            </div>
            <div className="form-group col-span-2">
              <label className="label">Notes</label>
              <textarea {...register('notes')} className="input" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setEditing(null) }}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {editing ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Supprimer le contrat" size="sm">
        <p className="text-slate-600 mb-6">Supprimer le contrat <strong>{deleting?.title}</strong> ? Cette action est irréversible.</p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeleting(null)}>Annuler</button>
          <button className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700" disabled={deleteMutation.isPending} onClick={() => deleting && deleteMutation.mutate(deleting.id)}>Supprimer</button>
        </div>
      </Modal>
    </div>
  )
}
