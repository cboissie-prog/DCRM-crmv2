import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, Download, FileJson, FileText, List } from 'lucide-react'
import api from '../../lib/api'
import { PageSpinner } from '../../components/ui/Spinner'
import { toast } from '../../components/ui/Toast'
import { cn } from '../../lib/utils'

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/** Transforme un titre en ancre HTML stable (même logique côté TOC et côté rendu) */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** Extrait le texte brut des enfants React (titres contenant du code inline, etc.) */
function childrenToText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return childrenToText((children as { props: { children?: React.ReactNode } }).props.children)
  }
  return ''
}

interface TocEntry {
  level: 2 | 3
  text: string
  slug: string
}

/** Construit le sommaire depuis les titres ## et ### du markdown (hors blocs de code) */
function buildToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = []
  let inCodeBlock = false
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) { inCodeBlock = !inCodeBlock; continue }
    if (inCodeBlock) continue
    const match = /^(#{2,3})\s+(.+)$/.exec(line)
    if (!match) continue
    const rawText = match[2].replace(/`/g, '').trim()
    entries.push({ level: match[1].length as 2 | 3, text: rawText, slug: slugify(rawText) })
  }
  return entries
}

/** Déclenche le téléchargement d'un blob sous un nom de fichier donné */
function downloadBlob(content: BlobPart, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ApiDocsPage() {
  const [tocOpen, setTocOpen] = useState(false)
  const [downloading, setDownloading] = useState<'md' | 'json' | null>(null)

  const { data: markdown, isLoading, isError } = useQuery<string>({
    queryKey: ['api-docs', 'markdown'],
    queryFn: async () => {
      const { data } = await api.get('/docs/markdown', {
        responseType: 'text',
        transformResponse: [(d) => d], // ne pas tenter de parser le markdown en JSON
      })
      return data as string
    },
    staleTime: 5 * 60_000,
  })

  const toc = useMemo(() => (markdown ? buildToc(markdown) : []), [markdown])

  const handleDownloadMd = async () => {
    setDownloading('md')
    try {
      const { data } = await api.get('/docs/markdown', { responseType: 'text', transformResponse: [(d) => d] })
      downloadBlob(data as string, 'text/markdown;charset=utf-8', 'API.md')
    } catch {
      toast.error('Téléchargement impossible')
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadJson = async () => {
    setDownloading('json')
    try {
      const { data } = await api.get('/docs/openapi', { responseType: 'text', transformResponse: [(d) => d] })
      downloadBlob(data as string, 'application/json;charset=utf-8', 'openapi.json')
    } catch {
      toast.error('Téléchargement impossible')
    } finally {
      setDownloading(null)
    }
  }

  if (isLoading) return <PageSpinner />
  if (isError || !markdown) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Impossible de charger la documentation API.</p>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Documentation API</h1>
            <p className="text-xs text-slate-500">Référence complète des endpoints REST du CRM</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadMd}
            disabled={downloading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Format Markdown — idéal à fournir à une IA (ChatGPT, Claude…)"
          >
            {downloading === 'md' ? <Download className="w-3.5 h-3.5 animate-pulse" /> : <FileText className="w-3.5 h-3.5" />}
            Télécharger .md
          </button>
          <button
            onClick={handleDownloadJson}
            disabled={downloading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Spec OpenAPI 3 — importable dans Postman, n8n, Make…"
          >
            {downloading === 'json' ? <Download className="w-3.5 h-3.5 animate-pulse" /> : <FileJson className="w-3.5 h-3.5" />}
            Télécharger openapi.json
          </button>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        {/* Sommaire (desktop) */}
        <nav className="hidden xl:block w-64 flex-shrink-0 sticky top-4 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Sommaire</p>
          <TocList toc={toc} />
        </nav>

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          {/* Sommaire repliable (mobile / écrans étroits) */}
          <div className="xl:hidden mb-4">
            <button
              onClick={() => setTocOpen(o => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <List className="w-3.5 h-3.5" />
              Sommaire
            </button>
            {tocOpen && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-white p-4">
                <TocList toc={toc} onNavigate={() => setTocOpen(false)} />
              </div>
            )}
          </div>

          <article className="rounded-xl border border-slate-200 bg-white p-5 lg:p-8">
            <MarkdownContent markdown={markdown} />
          </article>
        </div>
      </div>
    </div>
  )
}

// ─── Sommaire ─────────────────────────────────────────────────────────────────

function TocList({ toc, onNavigate }: { toc: TocEntry[]; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {toc.map((entry, i) => (
        <li key={`${entry.slug}-${i}`}>
          <a
            href={`#${entry.slug}`}
            onClick={onNavigate}
            className={cn(
              'block py-1 text-xs rounded transition-colors hover:text-primary-700',
              entry.level === 2 ? 'font-semibold text-slate-700' : 'pl-3 text-slate-500'
            )}
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ul>
  )
}

// ─── Rendu markdown ───────────────────────────────────────────────────────────

function HeadingWithAnchor({ level, children }: { level: 1 | 2 | 3 | 4; children?: React.ReactNode }) {
  const text = childrenToText(children).replace(/`/g, '').trim()
  const slug = slugify(text)
  const Tag = `h${level}` as const
  const styles = {
    1: 'text-2xl font-bold text-slate-900 mb-4',
    2: 'text-xl font-bold text-slate-900 mt-10 mb-3 pb-2 border-b border-slate-200 scroll-mt-4',
    3: 'text-base font-semibold text-slate-800 mt-8 mb-2 scroll-mt-4',
    4: 'text-sm font-semibold text-slate-700 mt-5 mb-1.5',
  }
  return <Tag id={slug} className={styles[level]}>{children}</Tag>
}

function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <HeadingWithAnchor level={1}>{children}</HeadingWithAnchor>,
        h2: ({ children }) => <HeadingWithAnchor level={2}>{children}</HeadingWithAnchor>,
        h3: ({ children }) => <HeadingWithAnchor level={3}>{children}</HeadingWithAnchor>,
        h4: ({ children }) => <HeadingWithAnchor level={4}>{children}</HeadingWithAnchor>,
        p: ({ children }) => <p className="text-sm text-slate-600 leading-relaxed my-2">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm text-slate-600">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm text-slate-600">{children}</ol>,
        a: ({ href, children }) => (
          <a href={href} className="text-primary-600 hover:underline">{children}</a>
        ),
        hr: () => <hr className="my-6 border-slate-200" />,
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-slate-200">
            <table className="w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
        th: ({ children }) => (
          <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 whitespace-nowrap">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-xs text-slate-600 border-b border-slate-100 align-top">{children}</td>
        ),
        code: ({ className, children }) => {
          // Bloc de code (```lang) → className "language-xxx" ; sinon code inline
          const isBlock = /language-/.test(className ?? '')
          if (isBlock) {
            return (
              <code className="block bg-slate-900 text-slate-100 text-xs rounded-lg p-4 overflow-x-auto whitespace-pre">
                {children}
              </code>
            )
          }
          return (
            <code className="bg-slate-100 text-slate-800 text-[11px] font-mono px-1.5 py-0.5 rounded">
              {children}
            </code>
          )
        },
        pre: ({ children }) => <pre className="my-3">{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-primary-200 bg-primary-50/50 rounded-r-lg px-4 py-1 my-3 text-sm text-slate-600">
            {children}
          </blockquote>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
}
