import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Resolver } from 'react-hook-form'
import api from '../../lib/api'
import { formatDate } from '../../lib/utils'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/authStore'
import {
  Plus, Search, Eye, Pencil, Trash2, BookOpen, Tag,
  ClipboardList, HelpCircle, CheckCircle2, Monitor, Code2,
  Wifi, ShoppingCart, FileText, ArrowLeft, Clock, X,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface KnowledgeArticle {
  id: string
  title: string
  category: string
  content: string
  tags?: string
  views: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

// ── Category config ────────────────────────────────────────────────────────────

const CATEGORIES: Record<string, {
  label: string
  icon: React.ReactNode
  bg: string
  text: string
  border: string
  bar: string
}> = {
  PROCEDURES:   { label: 'Procédures',  icon: <ClipboardList className="w-4 h-4" />,   bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200',   bar: 'bg-blue-500' },
  FAQ:          { label: 'FAQ',         icon: <HelpCircle className="w-4 h-4" />,       bg: 'bg-violet-50',  text: 'text-violet-700', border: 'border-violet-200', bar: 'bg-violet-500' },
  RESOLUTIONS:  { label: 'Résolutions', icon: <CheckCircle2 className="w-4 h-4" />,     bg: 'bg-emerald-50', text: 'text-emerald-700',border: 'border-emerald-200',bar: 'bg-emerald-500' },
  HARDWARE:     { label: 'Matériel',    icon: <Monitor className="w-4 h-4" />,          bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200',  bar: 'bg-amber-500' },
  SOFTWARE:     { label: 'Logiciels',   icon: <Code2 className="w-4 h-4" />,            bg: 'bg-indigo-50',  text: 'text-indigo-700', border: 'border-indigo-200', bar: 'bg-indigo-500' },
  NETWORK:      { label: 'Réseau',      icon: <Wifi className="w-4 h-4" />,             bg: 'bg-cyan-50',    text: 'text-cyan-700',   border: 'border-cyan-200',   bar: 'bg-cyan-500' },
  CASHREGISTER: { label: 'Caisse',      icon: <ShoppingCart className="w-4 h-4" />,     bg: 'bg-orange-50',  text: 'text-orange-700', border: 'border-orange-200', bar: 'bg-orange-500' },
  OTHER:        { label: 'Autre',       icon: <FileText className="w-4 h-4" />,         bg: 'bg-slate-50',   text: 'text-slate-600',  border: 'border-slate-200',  bar: 'bg-slate-400' },
}

function getCat(key: string) {
  return CATEGORIES[key] ?? CATEGORIES.OTHER
}

// ── Schema ────────────────────────────────────────────────────────────────────

const articleSchema = z.object({
  title:       z.string().min(1, 'Titre requis'),
  category:    z.string().min(1, 'Catégorie requise'),
  content:     z.string().min(1, 'Contenu requis'),
  tags:        z.string().optional(),
  isPublished: z.boolean(),
})
type ArticleForm = z.infer<typeof articleSchema>

// ── Article card ──────────────────────────────────────────────────────────────

function ArticleCard({
  article, onClick, onEdit, onDelete, canEdit,
}: {
  article: KnowledgeArticle
  onClick: () => void
  onEdit: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  canEdit: boolean
}) {
  const cat = getCat(article.category)
  const excerpt = article.content.replace(/\n+/g, ' ').slice(0, 120)

  return (
    <div
      onClick={onClick}
      className="group bg-white border border-slate-200 rounded-2xl overflow-hidden cursor-pointer hover:shadow-md hover:border-slate-300 transition-all flex flex-col"
    >
      {/* Color bar top */}
      <div className={`h-1 w-full ${cat.bar}`} />

      <div className="p-5 flex flex-col gap-3 flex-1">
        {/* Category + draft badge */}
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cat.bg} ${cat.text}`}>
            {cat.icon}
            {cat.label}
          </span>
          {!article.isPublished && (
            <span className="text-xs font-medium px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">Brouillon</span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-primary-700 transition-colors">
          {article.title}
        </h3>

        {/* Excerpt */}
        <p className="text-sm text-slate-500 line-clamp-3 flex-1">
          {excerpt}{article.content.length > 120 ? '…' : ''}
        </p>

        {/* Tags */}
        {article.tags && (
          <div className="flex items-center gap-1 flex-wrap">
            {article.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 3).map(tag => (
              <span key={tag} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{tag}</span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{article.views}</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(article.updatedAt)}</span>
          </div>
          {canEdit && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
              <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary-600 transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Article reader ─────────────────────────────────────────────────────────────

function ArticleReader({
  article, canEdit, onEdit, onDelete, onClose,
}: {
  article: KnowledgeArticle
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const cat = getCat(article.category)

  // Simple content renderer: preserve line breaks, highlight code blocks
  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('# '))    return <h2 key={i} className="text-xl font-bold text-slate-900 mt-6 mb-2 first:mt-0">{line.slice(2)}</h2>
      if (line.startsWith('## '))   return <h3 key={i} className="text-lg font-semibold text-slate-800 mt-5 mb-1.5">{line.slice(3)}</h3>
      if (line.startsWith('### '))  return <h4 key={i} className="text-base font-semibold text-slate-700 mt-4 mb-1">{line.slice(4)}</h4>
      if (line.startsWith('- ') || line.startsWith('• ')) {
        return <li key={i} className="ml-4 text-slate-700 text-sm leading-relaxed list-disc">{line.slice(2)}</li>
      }
      if (line.trim() === '') return <div key={i} className="h-3" />
      return <p key={i} className="text-slate-700 text-sm leading-relaxed">{line}</p>
    })
  }

  return (
    <div className="flex-1 min-w-0">
      {/* Reader header */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className={`h-1.5 w-full ${cat.bar}`} />
        <div className="px-8 py-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" /> Retour
            </button>
            {canEdit && (
              <div className="flex items-center gap-2">
                <button onClick={onEdit} className="btn-secondary flex items-center gap-1.5">
                  <Pencil className="w-3.5 h-3.5" /> Modifier
                </button>
                <button onClick={onDelete} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cat.bg} ${cat.text}`}>
              {cat.icon}{cat.label}
            </span>
            {!article.isPublished && (
              <span className="text-xs font-medium px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">Brouillon</span>
            )}
          </div>

          <h1 className="text-2xl font-bold text-slate-900 leading-tight mb-3">{article.title}</h1>

          <div className="flex items-center gap-4 text-xs text-slate-400 mb-4">
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{article.views} vue{article.views !== 1 ? 's' : ''}</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Mis à jour {formatDate(article.updatedAt)}</span>
          </div>

          {article.tags && (
            <div className="flex items-center gap-1.5 flex-wrap mb-6">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              {article.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{tag}</span>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-6 space-y-0.5">
            {renderContent(article.content)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export function KnowledgePage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = ['ADMIN', 'MANAGER'].includes(user?.role ?? '')

  const [search, setSearch]                     = useState('')
  const [activeCategory, setActiveCategory]     = useState('')
  const [selectedArticle, setSelectedArticle]   = useState<KnowledgeArticle | null>(null)
  const [showCreate, setShowCreate]             = useState(false)
  const [editingArticle, setEditingArticle]     = useState<KnowledgeArticle | null>(null)
  const [deletingArticle, setDeletingArticle]   = useState<KnowledgeArticle | null>(null)

  // Queries
  const { data: catData } = useQuery<{ total: number; categories: { category: string; count: number }[] }>({
    queryKey: ['knowledge-categories'],
    queryFn: async () => { const { data } = await api.get('/knowledge/categories'); return data.data },
    staleTime: 30_000,
  })

  const { data, isLoading } = useQuery<{ data: KnowledgeArticle[]; meta: { total: number } }>({
    queryKey: ['knowledge', { search, activeCategory }],
    queryFn: async () => {
      const { data } = await api.get('/knowledge', {
        params: { search: search || undefined, category: activeCategory || undefined, limit: 50 },
      })
      return data
    },
    staleTime: 30_000,
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: (v: ArticleForm) => api.post('/knowledge', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge'] })
      qc.invalidateQueries({ queryKey: ['knowledge-categories'] })
      setShowCreate(false)
      toast.success('Article créé')
    },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ArticleForm }) => api.put(`/knowledge/${id}`, values),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['knowledge'] })
      qc.invalidateQueries({ queryKey: ['knowledge-categories'] })
      if (selectedArticle?.id === editingArticle?.id) setSelectedArticle(res.data.data)
      setEditingArticle(null)
      toast.success('Article modifié')
    },
    onError: () => toast.error('Erreur lors de la modification'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge'] })
      qc.invalidateQueries({ queryKey: ['knowledge-categories'] })
      if (selectedArticle?.id === deletingArticle?.id) setSelectedArticle(null)
      setDeletingArticle(null)
      toast.success('Article supprimé')
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  })

  // Forms
  const createForm = useForm<ArticleForm>({
    resolver: zodResolver(articleSchema) as Resolver<ArticleForm>,
    defaultValues: { isPublished: true, category: 'PROCEDURES' },
  })
  const editForm = useForm<ArticleForm>({
    resolver: zodResolver(articleSchema) as Resolver<ArticleForm>,
  })

  const openCreate = () => {
    createForm.reset({ title: '', category: activeCategory || 'PROCEDURES', content: '', tags: '', isPublished: true })
    setShowCreate(true)
  }
  const openEdit = (a: KnowledgeArticle, e?: React.MouseEvent) => {
    e?.stopPropagation()
    editForm.reset({ title: a.title, category: a.category, content: a.content, tags: a.tags ?? '', isPublished: a.isPublished })
    setEditingArticle(a)
  }
  const openDelete = (a: KnowledgeArticle, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setDeletingArticle(a)
  }

  const articles = data?.data ?? []
  const totalArticles = catData?.total ?? 0

  return (
    <div className="fade-in flex gap-6 h-full">

      {/* ── Sidebar catégories ── */}
      <aside className="w-56 flex-shrink-0 space-y-1">
        <div className="mb-3">
          <h1 className="page-title">Base de connaissance</h1>
          <p className="page-subtitle text-xs">{totalArticles} article{totalArticles !== 1 ? 's' : ''}</p>
        </div>

        {/* Tous */}
        <button
          onClick={() => { setActiveCategory(''); setSelectedArticle(null) }}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
            !activeCategory ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-4 h-4" />
            Tous les articles
          </div>
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${!activeCategory ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500'}`}>
            {totalArticles}
          </span>
        </button>

        <div className="pt-2 pb-1">
          <p className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Catégories</p>
        </div>

        {Object.entries(CATEGORIES).map(([key, cat]) => {
          const count = catData?.categories.find(c => c.category === key)?.count ?? 0
          if (count === 0 && !canEdit) return null
          return (
            <button
              key={key}
              onClick={() => { setActiveCategory(key); setSelectedArticle(null) }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeCategory === key ? `${cat.bg} ${cat.text}` : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {cat.icon}
                {cat.label}
              </div>
              {count > 0 && (
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                  activeCategory === key ? `${cat.bg} ${cat.text}` : 'bg-slate-100 text-slate-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}

        {canEdit && (
          <div className="pt-4">
            <button onClick={openCreate} className="btn-primary w-full justify-center">
              <Plus className="w-4 h-4" /> Nouvel article
            </button>
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">

        {/* Search bar */}
        {!selectedArticle && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              className="input pl-9 bg-white"
              placeholder={`Rechercher${activeCategory ? ` dans ${CATEGORIES[activeCategory]?.label ?? activeCategory}` : ''}…`}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Article reader */}
        {selectedArticle ? (
          <ArticleReader
            article={selectedArticle}
            canEdit={canEdit}
            onEdit={() => openEdit(selectedArticle)}
            onDelete={() => openDelete(selectedArticle)}
            onClose={() => setSelectedArticle(null)}
          />
        ) : isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl h-52 animate-pulse" />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <BookOpen className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-slate-500 font-medium mb-1">Aucun article trouvé</p>
            <p className="text-sm text-slate-400 mb-4">
              {search ? `Aucun résultat pour « ${search} »` : 'Cette catégorie est vide'}
            </p>
            {canEdit && (
              <button className="btn-primary" onClick={openCreate}>
                <Plus className="w-4 h-4" /> Créer un article
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {articles.map(article => (
              <ArticleCard
                key={article.id}
                article={article}
                canEdit={canEdit}
                onClick={() => setSelectedArticle(article)}
                onEdit={e => openEdit(article, e)}
                onDelete={e => openDelete(article, e)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modales ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nouvel article" size="xl">
        <ArticleFormFields
          form={createForm}
          onSubmit={v => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
          submitLabel="Créer l'article"
        />
      </Modal>

      <Modal open={!!editingArticle} onClose={() => setEditingArticle(null)} title="Modifier l'article" size="xl">
        <ArticleFormFields
          form={editForm}
          onSubmit={v => editingArticle && editMutation.mutate({ id: editingArticle.id, values: v })}
          isPending={editMutation.isPending}
          onCancel={() => setEditingArticle(null)}
          submitLabel="Enregistrer"
        />
      </Modal>

      <Modal open={!!deletingArticle} onClose={() => setDeletingArticle(null)} title="Supprimer l'article" size="sm">
        <p className="text-slate-600 mb-6">
          Supprimer <strong>"{deletingArticle?.title}"</strong> ? Cette action est irréversible.
        </p>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setDeletingArticle(null)}>Annuler</button>
          <button
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
            onClick={() => deletingArticle && deleteMutation.mutate(deletingArticle.id)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

// ── Article form ──────────────────────────────────────────────────────────────

function ArticleFormFields({
  form, onSubmit, isPending, onCancel, submitLabel,
}: {
  form: ReturnType<typeof useForm<ArticleForm>>
  onSubmit: (v: ArticleForm) => void
  isPending: boolean
  onCancel: () => void
  submitLabel: string
}) {
  const { register, handleSubmit, watch, formState: { errors } } = form
  const selectedCat = watch('category')
  const cat = getCat(selectedCat)

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Titre *</label>
          <input {...register('title')} className={`input ${errors.title ? 'input-error' : ''}`} placeholder="Titre de l'article" />
          {errors.title && <p className="form-error">{errors.title.message}</p>}
        </div>

        <div>
          <label className="label">Catégorie *</label>
          <select {...register('category')} className="input">
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Tags</label>
          <input {...register('tags')} className="input" placeholder="réseau, wifi, configuration…" />
          <p className="text-xs text-slate-400 mt-1">Séparés par des virgules</p>
        </div>
      </div>

      <div>
        <label className="label">Contenu *</label>
        <p className="text-xs text-slate-400 mb-1.5">Supporté : # Titre, ## Sous-titre, - Liste</p>
        <textarea
          {...register('content')}
          className={`input font-mono text-sm resize-y ${errors.content ? 'input-error' : ''}`}
          rows={14}
          placeholder={`# Titre principal\n\nIntroduction du problème ou de la procédure.\n\n## Étapes\n\n- Étape 1\n- Étape 2\n- Étape 3`}
        />
        {errors.content && <p className="form-error">{errors.content.message}</p>}
      </div>

      {/* Category preview badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            {...register('isPublished')}
            type="checkbox" id="isPublished"
            className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="isPublished" className="text-sm font-medium text-slate-700 cursor-pointer">
            Publier (visible par tous)
          </label>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cat.bg} ${cat.text}`}>
          {cat.icon}{cat.label}
        </span>
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={isPending}>
          {isPending ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
